import { describe, expect, it } from "vitest";
import { handleScanSubmission } from "../../src/server/scans/submit";
import { buildManualAnswersSubmission } from "../../src/client/scan/answers";
import { createFakeRepo } from "./fixtures/fake-scan-repo";

/**
 * What the server stores for a typed hand length and width (manual entry,
 * candidate, 2026-10-12): the body the client builds, through the real
 * `handleScanSubmission`, on the in-memory repo the other submit tests use.
 */
function post(body: unknown, repo: ReturnType<typeof createFakeRepo>["repo"]) {
  return handleScanSubmission(
    new Request("http://localhost/api/scans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { repo, getUserId: async () => null },
  );
}

const BODY = buildManualAnswersSubmission(
  { hand: "left", handLengthMm: 185, handWidthMm: 82 },
  { grip: "fingertip", thickness: "thin" },
);

describe("POST /api/scans with a typed hand size", () => {
  it("stores calibrationMethod manual-entry, no scale-check ratio, and the evidence as sent", async () => {
    const { repo, insertedScans } = createFakeRepo();
    const res = await post(BODY, repo);
    expect(res.status).toBe(201);
    expect(insertedScans).toHaveLength(1);
    const stored = insertedScans[0]!;
    expect(stored.calibrationMethod).toBe("manual-entry");
    expect(stored.scaleCheckRatio).toBeNull();
    expect(stored.calibrationEvidence).toEqual(BODY.calibration);
    expect(stored.hand).toBe("left");
    expect(stored.gripStyleStated).toBe("fingertip");
    expect(stored.palmThicknessStated).toBe("thin");
    expect(stored.measurements).toEqual({
      handLengthMm: 185,
      palmLengthMm: 103.6,
      palmWidthMm: 82,
    });
  });

  it("a skipped thickness is stored as null, never a default", async () => {
    const { repo, insertedScans } = createFakeRepo();
    await post(
      buildManualAnswersSubmission(
        { hand: "right", handLengthMm: 185, handWidthMm: 82 },
        { grip: "palm", thickness: null },
      ),
      repo,
    );
    expect(insertedScans[0]!.palmThicknessStated).toBeNull();
  });

  it("a body without a grip, or with a scan-only field, is refused and nothing is stored", async () => {
    const noGrip: Record<string, unknown> = { ...BODY };
    delete noGrip.gripStyleStated;
    const withIndex = {
      ...BODY,
      measurements: { ...BODY.measurements, indexLengthMm: 70 },
    };
    for (const [body, field] of [
      [noGrip, "gripStyleStated"],
      [withIndex, "measurements.indexLengthMm"],
    ] as const) {
      const { repo, insertedScans } = createFakeRepo();
      const res = await post(body, repo);
      expect(res.status).toBe(400);
      const json = (await res.json()) as { issues: { path: string }[] };
      expect(json.issues.map((i) => i.path)).toContain(field);
      expect(insertedScans).toHaveLength(0);
    }
  });
});
