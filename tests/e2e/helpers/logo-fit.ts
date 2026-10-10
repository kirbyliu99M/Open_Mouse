/**
 * The judgement of the home page's particle logo against its target, kept
 * apart from the page code (`logoInk` in home-stage.ts measures it) so a unit
 * test can check it: plain numbers in, a list of problems out.
 */

/**
 * How far past the particle centres' outer box (the target's mark points,
 * placed where the stage puts them: the image's rect, fitted and centred) the
 * canvas's logo may reach, per edge, in CSS px, signed: + is outwards. An
 * edge's ink is its outermost lit star's centre plus what of the star is over
 * alpha 120, less how far inside the outermost target point that star is (the
 * stars are a fraction of the particles).
 *
 * Measured with `logoInk` (2026-10-10, headless Chromium on Kirby's machine,
 * after the shimmer, at p = 0) on the 840-point cloud (variant B), left / top
 * / right / bottom; the windows at pixel ratio 1, then the mobile project's
 * Pixel 7 (412x915, pixel ratio 2.625):
 *
 *   window      WebGL              Canvas 2D
 *   360x800     1.0 1.5 2.1 0.8    1.0 0.5 1.1 0.8
 *   375x667     1.6 1.2 1.7 0.7    1.6 0.2 0.7 0.7
 *   390x844     0.8 1.3 1.5 1.4    0.8 0.3 0.5 1.4
 *   412x915     1.0 1.5 1.8 0.6    0.0 1.5 0.8 0.6
 *   430x932     0.3 1.8 2.1 0.6    0.3 0.8 1.1 0.6
 *   768x1024    1.7 0.9 1.1 1.6    0.7 0.9 0.1 2.6
 *   1280x600    0.8 1.1 1.5 0.7    0.8 1.1 1.5 1.7
 *   1280x640    0.4 0.6 1.1 0.7    0.4 0.6 1.1 1.7
 *   1280x720    0.7 0.9 1.1 1.6    0.7 0.9 0.1 2.6
 *   1280x800    1.7 0.9 1.1 1.6    0.7 0.9 0.1 2.6
 *   1366x657    1.1 1.3 0.4 0.4    1.1 1.3 0.4 1.4
 *   1440x700    0.7 0.9 1.1 1.6    0.7 0.9 0.1 2.6
 *   1536x730    0.7 0.9 1.1 1.6    0.7 0.9 0.1 2.6
 *   1920x1080   1.7 0.9 1.1 1.6    0.7 0.9 0.1 2.6
 *   Pixel 7     1.4 1.5 1.6 0.9    0.7 0.7 1.1 1.1
 *
 * So 0.0 to 2.6 (the first, wider cloud of 600 points measured -1.4 to 2.3
 * in the same windows): the band is -2.5 to 3.5, about a pixel past either.
 * Each edge is checked on its own side, so a logo drawn 8 % small (about 6
 * px an edge on the smallest phone, 12 on a desktop) or moved 4 px leaves it,
 * as the mutation runs on the first cloud showed. (The old check, the ink's
 * box against the static image's, took absolute values against 8 px and let
 * a logo 8 % small through.)
 */
export const LOGO_EDGE = { low: -2.5, high: 3.5 } as const;

/**
 * The share by which the top half of the canvas's mark is heavier left of its
 * middle than right of it (alpha summed), at least: the target's points give
 * 286 to 222 (1.29) on the 840-point cloud, and the windows above measured
 * 1.18 to 1.35; a mirror image (the logo's x flipped in buildParticleSet)
 * measured 0.88 to 0.94 (390x844, 1280x800 and the Pixel 7, both paths).
 */
export const LOGO_TOP_LEFT_SHARE = 1.1;

/** What `logoInk` reports that the judgement reads. */
export interface LogoFit {
  readonly fit: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  };
  readonly topLeftShare: number;
  readonly empty: boolean;
}

/** What is wrong with the canvas's logo, as a list (empty when it is on its mark): something drawn, each edge inside `LOGO_EDGE` (a number that is not one is outside), and the hand the right way round. */
export function logoOffMark(ink: LogoFit): string[] {
  const problems: string[] = [];
  if (ink.empty) problems.push("no logo drawn");
  for (const [edge, value] of Object.entries(ink.fit)) {
    if (!(value >= LOGO_EDGE.low && value <= LOGO_EDGE.high)) {
      problems.push(`${edge} ${value.toFixed(2)}`);
    }
  }
  if (!(ink.topLeftShare >= LOGO_TOP_LEFT_SHARE)) {
    problems.push(`top left/right ${ink.topLeftShare.toFixed(3)}`);
  }
  return problems;
}
