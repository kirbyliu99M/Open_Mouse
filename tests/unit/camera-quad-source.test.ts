import { describe, expect, it } from "vitest";
import {
  createMarkerBasedQuadSource,
  createPaperEdgeQuadSource,
} from "../../src/client/camera/quad-source";
import type { DetectedMarker } from "../../src/client/photo/markers";

const FAKE_FRAME: ImageData = {
  width: 640,
  height: 480,
  data: new Uint8ClampedArray(0),
  colorSpace: "srgb",
};

function marker(id: number, cx: number, cy: number): DetectedMarker {
  return {
    id,
    corners: [
      { x: cx - 5, y: cy - 5 },
      { x: cx + 5, y: cy - 5 },
      { x: cx + 5, y: cy + 5 },
      { x: cx - 5, y: cy + 5 },
    ],
  };
}

describe("createMarkerBasedQuadSource", () => {
  it("reports cornersSeen 0, all-false cornersFound and null corners when nothing is detected", () => {
    const source = createMarkerBasedQuadSource(() => []);
    const result = source(FAKE_FRAME, "a4");
    expect(result).toEqual({
      corners: null,
      cornersSeen: 0,
      cornersFound: [false, false, false, false],
      partialCorners: [null, null, null, null],
      minSideCoverage: 0,
      edgeFitResidualPx: 0,
    });
  });

  it("reports a partial corner count without a quad, and locks on the specific corners found (TL, TR)", () => {
    const source = createMarkerBasedQuadSource(() => [
      marker(0, 0, 0),
      marker(1, 100, 0),
    ]);
    const result = source(FAKE_FRAME, "a4");
    expect(result.cornersSeen).toBe(2);
    expect(result.corners).toBeNull();
    expect(result.cornersFound).toEqual([true, true, false, false]);
    expect(result.partialCorners).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      null,
      null,
    ]);
  });

  it("locks on non-adjacent corners too (TL, BR)", () => {
    const source = createMarkerBasedQuadSource(() => [
      marker(0, 0, 0),
      marker(2, 100, 100),
    ]);
    const result = source(FAKE_FRAME, "a4");
    expect(result.cornersFound).toEqual([true, false, true, false]);
    expect(result.partialCorners).toEqual([
      { x: 0, y: 0 },
      null,
      { x: 100, y: 100 },
      null,
    ]);
  });

  it("ignores upright-flap marker ids (4, 5) when counting", () => {
    const source = createMarkerBasedQuadSource(() => [
      marker(0, 0, 0),
      marker(1, 100, 0),
      marker(4, 50, -50),
      marker(5, 60, -50),
    ]);
    const result = source(FAKE_FRAME, "a4");
    expect(result.cornersSeen).toBe(2);
    expect(result.cornersFound).toEqual([true, true, false, false]);
  });

  it("deduplicates a repeated id rather than counting it twice", () => {
    const source = createMarkerBasedQuadSource(() => [
      marker(0, 0, 0),
      marker(0, 1, 1),
      marker(1, 100, 0),
    ]);
    const result = source(FAKE_FRAME, "a4");
    expect(result.cornersSeen).toBe(2);
  });

  it("builds the full quad, ordered TL/TR/BR/BL, once all four ids are found", () => {
    const source = createMarkerBasedQuadSource(() => [
      marker(2, 100, 100),
      marker(0, 0, 0),
      marker(3, 0, 100),
      marker(1, 100, 0),
    ]);
    const result = source(FAKE_FRAME, "a4");
    expect(result.cornersSeen).toBe(4);
    expect(result.cornersFound).toEqual([true, true, true, true]);
    expect(result.corners).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
    expect(result.partialCorners).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
    expect(result.minSideCoverage).toBe(1);
  });

  it("ignores paperSize (temporary marker-based adapter has no notion of it)", () => {
    const source = createMarkerBasedQuadSource(() => [
      marker(0, 0, 0),
      marker(1, 100, 0),
      marker(2, 100, 100),
      marker(3, 0, 100),
    ]);
    expect(source(FAKE_FRAME, "a4")).toEqual(source(FAKE_FRAME, "letter"));
  });
});

describe("createPaperEdgeQuadSource", () => {
  const FULL_DETECTION = {
    corners: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
    cornersSeen: 4,
    cornersFound: [true, true, true, true],
    partialCorners: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
    minSideCoverage: 0.9,
    edgeFitResidualPx: 1.2,
  } as const;

  it("passes the detector's result straight through on success", () => {
    const source = createPaperEdgeQuadSource(() => FULL_DETECTION);
    expect(source(FAKE_FRAME, "a4")).toEqual(FULL_DETECTION);
  });

  it("passes the options (a focal length to assume) on to the detector, and none when none are given", () => {
    const seen: unknown[] = [];
    const source = createPaperEdgeQuadSource((_frame, _size, options) => {
      seen.push(options);
      return FULL_DETECTION;
    });
    source(FAKE_FRAME, "a4", { focalPxHint: 321 });
    source(FAKE_FRAME, "letter");
    expect(seen).toEqual([{ focalPxHint: 321 }, undefined]);
  });

  it("reports no corners found instead of crashing when the detector throws (live loop safety net)", () => {
    const source = createPaperEdgeQuadSource(() => {
      throw new RangeError("detectPaperQuad: unrecoverable side geometry.");
    });
    expect(source(FAKE_FRAME, "a4")).toEqual({
      corners: null,
      cornersSeen: 0,
      cornersFound: [false, false, false, false],
      partialCorners: [null, null, null, null],
      minSideCoverage: 0,
      edgeFitResidualPx: 0,
    });
  });

  it("passes paperSize through to the detector", () => {
    let seenPaperSize: string | undefined;
    const source = createPaperEdgeQuadSource((_, paperSize) => {
      seenPaperSize = paperSize;
      return FULL_DETECTION;
    });
    source(FAKE_FRAME, "letter");
    expect(seenPaperSize).toBe("letter");
  });
});
