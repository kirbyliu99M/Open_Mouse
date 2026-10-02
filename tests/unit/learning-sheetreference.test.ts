import { describe, expect, it } from "vitest";
import {
  applyHomography,
  type Point2,
} from "../../src/client/geometry/homography";
import type { DetectedMarker } from "../../src/client/photo/markers";
import {
  KIT_V2_MIN_MARKERS,
  buildSheetCorrespondences,
  markerReference,
  sheetReference,
} from "../../src/lib/learning/findings";
import { sheetAMarkers, sheetBMarkers } from "../../src/lib/learning/layoutv2";
import {
  buildSyntheticCamera,
  projectSheetMm,
  type SyntheticCamera,
} from "./helpers/synthetic-camera";

/** The A4 sheet's centre, so the synthetic camera (which looks at the origin) sees the whole page. */
const CENTRE = { x: 105, y: 148.5 };

const camera: SyntheticCamera = buildSyntheticCamera({
  tiltDeg: 12,
  distanceMm: 420,
  fPx: 3200,
});

const toImage = (p: Point2, cam: SyntheticCamera = camera) =>
  projectSheetMm(cam, { x: p.x - CENTRE.x, y: p.y - CENTRE.y });

/** Markers as the detector would return them: the printed corners, projected, with a deterministic jitter in px. */
function detected(
  ids: readonly number[],
  sheet: "A" | "B",
  jitterPx = 0,
  seed = 1,
): DetectedMarker[] {
  const layout = sheet === "A" ? sheetAMarkers() : sheetBMarkers();
  let state = seed;
  const noise = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return (state / 4294967296 - 0.5) * 2 * jitterPx;
  };
  return ids.map((id) => {
    const printed = layout.find((m) => m.id === id)!;
    const corners = printed.corners.map((c) => {
      const p = toImage(c);
      return { x: p.x + noise(), y: p.y + noise() };
    });
    return {
      id,
      corners: corners as unknown as DetectedMarker["corners"],
    };
  });
}

/** Points where a hand goes: wrist, knuckles, fingertips, the thumb side, a long hand's tip. */
const HAND_POINTS: readonly Point2[] = [
  { x: 105, y: 252 },
  { x: 105, y: 150 },
  { x: 105, y: 60 },
  { x: 60, y: 200 },
  { x: 150, y: 120 },
  { x: 70, y: 75 },
  { x: 140, y: 90 },
];

/** Worst distance, in mm, between each hand point and itself after image -> sheet through the reference. */
function worstHandError(ref: NonNullable<ReturnType<typeof sheetReference>>) {
  return Math.max(
    ...HAND_POINTS.map((p) => {
      const back = applyHomography(ref.homography, toImage(p));
      return Math.hypot(back.x - p.x, back.y - p.y);
    }),
  );
}

const ALL_B = [0, 1, 2, 3, 4, 5];

function subsets(ids: readonly number[], size: number): number[][] {
  if (size === 0) return [[]];
  if (ids.length < size) return [];
  const [first, ...rest] = ids;
  return [
    ...subsets(rest, size - 1).map((s) => [first!, ...s]),
    ...subsets(rest, size),
  ];
}

describe("sheet B: the plane from any four or more of its six markers", () => {
  it("needs four", () => {
    expect(KIT_V2_MIN_MARKERS).toBe(4);
  });

  it("all six markers: an exact plane", () => {
    const ref = sheetReference(detected(ALL_B, "B"), "B")!;
    expect(ref).not.toBeNull();
    expect(ref.method).toBe("markers");
    expect(ref.reprojectionErrorMm).toBeLessThan(1e-6);
    expect(worstHandError(ref)).toBeLessThan(1e-6);
  });

  it.each(subsets(ALL_B, 5).map((s) => [s.join(",")]))(
    "five markers (%s): an exact plane",
    (key) => {
      const ids = key!.split(",").map(Number);
      expect(ids).toHaveLength(5);
      const ref = sheetReference(detected(ids, "B"), "B")!;
      expect(ref).not.toBeNull();
      expect(ref.reprojectionErrorMm).toBeLessThan(1e-6);
      expect(worstHandError(ref)).toBeLessThan(1e-6);
    },
  );

  it.each(subsets(ALL_B, 4).map((s) => [s.join(",")]))(
    "four markers (%s): an exact plane",
    (key) => {
      const ids = key!.split(",").map(Number);
      expect(ids).toHaveLength(4);
      const ref = sheetReference(detected(ids, "B"), "B")!;
      expect(ref).not.toBeNull();
      expect(ref.reprojectionErrorMm).toBeLessThan(1e-6);
      // All four rows of a hand: the plane recovered to a millionth of a mm.
      expect(worstHandError(ref)).toBeLessThan(1e-4);
    },
  );

  it("fewer than four markers give no plane", () => {
    for (const size of [0, 1, 2, 3]) {
      for (const ids of subsets(ALL_B, size)) {
        expect(sheetReference(detected(ids, "B"), "B")).toBeNull();
      }
    }
  });

  it("ignores markers that are not on the sheet, and a second marker with an id already seen", () => {
    const real = detected(ALL_B, "B");
    // Two foreign ids, and a copy of marker 0 with wild corners after the real one.
    const foreign: DetectedMarker[] = [
      { id: 6, corners: real[0]!.corners },
      { id: 63, corners: real[1]!.corners },
    ];
    const wild: DetectedMarker = {
      id: 0,
      corners: [
        { x: 1, y: 1 },
        { x: 9, y: 1 },
        { x: 9, y: 9 },
        { x: 1, y: 9 },
      ],
    };
    const ref = sheetReference([...foreign, ...real, wild], "B")!;
    expect(ref.reprojectionErrorMm).toBeLessThan(1e-6);
    // Only foreign ids and nothing else: not enough.
    expect(sheetReference(foreign, "B")).toBeNull();
  });

  it("with a little detector noise, six markers fit the hand area within a small fraction of a mm", () => {
    const worst = [1, 2, 3, 4, 5].map((seed) =>
      worstHandError(sheetReference(detected(ALL_B, "B", 0.4, seed), "B")!),
    );
    expect(Math.max(...worst)).toBeLessThan(0.3);
  });

  it("four markers in one row (the bottom four) fit their own corners but extrapolate worse over the hand than four spread over the page", () => {
    const meanError = (ids: readonly number[]) => {
      const errors = Array.from({ length: 20 }, (_, i) =>
        worstHandError(sheetReference(detected(ids, "B", 0.4, i + 1), "B")!),
      );
      return errors.reduce((a, b) => a + b, 0) / errors.length;
    };
    const bottom = meanError([2, 3, 4, 5]);
    const spread = meanError([0, 1, 2, 3]);
    expect(bottom).toBeGreaterThan(spread);
  });
});

describe("buildSheetCorrespondences", () => {
  it("makes four corner pairs for each printed marker found, in layout order, and names the ones it did not find", () => {
    const layout = sheetBMarkers();
    const found = detected([5, 1, 3], "B");
    const out = buildSheetCorrespondences(found, layout);
    expect(out.usedIds).toEqual([1, 3, 5]);
    expect(out.missingIds).toEqual([0, 2, 4]);
    expect(out.correspondences).toHaveLength(12);
    // Marker 1's corners come first, matched to its printed corners.
    const m1 = layout.find((m) => m.id === 1)!;
    out.correspondences.slice(0, 4).forEach((c, i) => {
      expect(c.dst).toEqual(m1.corners[i]);
    });
  });
});

describe("sheet A: the product sheet's four markers", () => {
  const A_IDS = [0, 1, 2, 3];

  it("builds the same plane as the kit v1 marker reference does from the same markers", () => {
    const markers = detected(A_IDS, "A");
    const v1 = markerReference(markers)!;
    const v2 = sheetReference(markers, "A")!;
    expect(v2.method).toBe("markers");
    expect(v2.reprojectionErrorMm).toBeCloseTo(v1.reprojectionErrorMm!, 9);
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++)
        expect(v2.homography[r]![c]).toBeCloseTo(v1.homography[r]![c]!, 9);
    expect(worstHandError(v2)).toBeLessThan(1e-6);
  });

  it("needs all four: three give no plane", () => {
    for (const ids of subsets(A_IDS, 3)) {
      expect(sheetReference(detected(ids, "A"), "A")).toBeNull();
    }
  });

  it("does not count the upright-flap ids 4 and 5", () => {
    const four = detected(A_IDS, "A");
    const extra: DetectedMarker[] = detected(A_IDS, "A").map((m, i) => ({
      ...m,
      id: 4 + i,
    }));
    expect(sheetReference([...four.slice(0, 3), ...extra], "A")).toBeNull();
  });
});
