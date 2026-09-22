import { describe, expect, it } from "vitest";
import {
  buildMarkerCorrespondences,
  type DetectedMarker,
} from "../../src/client/photo/markers";
import { computeSheetLayout } from "../../src/client/sheet/layout";

// A synthetic detection: pretend every marker's image-px corners equal its
// known sheet-mm corners plus a fixed per-marker offset. That makes it
// trivial to assert each correspondence pairs the RIGHT marker's corners,
// not just any 16 points.
function fakeDetection(
  layout: ReturnType<typeof computeSheetLayout>,
  ids: readonly number[],
): DetectedMarker[] {
  return ids.map((id) => {
    const marker = layout.markers.find((m) => m.id === id);
    if (!marker) throw new Error(`no layout marker ${id}`);
    const offset = id * 1000; // keeps each marker's src points distinguishable
    return {
      id,
      corners: marker.corners.map((c) => ({
        x: c.x + offset,
        y: c.y + offset,
      })) as unknown as DetectedMarker["corners"],
    };
  });
}

describe("buildMarkerCorrespondences", () => {
  const layout = computeSheetLayout();

  it("builds all 16 correspondences (4 markers x 4 corners) when all four are found", () => {
    const detected = fakeDetection(layout, [0, 1, 2, 3]);
    const result = buildMarkerCorrespondences(detected, layout);
    expect(result.missingIds).toEqual([]);
    expect(result.duplicateIds).toEqual([]);
    expect(result.correspondences).toHaveLength(16);
  });

  it("pairs each marker's src corners with ITS OWN layout dst corners, in order", () => {
    const detected = fakeDetection(layout, [0, 1, 2, 3]);
    const result = buildMarkerCorrespondences(detected, layout);
    const marker2Layout = layout.markers.find((m) => m.id === 2)!;
    const marker2Correspondences = result.correspondences.filter(
      (c) => c.src.x - 2000 === c.dst.x, // offset trick: only marker 2's src has +2000
    );
    expect(marker2Correspondences).toHaveLength(4);
    marker2Correspondences.forEach((c, i) => {
      // src was dst + offset, so subtracting the offset recovers dst exactly,
      // and it must match the layout's own corner order (not shuffled).
      expect(c.src.x - 2000).toBeCloseTo(marker2Layout.corners[i].x, 9);
      expect(c.src.y - 2000).toBeCloseTo(marker2Layout.corners[i].y, 9);
      expect(c.dst).toEqual(marker2Layout.corners[i]);
    });
  });

  it("reports missing ids when fewer than 4 flat markers are found", () => {
    const detected = fakeDetection(layout, [0, 2, 3]);
    const result = buildMarkerCorrespondences(detected, layout);
    expect(result.missingIds).toEqual([1]);
    expect(result.correspondences).toHaveLength(12);
  });

  it("reports all four missing when none are found", () => {
    const result = buildMarkerCorrespondences([], layout);
    expect(result.missingIds).toEqual([0, 1, 2, 3]);
    expect(result.correspondences).toEqual([]);
  });

  it("ignores upright-flap markers (ids 4, 5) entirely", () => {
    const detected = [
      ...fakeDetection(layout, [0, 1, 2, 3]),
      ...fakeDetection(layout, [4, 5]),
    ];
    const result = buildMarkerCorrespondences(detected, layout);
    expect(result.correspondences).toHaveLength(16);
    expect(result.missingIds).toEqual([]);
  });

  it("keeps the first occurrence and reports duplicates", () => {
    const detected = fakeDetection(layout, [0, 1, 2, 3, 1]);
    const result = buildMarkerCorrespondences(detected, layout);
    expect(result.duplicateIds).toEqual([1]);
    expect(result.correspondences).toHaveLength(16);
  });
});
