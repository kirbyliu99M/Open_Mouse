import { describe, expect, it } from "vitest";
import {
  TARGET_BOUND_PERCENTILES,
  THUMB_REST_BASE_MM,
  THUMB_REST_ERGONOMIC_ADJUSTMENT_MM,
  THUMB_REST_WIDE_FROM_MM,
  THUMB_REST_WIDE_SLOPE,
} from "../../src/server/fit/coefficients";
import {
  clampTargets,
  computePriors,
  computeTargetBounds,
  percentile,
} from "../../src/server/fit/priors";
import { scoreFit } from "../../src/server/fit/score";
import { scoreFitV1 } from "../../src/server/fit/score-v1";
import { scoreGripWidth } from "../../src/server/fit/subscores";
import {
  scoreGripWidthV1,
  thumbRestAdjustmentMm,
} from "../../src/server/fit/subscores-v1";
import { computeTargets } from "../../src/server/fit/targets";
import type { CatalogueMouse } from "../../src/server/fit/types";

const base: CatalogueMouse = {
  slug: "acme-alpha",
  brand: "Acme",
  model: "Alpha",
  lengthMm: 118,
  widthMm: 66,
  heightMm: 38,
  weightG: 80,
  size: "medium",
  handCompatibility: null,
  shape: null,
  humpPlacement: null,
  frontFlare: null,
  sideCurvature: null,
  thumbRest: null,
  ringFingerRest: null,
};
const mouse = (patch: Partial<CatalogueMouse>): CatalogueMouse => ({
  ...base,
  ...patch,
});

/** 21 standard mice: length 100..120, width 60..80, height 30..50, one mm apart. */
const ladder = Array.from({ length: 21 }, (_, i) =>
  mouse({
    slug: `m${i}`,
    model: `M${i}`,
    lengthMm: 100 + i,
    widthMm: 60 + i,
    heightMm: 30 + i,
  }),
);

describe("percentile (linear interpolation, type 7)", () => {
  it("returns null for an empty list and the value itself for one", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([7], 5)).toBe(7);
    expect(percentile([7], 95)).toBe(7);
  });
  it("hits the extremes at 0 and 100 and the median at 50", () => {
    expect(percentile([1, 2, 3, 4], 0)).toBe(1);
    expect(percentile([1, 2, 3, 4], 100)).toBe(4);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
  });
  it("interpolates between ranks and ignores the input order", () => {
    // 21 values: rank = 0.05 * 20 = 1, exactly the second value.
    expect(percentile(ladder.map((m) => m.lengthMm).reverse(), 5)).toBe(101);
    // [1, 2, 3, 4]: rank = 0.95 * 3 = 2.85, so 3 + 0.85 * (4 - 3).
    expect(percentile([4, 1, 3, 2], 95)).toBeCloseTo(3.85, 10);
  });
  it("clamps p outside 0..100", () => {
    expect(percentile([1, 2, 3], -5)).toBe(1);
    expect(percentile([1, 2, 3], 120)).toBe(3);
  });
});

describe("computeTargetBounds", () => {
  it("uses the 5th and 95th percentile of each dimension", () => {
    expect(TARGET_BOUND_PERCENTILES).toEqual({ low: 5, high: 95 });
    expect(computeTargetBounds(ladder)).toEqual({
      lengthMm: { low: 101, high: 119 },
      gripWidthMm: { low: 61, high: 79 },
      heightMm: { low: 31, high: 49 },
    });
  });
  it("leaves out vertical, trackball and tall-for-length rows", () => {
    const extremes = [
      mouse({ slug: "v", formFactor: "vertical", lengthMm: 500 }),
      mouse({ slug: "t", formFactor: "trackball", lengthMm: 1 }),
      mouse({ slug: "tall", lengthMm: 100, heightMm: 60 }),
    ];
    expect(computeTargetBounds([...ladder, ...extremes])).toEqual(
      computeTargetBounds(ladder),
    );
  });
  it("is null for an empty or one-row catalogue, and priors carry it", () => {
    expect(computeTargetBounds([])).toBeNull();
    expect(computeTargetBounds([base])).toBeNull();
    expect(computePriors([]).targetBounds).toBeNull();
    expect(computePriors(ladder).targetBounds).toEqual(
      computeTargetBounds(ladder),
    );
  });
  it("a catalogue of only non-standard mice has no bounds", () => {
    expect(
      computeTargetBounds([
        mouse({ formFactor: "vertical" }),
        mouse({ slug: "b", formFactor: "trackball" }),
      ]),
    ).toBeNull();
  });
});

describe("clampTargets", () => {
  const bounds = computeTargetBounds(ladder);
  it("raises a target below, keeps one inside, lowers one above", () => {
    expect(
      clampTargets({ lengthMm: 90, gripWidthMm: 70, heightMm: 99 }, bounds),
    ).toEqual({ lengthMm: 101, gripWidthMm: 70, heightMm: 49 });
  });
  it("leaves the targets alone without bounds", () => {
    const t = { lengthMm: 90, gripWidthMm: 70, heightMm: 99 };
    expect(clampTargets(t, null)).toBe(t);
  });
});

describe("scoreFitV1 reports the clamped targets", () => {
  const large = { handLengthMm: 205, palmLengthMm: 124, palmWidthMm: 88 };
  const prefs = { includeVertical: false, gripStyle: "palm" } as const;
  it("clamps a large hand to the catalogue and reports it in targets", () => {
    expect(computeTargets(205, 88, "palm").lengthMm).toBeGreaterThan(119);
    const r = scoreFitV1(large, ladder, prefs, "right", computePriors(ladder));
    // Only the length is above its bound; width and height are inside theirs.
    const raw = computeTargets(205, 88, "palm");
    expect(r.targets).toEqual({
      lengthMm: 119,
      gripWidthMm: raw.gripWidthMm,
      heightMm: raw.heightMm,
    });
  });
  it("clamps from below too (a small fingertip hand)", () => {
    const small = { handLengthMm: 165, palmLengthMm: 82, palmWidthMm: 66 };
    const r = scoreFitV1(
      small,
      ladder,
      { includeVertical: false, gripStyle: "fingertip" },
      "right",
      computePriors(ladder),
    );
    expect(r.targets.lengthMm).toBeGreaterThanOrEqual(101);
    expect(r.targets.heightMm).toBeGreaterThanOrEqual(31);
  });
  it("a hand inside the bounds is not moved", () => {
    const mid = { handLengthMm: 160, palmLengthMm: 88, palmWidthMm: 70 };
    const r = scoreFitV1(mid, ladder, prefs, "right", computePriors(ladder));
    expect(r.targets).toEqual(computeTargets(160, 70, "palm"));
  });
  it("an empty or one-row catalogue does not crash and does not clamp", () => {
    for (const cat of [[], [base]]) {
      const r = scoreFitV1(large, cat, prefs, "right", computePriors(cat));
      expect(r.targets).toEqual(computeTargets(205, 88, "palm"));
      expect(r.results.length).toBe(cat.length);
    }
  });
});

describe("v0 does not clamp", () => {
  it("scoreFit still reports the raw large-hand targets", () => {
    const r = scoreFit(
      { handLengthMm: 205, palmLengthMm: 124, palmWidthMm: 88 },
      ladder,
      { includeVertical: false, gripStyle: "palm" },
      "right",
    );
    expect(r.targets).toEqual(computeTargets(205, 88, "palm"));
    expect(r.engineVersion).toBe("fit-v0-provisional");
  });
});

describe("width-aware thumb-rest adjustment (v1)", () => {
  const ergo = (widthMm: number) =>
    mouse({
      widthMm,
      shape: "ergonomic",
      thumbRest: true,
      sideCurvature: "flat",
    });

  it("candidate constants", () => {
    expect([
      THUMB_REST_BASE_MM,
      THUMB_REST_WIDE_SLOPE,
      THUMB_REST_WIDE_FROM_MM,
    ]).toEqual([12, 0.5, 80]);
  });
  it("is -12 up to and at 80 mm", () => {
    expect(thumbRestAdjustmentMm(60)).toBe(-12);
    expect(thumbRestAdjustmentMm(80)).toBe(-12);
  });
  it("grows by 0.5 mm per mm above 80 (Spatha 89 is -16.5, M908 92 is -18)", () => {
    expect(thumbRestAdjustmentMm(89)).toBe(-16.5);
    expect(thumbRestAdjustmentMm(92)).toBe(-18);
  });
  it("feeds the effective width and the reason params", () => {
    const r = scoreGripWidthV1(ergo(89), 70);
    expect(r.reason.params.ergonomicThumbAdjMm).toBe(-16.5);
    expect(r.reason.params.effectiveWidthMm).toBe(72.5);
    const below = scoreGripWidthV1(ergo(78), 70);
    expect(below.reason.params.ergonomicThumbAdjMm).toBe(-12);
  });
  it.each([
    ["symmetrical", { shape: "symmetrical", thumbRest: true }],
    [
      "ergonomic without a thumb rest",
      { shape: "ergonomic", thumbRest: false },
    ],
    ["ergonomic, thumb rest unknown", { shape: "ergonomic", thumbRest: null }],
  ] as const)("%s: no adjustment, however wide", (_n, patch) => {
    const r = scoreGripWidthV1(mouse({ widthMm: 92, ...patch }), 70);
    expect(r.reason.params.ergonomicThumbAdjMm).toBe(0);
    expect(r.reason.params.effectiveWidthMm).toBe(92);
  });
  it("v0 keeps the fixed -12 at any width", () => {
    expect(THUMB_REST_ERGONOMIC_ADJUSTMENT_MM).toBe(-12);
    const r = scoreGripWidth(ergo(92), 70);
    expect(r.reason.params.ergonomicThumbAdjMm).toBe(-12);
  });
});
