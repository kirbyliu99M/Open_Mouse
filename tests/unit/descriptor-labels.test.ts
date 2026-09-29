import { describe, expect, it } from "vitest";
import {
  CONNECTIVITY,
  CONNECTIVITY_LABELS,
  FORM_FACTORS,
  FORM_FACTOR_LABELS,
  FRONT_FLARES,
  FRONT_FLARE_LABELS,
  HAND_COMPATIBILITY,
  HAND_COMPATIBILITY_LABELS,
  HUMP_PLACEMENTS,
  HUMP_PLACEMENT_LABELS,
  SHAPES,
  SHAPE_LABELS,
  SIDE_CURVATURES,
  SIDE_CURVATURE_LABELS,
  SIZES,
  SIZE_LABELS,
} from "../../src/lib/contracts/descriptors";

const MAPS: [string, readonly string[], Readonly<Record<string, string>>][] = [
  ["size", SIZES, SIZE_LABELS],
  ["shape", SHAPES, SHAPE_LABELS],
  ["hand compatibility", HAND_COMPATIBILITY, HAND_COMPATIBILITY_LABELS],
  ["hump placement", HUMP_PLACEMENTS, HUMP_PLACEMENT_LABELS],
  ["front flare", FRONT_FLARES, FRONT_FLARE_LABELS],
  ["side curvature", SIDE_CURVATURES, SIDE_CURVATURE_LABELS],
  ["connectivity", CONNECTIVITY, CONNECTIVITY_LABELS],
  ["form factor", FORM_FACTORS, FORM_FACTOR_LABELS],
];

describe("descriptor label maps", () => {
  it.each(MAPS)(
    "%s has exactly one non-empty label per value",
    (_name, values, labels) => {
      expect(Object.keys(labels).sort()).toEqual([...values].sort());
      for (const value of values) expect(labels[value]?.trim()).toBeTruthy();
    },
  );

  // Front flare and side curvature share three slugs. Separate maps are what
  // let a translation word them differently (內收/外擴 vs 內凹/外凸).
  it("keeps front flare and side curvature in separate maps", () => {
    const shared = FRONT_FLARES.filter((v) =>
      (SIDE_CURVATURES as readonly string[]).includes(v),
    );
    expect(shared).toEqual(["inward_aggressive", "flat", "outward_aggressive"]);
    expect(FRONT_FLARE_LABELS).not.toBe(SIDE_CURVATURE_LABELS);
  });
});
