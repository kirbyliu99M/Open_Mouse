import { describe, expect, it } from "vitest";
import {
  LOGO_EDGE,
  LOGO_TOP_LEFT_SHARE,
  type LogoFit,
  logoOffMark,
} from "../e2e/helpers/logo-fit";

/** A logo on its mark: every edge a pixel out, the hand the right way round (the middle of what was measured). */
const onMark: LogoFit = {
  fit: { left: 1, top: 1, right: 1, bottom: 1 },
  topLeftShare: 1.29,
  empty: false,
};
const withEdge = (edge: keyof LogoFit["fit"], value: number): LogoFit => ({
  ...onMark,
  fit: { ...onMark.fit, [edge]: value },
});

describe("logoOffMark (the e2e suite's judgement of the particle logo)", () => {
  it("finds nothing wrong with a logo on its mark, edges on the band's ends included", () => {
    expect(logoOffMark(onMark)).toEqual([]);
    for (const edge of ["left", "top", "right", "bottom"] as const) {
      expect(logoOffMark(withEdge(edge, LOGO_EDGE.low))).toEqual([]);
      expect(logoOffMark(withEdge(edge, LOGO_EDGE.high))).toEqual([]);
    }
    expect(
      logoOffMark({ ...onMark, topLeftShare: LOGO_TOP_LEFT_SHARE }),
    ).toEqual([]);
  });

  it("names each edge that is out, on either side, and only that edge", () => {
    for (const edge of ["left", "top", "right", "bottom"] as const) {
      expect(logoOffMark(withEdge(edge, LOGO_EDGE.low - 0.01))).toEqual([
        `${edge} ${(LOGO_EDGE.low - 0.01).toFixed(2)}`,
      ]);
      expect(logoOffMark(withEdge(edge, LOGO_EDGE.high + 0.01))).toEqual([
        `${edge} ${(LOGO_EDGE.high + 0.01).toFixed(2)}`,
      ]);
    }
    // A logo drawn small: every edge inwards.
    expect(
      logoOffMark({
        ...onMark,
        fit: { left: -6, top: -6, right: -6, bottom: -6 },
      }),
    ).toEqual(["left -6.00", "top -6.00", "right -6.00", "bottom -6.00"]);
    // Moved sideways: one edge out, the other in.
    expect(
      logoOffMark({ ...onMark, fit: { ...onMark.fit, left: -3, right: 5 } }),
    ).toEqual(["left -3.00", "right 5.00"]);
  });

  it("counts a number that is not one as out (NaN, infinite)", () => {
    expect(logoOffMark(withEdge("top", Number.NaN))).toEqual(["top NaN"]);
    expect(logoOffMark(withEdge("right", Infinity))).toEqual([
      "right Infinity",
    ]);
    expect(logoOffMark({ ...onMark, topLeftShare: Number.NaN })).toEqual([
      "top left/right NaN",
    ]);
  });

  it("tells a mirror image: the top half heavier on the right", () => {
    expect(logoOffMark({ ...onMark, topLeftShare: 1 / 1.29 })).toEqual([
      `top left/right ${(1 / 1.29).toFixed(3)}`,
    ]);
    expect(
      logoOffMark({ ...onMark, topLeftShare: LOGO_TOP_LEFT_SHARE - 0.001 }),
    ).toHaveLength(1);
  });

  it("says when nothing was drawn (an empty canvas: no edges to speak of)", () => {
    const empty: LogoFit = {
      fit: {
        left: Number.NaN,
        top: Number.NaN,
        right: Number.NaN,
        bottom: Number.NaN,
      },
      topLeftShare: Number.NaN,
      empty: true,
    };
    const problems = logoOffMark(empty);
    expect(problems[0]).toBe("no logo drawn");
    expect(problems).toHaveLength(6);
    // Drawn but flagged empty (the reference image did not load) is still a problem.
    expect(logoOffMark({ ...onMark, empty: true })).toEqual(["no logo drawn"]);
  });

  it("keeps the band past what was measured (-0.4 to 2.2 px) and the mirror bound between a mirror's share (0.98 at most) and the hand's own (1.12 at least)", () => {
    expect(LOGO_EDGE.low).toBeLessThan(-0.4 - 1);
    expect(LOGO_EDGE.high).toBeGreaterThan(2.2 + 1);
    expect(LOGO_EDGE.high - LOGO_EDGE.low).toBeLessThanOrEqual(6);
    expect(LOGO_TOP_LEFT_SHARE).toBeGreaterThan(0.98 + 0.05);
    expect(LOGO_TOP_LEFT_SHARE).toBeLessThan(1.12 - 0.05);
  });
});
