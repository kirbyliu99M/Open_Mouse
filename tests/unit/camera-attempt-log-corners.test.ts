/**
 * V3.2 F2 (candidate): what the local attempt log keeps about a placed paper
 * frame, and Kirby's corner check (`?debug=1` only): pixel distances and the
 * magnifier switch, nothing that could hold a picture or a coordinate.
 */
import { describe, expect, it } from "vitest";
import {
  buildAttemptRecord,
  describeAttempt,
  sanitizeAttempt,
} from "../../src/client/camera/attemptLog";

const capture = {
  method: "canvas" as const,
  captureSource: "frame" as const,
  photoWidth: 1080,
  photoHeight: 1920,
  photoKb: 410,
  previewWidth: null,
  previewHeight: null,
};

function check(
  magnifier: boolean,
  distancesPx: [number, number, number, number],
) {
  return buildAttemptRecord({
    at: "2026-10-21T01:02:03.000Z",
    userAgent: "test",
    capture,
    outcome: {
      kind: "cornerCheck",
      magnifier,
      distancesPx,
      imageLongEdgePx: 1920,
    },
  });
}

describe("the corner check record", () => {
  it("keeps the four distances to 0.1 px, the magnifier switch and the photo's long edge", () => {
    const r = check(true, [3.14159, 0, 12.06, 7.5]);
    expect(r.cornerCheck).toEqual({
      magnifier: true,
      distancesPx: [3.1, 0, 12.1, 7.5],
      imageLongEdgePx: 1920,
    });
    expect(r.result).toBe("ok");
    expect(r.errors).toEqual([]);
    // No analysis ran: no paper, no hand numbers, no measurement.
    expect(r.paper).toBeNull();
    expect(r.measured).toEqual({ handLengthMm: null, palmWidthMm: null });
    expect(describeAttempt(r)).toContain("corner check magnifier on");
    expect(describeAttempt(check(false, [1, 2, 3, 4]))).toContain(
      "magnifier off · 1/2/3/4 px",
    );
  });

  it("has no place for a coordinate or a picture: anything else is dropped or the whole check is null", () => {
    const r = sanitizeAttempt({
      ...check(true, [1, 2, 3, 4]),
      cornerCheck: {
        magnifier: true,
        distancesPx: [1, 2, 3, 4],
        imageLongEdgePx: 1920,
        corners: [{ x: 10, y: 20 }],
        photo: "data:image/jpeg;base64,AAAA",
      },
    })!;
    expect(Object.keys(r.cornerCheck!).sort()).toEqual([
      "distancesPx",
      "imageLongEdgePx",
      "magnifier",
    ]);
    expect(JSON.stringify(r)).not.toMatch(/data:image|"x":|"y":/);
    for (const bad of [
      { magnifier: "yes", distancesPx: [1, 2, 3, 4] },
      { magnifier: true, distancesPx: [1, 2, 3] },
      { magnifier: true, distancesPx: [1, 2, 3, -1] },
      { magnifier: true, distancesPx: [1, 2, 3, 1e9] },
      { magnifier: true, distancesPx: [1, 2, 3, "4"] },
      "data:image/png;base64,AAAA",
    ]) {
      expect(
        sanitizeAttempt({ ...check(true, [1, 2, 3, 4]), cornerCheck: bad })!
          .cornerCheck,
      ).toBeNull();
    }
  });

  it("is null on an ordinary attempt and on a record from before it was kept", () => {
    const old = { ...check(true, [1, 2, 3, 4]) } as Record<string, unknown>;
    delete old.cornerCheck;
    expect(sanitizeAttempt(old)!.cornerCheck).toBeNull();
  });
});

describe("the paper block's cornersSource", () => {
  const withPaper = (paper: Record<string, unknown>) =>
    sanitizeAttempt({ ...check(true, [1, 2, 3, 4]), paper })!.paper!;
  const base = {
    cornersSeen: 4,
    minSideCoverage: 0.5,
    gateFailures: [],
  };

  it("reads auto for a record without it, and keeps adjusted and manual", () => {
    expect(withPaper(base).cornersSource).toBe("auto");
    expect(
      withPaper({ ...base, cornersSource: "adjusted" }).cornersSource,
    ).toBe("adjusted");
    expect(withPaper({ ...base, cornersSource: "manual" }).cornersSource).toBe(
      "manual",
    );
    expect(withPaper({ ...base, cornersSource: "guessed" }).cornersSource).toBe(
      "auto",
    );
  });

  it("keeps a placed frame's missing coverage as null, and an older record's as its number", () => {
    expect(
      withPaper({ ...base, minSideCoverage: null }).minSideCoverage,
    ).toBeNull();
    expect(withPaper(base).minSideCoverage).toBe(0.5);
    expect(withPaper({ ...base, minSideCoverage: "x" }).minSideCoverage).toBe(
      0,
    );
  });
});
