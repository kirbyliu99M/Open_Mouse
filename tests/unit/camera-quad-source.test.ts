import { describe, expect, it } from "vitest";
import { createMarkerBasedQuadSource } from "../../src/client/camera/quad-source";
import type { DetectedMarker } from "../../src/client/photo/markers";

const FAKE_FRAME = { width: 640, height: 480, data: new Uint8ClampedArray(0) };

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
  it("reports cornersSeen 0 and null corners when nothing is detected", () => {
    const source = createMarkerBasedQuadSource(() => []);
    const result = source(FAKE_FRAME, "a4");
    expect(result).toEqual({
      corners: null,
      cornersSeen: 0,
      minSideCoverage: 0,
      edgeFitResidualPx: 0,
    });
  });

  it("reports a partial corner count without a quad", () => {
    const source = createMarkerBasedQuadSource(() => [
      marker(0, 0, 0),
      marker(1, 100, 0),
    ]);
    const result = source(FAKE_FRAME, "a4");
    expect(result.cornersSeen).toBe(2);
    expect(result.corners).toBeNull();
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
    expect(result.corners).toEqual([
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
