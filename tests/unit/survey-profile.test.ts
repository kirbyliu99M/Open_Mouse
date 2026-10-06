/**
 * The pure parts of a survey contribution (src/server/survey/profile.ts): the
 * bins, the grip that is stored, the day the consent is dated to, and the write
 * built from a validated body and the scan the server read.
 */
import { describe, expect, it } from "vitest";
import {
  CONTRIBUTION_BIN_MM,
  SURVEY_CONSENT_VERSION,
  surveySubmissionSchema,
} from "../../src/lib/contracts/survey";
import {
  binDown,
  buildContributionWrite,
  resolveStoredGrip,
  startOfUtcDay,
} from "../../src/server/survey/profile";
import {
  USE_B,
  FEEL_SMALL,
  DURATION_A,
  PAIN_A,
  BRAND_A,
} from "./fixtures/survey-values";

describe("binDown", () => {
  it("rounds down to a multiple of the bin, never above the value, never more than a bin below it", () => {
    expect(CONTRIBUTION_BIN_MM).toBe(5);
    // Every tenth of a millimetre a scan can hold (numeric(5,1)), 0 to 300 mm.
    for (let tenths = 0; tenths <= 3000; tenths += 1) {
      const mm = tenths / 10;
      const bin = binDown(mm);
      expect(bin % 5, `${mm}`).toBe(0);
      expect(bin, `${mm}`).toBeLessThanOrEqual(mm);
      expect(mm - bin, `${mm}`).toBeLessThan(5);
    }
  });

  it.each([
    [186.4, 185],
    [185, 185],
    [184.9, 180],
    [100, 100],
    [104.9, 100],
    [279.9, 275],
    [280, 280],
    [82.7, 80],
    [50, 50],
  ])("%s mm -> %s", (mm, expected) => {
    expect(binDown(mm)).toBe(expected);
  });

  it("never rounds up, for the float on either side of every multiple of the bin", () => {
    const next = (x: number, steps: number) => {
      // The float `steps` places above (or, negative, below) `x`.
      const view = new DataView(new ArrayBuffer(8));
      view.setFloat64(0, x);
      view.setBigUint64(0, view.getBigUint64(0) + BigInt(steps));
      return view.getFloat64(0);
    };
    for (let multiple = 5; multiple <= 300; multiple += 5) {
      for (const steps of [-3, -2, -1, 0, 1, 2, 3]) {
        const mm = next(multiple, steps);
        const bin = binDown(mm);
        expect(bin, `${mm}`).toBeLessThanOrEqual(mm);
        // Exactly the multiple at and above it, the one before just below it.
        expect(bin, `${mm}`).toBe(steps >= 0 ? multiple : multiple - 5);
      }
    }
    // The bin is a parameter, not a constant 5.
    expect(binDown(37, 10)).toBe(30);
  });
});

describe("resolveStoredGrip", () => {
  const m = { handLengthMm: 180, palmLengthMm: 100 }; // r = 0.556 -> claw

  it("takes the body's grip first, then the scan's stated grip, then the grip the engine used", () => {
    expect(resolveStoredGrip("fingertip", "palm", m)).toBe("fingertip");
    expect(resolveStoredGrip(undefined, "palm", m)).toBe("palm");
    expect(resolveStoredGrip(undefined, null, m)).toBe("claw");
  });

  it.each([
    [110, "palm"],
    [104.4, "palm"], // r = 0.58 exactly
    [100, "claw"],
    [97.2, "claw"], // r = 0.54 exactly
    [90, "fingertip"],
  ])("predicts from palm length %s mm: %s", (palmLengthMm, expected) => {
    expect(
      resolveStoredGrip(undefined, null, { handLengthMm: 180, palmLengthMm }),
    ).toBe(expected);
  });

  it("is never empty", () => {
    for (const palmLengthMm of [50, 90, 100, 110, 170]) {
      expect(["palm", "claw", "fingertip"]).toContain(
        resolveStoredGrip(undefined, null, { handLengthMm: 180, palmLengthMm }),
      );
    }
  });
});

describe("startOfUtcDay", () => {
  it("drops everything finer than the UTC day", () => {
    expect(
      startOfUtcDay(new Date("2026-10-06T23:59:59.999Z")).toISOString(),
    ).toBe("2026-10-06T00:00:00.000Z");
    expect(
      startOfUtcDay(new Date("2026-10-06T00:00:00.000Z")).toISOString(),
    ).toBe("2026-10-06T00:00:00.000Z");
    // 2026-10-07 07:30 in Taipei is still the 6th in UTC.
    expect(startOfUtcDay(new Date("2026-10-06T23:30:00Z")).getUTCDate()).toBe(
      6,
    );
  });
});

describe("buildContributionWrite", () => {
  const SCAN_ID = "10000000-0000-4000-8000-000000000001";
  const NOW = new Date("2026-10-06T08:15:30.123Z");
  const ids = new Map([
    ["mouse-a", "20000000-0000-4000-8000-00000000000a"],
    ["mouse-b", "20000000-0000-4000-8000-00000000000b"],
  ]);
  const body = surveySubmissionSchema.parse({
    scanId: SCAN_ID,
    consent: { accepted: true, version: SURVEY_CONSENT_VERSION },
    gripStyle: "fingertip",
    mainUse: USE_B,
    ratings: [
      {
        slug: "mouse-a",
        satisfaction: 5,
        duration: DURATION_A,
        painPoints: [PAIN_A],
        current: true,
      },
      { slug: "mouse-b", satisfaction: 2 },
    ],
    otherMouse: { brand: BRAND_A, sizeFeel: FEEL_SMALL },
    feedback: "  too light  ",
  });
  const scan = {
    gripStyleStated: "palm" as const,
    measurements: {
      handLengthMm: 186.4,
      palmLengthMm: 106.2,
      palmWidthMm: 82.7,
    },
  };

  it("builds the write from the body and the scan: bins from the scan, ids from the catalogue, the instant only as the mark", () => {
    const write = buildContributionWrite({
      body,
      userId: "user-1",
      scan,
      mouseIdBySlug: ids,
      now: NOW,
    });
    expect(write).toEqual({
      scanId: SCAN_ID,
      userId: "user-1",
      consentVersion: SURVEY_CONSENT_VERSION,
      consentedAt: new Date("2026-10-06T00:00:00.000Z"),
      markedAt: NOW,
      handLengthBinMm: 185,
      palmWidthBinMm: 80,
      gripStyle: "fingertip",
      mainUse: USE_B,
      feedback: "too light",
      ratings: [
        {
          mouseId: ids.get("mouse-a"),
          satisfaction: 5,
          duration: DURATION_A,
          painPoints: [PAIN_A],
          isCurrent: true,
        },
        {
          mouseId: ids.get("mouse-b"),
          satisfaction: 2,
          duration: null,
          painPoints: [],
          isCurrent: false,
        },
      ],
      otherMouse: {
        brand: BRAND_A,
        sizeFeel: FEEL_SMALL,
        isCurrent: false,
      },
    });
  });

  it("uses nulls for what the body leaves out, and the scan's grip when the body has none", () => {
    const write = buildContributionWrite({
      body: surveySubmissionSchema.parse({
        scanId: SCAN_ID,
        consent: { accepted: true, version: SURVEY_CONSENT_VERSION },
        ratings: [{ slug: "mouse-b", satisfaction: 3 }],
      }),
      userId: null,
      scan,
      mouseIdBySlug: ids,
      now: NOW,
    });
    expect(write).toMatchObject({
      userId: null,
      gripStyle: "palm",
      mainUse: null,
      feedback: null,
      otherMouse: null,
    });
  });

  it("holds nothing of the scan but its id, and that only for the mark: no measurement, no hand side, no unrounded value", () => {
    const write = buildContributionWrite({
      body,
      userId: null,
      scan,
      mouseIdBySlug: ids,
      now: NOW,
    });
    const text = JSON.stringify(write);
    expect(text).not.toMatch(/186\.4|106\.2|82\.7/);
    expect(Object.keys(write)).not.toContain("hand");
    expect(Object.keys(write)).not.toContain("measurements");
  });

  it("throws on a slug the catalogue does not hold (the service answers 400 before this)", () => {
    expect(() =>
      buildContributionWrite({
        body,
        userId: null,
        scan,
        mouseIdBySlug: new Map(),
        now: NOW,
      }),
    ).toThrow(/catalogue/);
  });
});
