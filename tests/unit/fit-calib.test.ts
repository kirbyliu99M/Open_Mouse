import { describe, expect, it } from "vitest";
import {
  THUMB_REST_BASE_MM,
  THUMB_REST_ERGONOMIC_ADJUSTMENT_MM,
  THUMB_REST_WIDE_FROM_MM,
  THUMB_REST_WIDE_SLOPE,
} from "../../src/server/fit/coefficients";
import { computePriors } from "../../src/server/fit/priors";
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

describe("v1 targets are exactly computeTargets (the clamp was dropped)", () => {
  it("a large hand and a small hand are not pulled toward mid-size mice", () => {
    for (const [hand, grip] of [
      [{ handLengthMm: 205, palmLengthMm: 124, palmWidthMm: 88 }, "palm"],
      [{ handLengthMm: 165, palmLengthMm: 82, palmWidthMm: 66 }, "fingertip"],
    ] as const) {
      const r = scoreFitV1(
        hand,
        ladder,
        { includeVertical: false, gripStyle: grip },
        "right",
        computePriors(ladder),
      );
      expect(r.targets).toEqual(
        computeTargets(hand.handLengthMm, hand.palmWidthMm, grip),
      );
    }
  });
});

describe("v0 targets", () => {
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
    ]).toEqual([12, 1, 80]);
  });
  it("is -12 up to and at 80 mm", () => {
    expect(thumbRestAdjustmentMm(60)).toBe(-12);
    expect(thumbRestAdjustmentMm(80)).toBe(-12);
  });
  it("grows by 1 mm per mm above 80 (Spatha 89 is -21, M908 92 is -24)", () => {
    expect(thumbRestAdjustmentMm(89)).toBe(-21);
    expect(thumbRestAdjustmentMm(92)).toBe(-24);
  });
  it("feeds the effective width and the reason params", () => {
    const r = scoreGripWidthV1(ergo(89), 70);
    expect(r.reason.params.ergonomicThumbAdjMm).toBe(-21);
    expect(r.reason.params.effectiveWidthMm).toBe(68);
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
