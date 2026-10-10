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
 * after the shimmer, at p = 0) on the even, stroke-like cloud (variant B3),
 * left / top / right / bottom; the windows at pixel ratio 1, then the mobile
 * project's Pixel 7 (412x915, pixel ratio 2.625):
 *
 *   window      WebGL                  Canvas 2D
 *   360x800      0.8  0.4  0.4  1.0     0.8  0.4  0.4  1.0
 *   375x667      1.3  0.1 -0.0  1.0     1.3  0.1 -0.0  1.0
 *   390x844      1.6  0.1 -0.2  0.5     0.6  0.1  0.8  1.5
 *   412x915      0.9  0.2  0.2 -0.3    -0.1  1.2  1.2  0.7
 *   430x932      0.2  0.4  0.4  0.6     0.2  0.4  1.4  0.6
 *   768x1024     1.1 -0.2  1.6  2.2     1.1 -0.2  0.6  1.2
 *   1280x600    -0.1  0.3  1.9  0.6    -0.1  1.3  1.9  0.6
 *   1280x640     0.6 -0.2  1.5  1.5    -0.4  0.8  1.5  1.5
 *   1280x720     1.1 -0.2  1.6  1.2     1.1 -0.2  0.6  1.2
 *   1280x800     1.1 -0.2  1.6  2.2     1.1 -0.2  0.6  1.2
 *   1366x657     1.4  0.4  0.8  1.1     1.4  0.4  0.8  0.1
 *   1440x700     1.1 -0.2  1.6  1.2     1.1 -0.2  0.6  1.2
 *   1536x730     1.1 -0.2  1.6  1.2     1.1 -0.2  0.6  1.2
 *   1920x1080    1.1 -0.2  1.6  2.2     1.1 -0.2  0.6  1.2
 *   Pixel 7      1.5  0.3 -0.1  0.7     0.5  0.5  0.9  0.7
 *
 * So -0.4 to 2.2 (the random 840-point cloud, variant B, measured 0.0 to
 * 2.6, and the first 600-point cloud -1.4 to 2.3, in the same windows): the
 * band is -2.5 to 3.5, at least 1.3 px past either. Each edge is checked on
 * its own side, so a logo drawn 8 % small (about 6 px an edge on the
 * smallest phone, 12 on a desktop) or moved 4 px leaves it, as the mutation
 * runs on the first cloud showed. (The old check, the ink's box against the
 * static image's, took absolute values against 8 px and let a logo 8 %
 * small through.)
 */
export const LOGO_EDGE = { low: -2.5, high: 3.5 } as const;

/**
 * The share by which the top half of the canvas's mark is heavier left of its
 * middle than right of it (alpha summed), at least. The target's points give
 * 286 to 222 (1.29). On the B3 cloud the windows above measured 1.12 to 1.34
 * (the lowest at 412x915 and 430x932, WebGL); a mirror image (the logo's x
 * flipped in buildParticleSet) measured 0.84 to 0.98 (390x844, 412x915,
 * 430x932, 1280x800 and the Pixel 7, both paths). 1.05 is about midway, 0.07
 * from either; in the setups the e2e suite runs (1280x800, the short laptop
 * windows, the Pixel 7) the hand reads 1.18 or more, 0.13 over it. (It was
 * 1.1 on the random cloud, whose own share went down to 1.18 and its
 * mirror's up to 0.94; on B3 1.1 left only 0.02.)
 *
 * Read against the target's own 1.29 instead (the share over what the
 * points predict) the margins are no wider: the hand reads 0.87 to 1.04 of
 * it and the mirror 0.65 to 0.76, about 0.06 either side of a midway bound.
 * What moves the figure is which particles are lit and how their glows
 * overlap, not the target; predicting that would mean rebuilding the
 * stage's pairing and star order in the helper. So the bound stays a plain
 * 1.05.
 */
export const LOGO_TOP_LEFT_SHARE = 1.05;

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
