import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ARTIFACT_PATHS } from "@/lib/particles/artifacts";
import {
  LOGO_BOX,
  LOGO_PAGE,
  LOGO_SAMPLING,
  LOGO_SCALE,
  sampleLogoPoints,
} from "@/lib/particles/logo";
import { renderLogoSvg } from "@/lib/particles/static-svg";
import { parsePathData } from "@/lib/particles/svg-path";
import { LOGO_EDGE } from "../e2e/helpers/logo-fit";

/**
 * The static Palmate mark (the <img> the hero shows first) against the
 * particle logo that takes its place: per edge, how far the image's ink
 * reaches past the outer box of the particle centres, both in the logo box's
 * own px (the target's), signed, + outwards. The e2e suite measures the
 * canvas's ink against that same box (`LOGO_EDGE`, tests/e2e/helpers/logo-fit.ts)
 * but no longer the static image's, so this is where the image is held to
 * the particles.
 *
 * That the committed SVG is exactly `renderLogoSvg()` (the committed outputs
 * test) and that `renderLogoSvg()` writes `LOGO_VIEWBOX`, `LOGO_STROKE.width`
 * and `PALMATE_PATH` (the static SVGs test), both in particles-targets.test.ts,
 * is not repeated here. This test reads the viewBox, the stroke width and the
 * path from the SVG text itself, so a hand edit to the file, or a change to
 * the constants it is made from, shows up as the edges it moves.
 */

/**
 * The band every edge must sit in, viewBox units (times `LOGO_SCALE`, 3, for
 * the target's px).
 *
 * Measured 2026-10-10 on the B3 cloud with the 1.4-unit stroke, left / top /
 * right / bottom: +0.125, -0.058, -0.268, -0.349 units (+0.38, -0.18, -0.80,
 * -1.05 target px). The ink is the path's box plus half the stroke (0.7)
 * every way; the cloud's outermost centres are 0.57, 0.76, 0.97 and 1.05
 * units past the path's box, so the image is a little inside the particles
 * at the top, the right and the bottom, and a little outside them at the
 * left. With the 2-unit stroke it had before BRAND-2 every edge was 0.3 units
 * further out: +0.425, +0.242, +0.032, -0.049.
 *
 * The band is that measured spread, -0.349 to +0.125, widened by 0.1 units
 * (0.3 target px) each way. 0.1 is a third of what BRAND-2's stroke change
 * moved each edge and six times the largest error in the measurement (the
 * path's curves flattened to chords put its box up to 0.017 units inside the
 * true one, at the top; the JSON the e2e suite reads rounds a point by 0.017
 * units at most). So the old 2-unit stroke fails (its left edge, +0.425), as
 * does any stroke over 1.65 units or under 1.2, and a viewBox moved 0.13 to
 * 0.52 units sideways or 0.10 to 0.39 up or down (which, depending on the
 * direction; a whole unit fails any way).
 *
 * Against the e2e suite's `LOGO_EDGE` (-2.5 to 3.5 CSS px, the canvas's ink
 * past the same centres): drawn at the home page's largest logo (the desktop
 * image, 355.2 CSS px tall, 1.716 CSS px a target px) this band is -2.32 to
 * +1.29 CSS px, and at the smallest (a phone's, 181.4 px, 0.876) -1.18 to
 * +0.66, both inside `LOGO_EDGE`; the last test below checks that. It is
 * tighter than `LOGO_EDGE` on purpose: the image has no glow and no random
 * stars, so its edges do not wander from window to window, and `LOGO_EDGE`
 * (wide enough for the canvas) would let the 2-unit stroke through.
 */
const STATIC_EDGE = { low: -0.45, high: 0.25 } as const;

type Box = { x0: number; y0: number; x1: number; y1: number };
type Edges = { left: number; top: number; right: number; bottom: number };

/** An attribute of one tag, double or single quoted. */
const attrOf = (tag: string, name: string): string | undefined => {
  const found = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(
    tag,
  );
  return found?.[1] ?? found?.[2];
};

/**
 * The hand's ink in an SVG of the mark, in the target's px, placed as the
 * page places it: the image's rect has the logo box's shape (the <img> is
 * 65 x 69, the stage fits `LOGO_BOX` to its rect, contain, centred), and the
 * SVG is drawn into it by its own viewBox, `xMidYMid meet` (no
 * preserveAspectRatio, which is checked). A stroke with round caps and round
 * joins covers exactly the points within half its width of the path, so the
 * ink's box is the path's box widened by half the stroke every way.
 */
function staticInk(svg: string): { box: Box; strokeWidth: number } {
  const root = /<svg\b[^>]*>/.exec(svg)![0];
  const paths = [...svg.matchAll(/<path\b[^>]*>/g)].map((m) => m[0]);
  expect(paths).toHaveLength(1);
  const path = paths[0]!;
  const read = (name: string) => attrOf(path, name) ?? attrOf(root, name);
  expect(read("stroke-linecap")).toBe("round");
  expect(read("stroke-linejoin")).toBe("round");
  expect(attrOf(root, "preserveAspectRatio")).toBeUndefined();
  const strokeWidth = Number(read("stroke-width"));
  const [vx, vy, vw, vh] = attrOf(root, "viewBox")!
    .trim()
    .split(/[\s,]+/)
    .map(Number) as [number, number, number, number];

  const points = parsePathData(attrOf(path, "d")!).flatMap((p) => p.points);
  const half = strokeWidth / 2;
  const units = {
    x0: Math.min(...points.map((p) => p[0])) - half,
    y0: Math.min(...points.map((p) => p[1])) - half,
    x1: Math.max(...points.map((p) => p[0])) + half,
    y1: Math.max(...points.map((p) => p[1])) + half,
  };
  const scale = Math.min(LOGO_BOX.width / vw, LOGO_BOX.height / vh);
  const offsetX = (LOGO_BOX.width - vw * scale) / 2;
  const offsetY = (LOGO_BOX.height - vh * scale) / 2;
  return {
    strokeWidth,
    box: {
      x0: offsetX + (units.x0 - vx) * scale,
      y0: offsetY + (units.y0 - vy) * scale,
      x1: offsetX + (units.x1 - vx) * scale,
      y1: offsetY + (units.y1 - vy) * scale,
    },
  };
}

const boxOf = (points: readonly { x: number; y: number }[]): Box => ({
  x0: Math.min(...points.map((p) => p.x)),
  y0: Math.min(...points.map((p) => p.y)),
  x1: Math.max(...points.map((p) => p.x)),
  y1: Math.max(...points.map((p) => p.y)),
});

/** How far `ink` reaches past `reach`, per edge, in viewBox units (+ outwards). */
const pastUnits = (ink: Box, reach: Box): Edges => ({
  left: (reach.x0 - ink.x0) / LOGO_SCALE,
  top: (reach.y0 - ink.y0) / LOGO_SCALE,
  right: (ink.x1 - reach.x1) / LOGO_SCALE,
  bottom: (ink.y1 - reach.y1) / LOGO_SCALE,
});

describe("the static Palmate mark against its particles", () => {
  const { points, runs } = sampleLogoPoints();
  // The runs, in order: the four lines, the dot's points, the strays.
  const dotCount = LOGO_SAMPLING.dotCore + LOGO_SAMPLING.dotRing;
  const lines = runs
    .slice(0, 4)
    .flatMap((run) => points.slice(run.start, run.start + run.count));
  const dot = runs.slice(4, 4 + dotCount).map((run) => points[run.start]!);
  /** The particle centres' outer box: the hand's four lines only. */
  const reach = boxOf(lines);

  it("measures against the box the e2e suite's reach is: the dot is inside the lines' box, so the mark's box is theirs", () => {
    expect(lines).toHaveLength(LOGO_SAMPLING.particles);
    expect(dot).toHaveLength(dotCount);
    // home-stage.ts takes every run but the strays (the lines and the dot).
    expect(boxOf([...lines, ...dot])).toEqual(reach);
  });

  const sources = [
    ["the committed SVG", readFileSync(ARTIFACT_PATHS.logo, "utf8")],
    ["renderLogoSvg()", renderLogoSvg()],
  ] as const;

  it.each(sources)(
    "%s: every edge of the hand's ink within -0.45 to +0.25 units of the particle centres' outer box",
    (_, svg) => {
      const { box, strokeWidth } = staticInk(svg);
      const past = pastUnits(box, reach);
      const report = Object.entries(past)
        .map(
          ([edge, u]) =>
            `${edge} ${u.toFixed(3)} u (${(u * LOGO_SCALE).toFixed(2)} px)`,
        )
        .join(", ");
      for (const [edge, value] of Object.entries(past)) {
        expect(
          value,
          `${edge} (stroke ${strokeWidth}; ${report})`,
        ).toBeGreaterThanOrEqual(STATIC_EDGE.low);
        expect(
          value,
          `${edge} (stroke ${strokeWidth}; ${report})`,
        ).toBeLessThanOrEqual(STATIC_EDGE.high);
      }
    },
  );

  it("keeps the band inside the e2e suite's LOGO_EDGE at the largest and the smallest logo the page draws", () => {
    const p = LOGO_PAGE;
    // CSS px of image height: the desktop's at its full slot, a phone's at its floor.
    const largest = p.desktopSlotRem.max * p.rem * p.desktopImage;
    const smallest = p.phoneSlotRem.min * p.rem * p.phoneImage;
    for (const imagePx of [largest, smallest]) {
      const cssPerUnit = (imagePx / LOGO_BOX.height) * LOGO_SCALE;
      expect(STATIC_EDGE.low * cssPerUnit).toBeGreaterThanOrEqual(
        LOGO_EDGE.low,
      );
      expect(STATIC_EDGE.high * cssPerUnit).toBeLessThanOrEqual(LOGO_EDGE.high);
    }
  });
});
