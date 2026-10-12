import { describe, expect, it } from "vitest";
import {
  buildManualAnswersSubmission,
  type ManualEntryValues,
} from "../../src/client/scan/answers";
import { submitScan } from "../../src/client/scan/submitScan";
import {
  estimatePalmLengthMm,
  MANUAL_ENTRY,
  scanSubmissionSchema,
} from "../../src/lib/contracts/measurement";

/**
 * The submission of a typed hand length and width after the grip page (which
 * has no 跳過 then) and the optional thickness page (candidate, 2026-10-12).
 */
const VALUES: ManualEntryValues = {
  hand: "right",
  handLengthMm: 185,
  handWidthMm: 82,
};

describe("buildManualAnswersSubmission", () => {
  it("is exactly the manual-entry shape: three measurements, no scan-only field", () => {
    const built = buildManualAnswersSubmission(VALUES, {
      grip: "claw",
      thickness: null,
    });
    expect(() => scanSubmissionSchema.parse(built)).not.toThrow();
    expect(Object.keys(built).sort()).toEqual([
      "calibration",
      "gripStyleStated",
      "hand",
      "measurementModelVersion",
      "measurements",
    ]);
    expect(built.measurements).toEqual({
      handLengthMm: 185,
      palmLengthMm: estimatePalmLengthMm(185),
      palmWidthMm: 82,
    });
    for (const scanOnly of [
      "thumbLengthMm",
      "indexLengthMm",
      "middleLengthMm",
      "ringLengthMm",
      "pinkyLengthMm",
      "palmThicknessMm",
    ])
      expect(built.measurements).not.toHaveProperty(scanOnly);
    expect(built.calibration).toMatchObject({
      method: "manual-entry",
      handLengthMm: 185,
      handWidthMm: 82,
      palmLengthEstimated: true,
      palmLengthRatio: MANUAL_ENTRY.palmLengthRatio,
    });
    expect(built.gripStyleStated).toBe("claw");
  });

  it("the grip is mandatory: without it nothing is built", () => {
    expect(() =>
      buildManualAnswersSubmission(VALUES, { grip: null, thickness: "thin" }),
    ).toThrow(/grip/);
  });

  it("the thickness is optional: a skip leaves no key, and never a default", () => {
    const skipped = buildManualAnswersSubmission(VALUES, {
      grip: "palm",
      thickness: null,
    });
    expect(skipped).not.toHaveProperty("palmThicknessStated");
    expect(JSON.stringify(skipped)).not.toContain("medium");
    const answered = buildManualAnswersSubmission(VALUES, {
      grip: "palm",
      thickness: "thick",
    });
    expect(answered.palmThicknessStated).toBe("thick");
    expect(answered.gripStyleStated).toBe("palm");
  });

  it("a pair that breaks the contract is refused loudly", () => {
    expect(() =>
      buildManualAnswersSubmission(
        { hand: "left", handLengthMm: 185, handWidthMm: 140 },
        { grip: "claw", thickness: null },
      ),
    ).toThrow();
    expect(() =>
      buildManualAnswersSubmission(
        { hand: "left", handLengthMm: 100, handWidthMm: 80 },
        { grip: "claw", thickness: null },
      ),
    ).toThrow();
  });

  it("on the wire the JSON body has the answered keys and not the skipped one", async () => {
    const bodies: string[] = [];
    const fakeFetch = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return new Response(
        JSON.stringify({ scanId: "623e4567-e89b-12d3-a456-426614174010" }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    await submitScan(
      buildManualAnswersSubmission(VALUES, {
        grip: "fingertip",
        thickness: null,
      }),
      fakeFetch,
    );
    await submitScan(
      buildManualAnswersSubmission(VALUES, {
        grip: "fingertip",
        thickness: "thin",
      }),
      fakeFetch,
    );
    const skipped = JSON.parse(bodies[0]);
    expect(skipped.gripStyleStated).toBe("fingertip");
    expect(skipped).not.toHaveProperty("palmThicknessStated");
    expect(skipped.calibration.method).toBe("manual-entry");
    expect(JSON.parse(bodies[1]).palmThicknessStated).toBe("thin");
  });
});
