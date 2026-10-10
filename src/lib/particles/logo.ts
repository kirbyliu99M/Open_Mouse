import { shareOut } from "./dense";
import { type Polyline, type Vec, distance } from "./geometry";
import { LOOK_LIMITS, STAR_SIZE } from "./look";
import { mulberry32 } from "./random";
import type { StrokeRun, TargetPoint } from "./sampling";
import { parsePathData } from "./svg-path";

/**
 * The Palmate mark of the home page hero (未拍板, candidate: Kirby looks at the
 * animation): a hand drawn as four lines, which replaces the placeholder
 * mouse-and-ruler of Home v3, and a dot below the thumb. The static image
 * (public/images/hero-palmate-mark.svg) draws `PALMATE_PATH` and `PALMATE_DOT`
 * as they are; the particle target is the same path sampled as a cloud of
 * points a little wider than the line, the dot as a bright core in a ring of
 * dim points, and a few stray points round the mark. Both are made from this file, so they
 * agree.
 */

/** The hand, as the logo's own drawing wrote it (viewBox units). Four subpaths: the palm with the thumb, then three fingers. Do not edit it by eye: the SVG and the target both read it. */
export const PALMATE_PATH =
  "M38 48c0 4 4 6 7 4 3-2 3-8-1-11-6-4-16 1-18 11-2 12 10 20 22 20 12 0 22-8 24-22 1-12-4-24-8-28-2-2-5-1-5 2 0 8 4 20 3 30m-4-16c0-12-2-22-6-24-2-2-5-1-6 2-2 8 0 20 0 30m-2-14c-1-8-3-14-7-16-2-2-5-1-6 2-2 8 1 20 3 28m-4-10c-2-6-5-12-8-12-3 0-4 3-3 8 1 8 3 16 5 22";

/**
 * The static image's viewBox: the path's bounding box (x 18.6 to 72.1, y 13.0
 * to 72.0) with about 5 units of room all round, for the particles that sit a
 * little off the line and for the stroke's width.
 */
export const LOGO_VIEWBOX = { x: 13, y: 8, width: 65, height: 69 } as const;

/** Stage px per viewBox unit: the target's own coordinates are the viewBox's, from its corner, times this (so 0.1 px, the precision of the JSON, is 0.03 of a unit). */
export const LOGO_SCALE = 3;

/** The logo's box in stage px: the viewBox scaled. The mark's points (the 840 along the lines and the dot's 9) are inside it, the 24 strays outside it; the stage fits the static image's rect to it. */
export const LOGO_BOX = { width: 195, height: 207 } as const;

/** The stroke of the static image, in viewBox units, and its colour. */
export const LOGO_STROKE = { color: "#7FA8FF", width: 2 } as const;

/** The seed of the logo's cloud. Fixed on its own: the logo does not change with the generator's seed (the hand's fill does). */
export const LOGO_SEED = 20261010;

/**
 * How the cloud is made. All lengths are viewBox units unless they say px.
 *
 * - `particles` points lie along the path, which is 349 units long. They sit at
 *   `particles / (1 + doubled)` places an even step apart (667 places, about
 *   0.52 units), and `doubled` of those places carry two points instead of
 *   one (173 of them, picked by a seeded shuffle). A place's two points sit
 *   `pairAt` of a step before and after its middle (a quarter and three
 *   quarters of the way along it), each moved by up to `pairJitter` of a step,
 *   so a pair never bunches into one dot.
 * - Each point is moved across the line by a bell-shaped amount and never past
 *   `maxSpread`. The bell's width (one standard deviation) swells and thins
 *   slowly along the line, like a drawn stroke: `spread` times 1 plus or minus
 *   `widthSwing`, a sine of `widthPeriod` units along the line, each line
 *   `widthPhase` radians further on than the one before (`logoWidthAt`). So
 *   the line is about 2 to 4 units wide, with no hard edge.
 * - Where in the bell each point goes is not drawn at random: the points take
 *   the bell's quantiles in a low-discrepancy order (golden-ratio steps from
 *   the middle, `bellQuantile`), so no stretch of line has all its points on
 *   one side or bunched in the middle, and the cloud has fewer clumps and gaps
 *   (the nearest-neighbour distances vary by 0.23 of their mean, against 0.41
 *   with random draws), while each point's own place is still irregular.
 * - Density (Kirby, 2026-10-10, who asked twice for a denser, tighter mark,
 *   then for the particles to look better): the first cut was 600 points,
 *   spread 0.8 and at most 2.4, random places in the bell and in a pair's
 *   step; it is now 840 points, spread 0.5 (+- 30 %) and at most 1.6, with
 *   the even placing above (variant B3, compared in screenshots with B, B1
 *   and B2).
 * - `brightShare` of the points are the bright tone, the others the dim one.
 * - The dot (`PALMATE_DOT`, a white disc in a blue ring) is drawn with the
 *   two tones the particles have: `dotCore` bright points close together at
 *   its centre (`dotCoreRadius` units out), which read as one star a little
 *   bigger and brighter than the others, and `dotRing` dim points evenly round
 *   the ring's middle line (radius `PALMATE_DOT.r`). Six round a 7.2-unit ring
 *   are 1.2 units apart, about a lit star's width on a desktop, so the ring
 *   reads as a ring and not as a smear. The ring's blue is the dim tone's
 *   #6E9BF5, not the static ring's #2463EB: the particles have two colours.
 * - `ambient` more points are scattered round the mark, in the frame
 *   `strayReach()` gives (inside the logo's slot and the page's column), no
 *   nearer than `ambientHole` px to the box and `ambientGap` px to each other.
 */
export const LOGO_SAMPLING = {
  particles: 840,
  doubled: 0.26,
  spread: 0.5,
  maxSpread: 1.6,
  widthSwing: 0.3,
  widthPeriod: 24,
  widthPhase: 1.7,
  pairAt: 0.25,
  pairJitter: 0.1,
  brightShare: 0.5,
  dotCore: 3,
  dotCoreRadius: 0.35,
  dotRing: 6,
  ambient: 24,
  ambientHole: 12,
  ambientGap: 30,
} as const;

/**
 * The dot of the mark, in the path's viewBox units, as Kirby's official logo
 * frame in Pencil draws it ("Logo · Palmate (Official)", the Core Sensor Apex):
 * below the thumb, 0.493 of the way across the hand's ink box and 0.687 of the
 * way down. A white (#CFE0FF) disc in a blue (#2463EB) ring: drawn as one
 * circle whose stroke is the ring, so its middle line is at `r`, its outer
 * edge at `r + strokeWidth / 2` (1.55) and the white inside at
 * `r - strokeWidth / 2` (0.75). No halo, no second ring.
 */
export const PALMATE_DOT = {
  cx: 45,
  cy: 53.5,
  r: 1.15,
  fill: "#CFE0FF",
  stroke: "#2463EB",
  strokeWidth: 0.8,
} as const;

/**
 * Where the logo's image sits on the home page, as src/app/home.css lays it
 * out (a unit test reads the CSS and checks these): the strays must stay
 * inside the logo's slot (the nav is above it, the headline right below) and
 * inside the canvas, which is the page's column (the window less its side
 * padding).
 *
 * - Phone: the slot is `clamp(18rem, 40svh, 24rem)` tall and the image 0.63
 *   of it. The narrowest phone shape the strays are made to fit is 20:9
 *   upright (0.45: a 412 x 915 window is 0.450), from the narrowest window
 *   the home page is tested at (320 px) up; a wider shape has more room.
 * - Desktop (48 rem and up): the image is 22.2 rem of a 29 rem slot at every
 *   slot height (on a short window the slot shrinks and the image with it).
 * - The column's side padding: `clamp(1rem, 1rem + (100vw - 360px) * 0.5, 1.5rem)`.
 */
export const LOGO_PAGE = {
  rem: 16,
  phoneSlotRem: { min: 18, max: 24 },
  phoneSlotOfWindow: 0.4,
  phoneImage: 0.63,
  phoneAspect: 9 / 20,
  phoneMinWidthPx: 320,
  desktopFromRem: 48,
  desktopSlotRem: { min: 14, max: 29 },
  desktopImage: 22.2 / 29,
  paddingRem: { min: 1, max: 1.5 },
  paddingFromPx: 360,
} as const;

/** The biggest logo star's radius, CSS px: the look's largest bright star times the logo's star size, halved (the shimmer's swell, 2.6 s once, is not counted). */
const STAR_RADIUS_PX = (LOOK_LIMITS.brightPx[1] * STAR_SIZE.logo) / 2;

/**
 * How far beyond the box (stage px) a stray's centre may be, sideways and up
 * or down, so that a star there, at its biggest, stays inside the slot and
 * the canvas on every window `LOGO_PAGE` describes. Each layout's room is its
 * CSS px less the star's radius, over the layout's CSS px per stage px; the
 * reach is the least of them (the desktop's slot sets the height, a phone's
 * column the width).
 */
export function strayReach(): { x: number; y: number } {
  const p = LOGO_PAGE;
  const { width, height } = LOGO_BOX;
  // The image is the box, scaled to its height (the box and the image have one shape).
  const reachOf = (roomPx: number, imagePx: number) =>
    (roomPx - STAR_RADIUS_PX) / (imagePx / height);
  let x = Infinity;
  let y = Infinity;
  // Desktop: the slot's room above and below the image, at every slot height.
  for (
    let slot = p.desktopSlotRem.min * p.rem;
    slot <= p.desktopSlotRem.max * p.rem;
    slot += 1
  ) {
    const image = slot * p.desktopImage;
    y = Math.min(y, reachOf((slot - image) / 2, image));
    // The narrowest desktop column, at 48 rem.
    const column = p.desktopFromRem * p.rem - 2 * p.paddingRem.max * p.rem;
    x = Math.min(x, reachOf((column - (image * width) / height) / 2, image));
  }
  // Phone: every window height at the narrowest shape, from the narrowest
  // width up (a shorter window at that width has the same floored slot).
  for (
    let tall = Math.ceil(p.phoneMinWidthPx / p.phoneAspect);
    tall <= 1600;
    tall += 1
  ) {
    const wide = tall * p.phoneAspect;
    if (wide >= p.desktopFromRem * p.rem) break;
    const slot = Math.min(
      p.phoneSlotRem.max * p.rem,
      Math.max(p.phoneSlotRem.min * p.rem, tall * p.phoneSlotOfWindow),
    );
    const image = slot * p.phoneImage;
    const padding = Math.min(
      p.paddingRem.max * p.rem,
      Math.max(
        p.paddingRem.min * p.rem,
        p.paddingRem.min * p.rem + (wide - p.paddingFromPx) * 0.5,
      ),
    );
    const column = wide - 2 * padding;
    y = Math.min(y, reachOf((slot - image) / 2, image));
    x = Math.min(x, reachOf((column - (image * width) / height) / 2, image));
  }
  return { x, y };
}

/**
 * Whether a logo point (in its own px, at any budget) belongs to the mark
 * rather than to the strays round it. The mark's points are inside `LOGO_BOX`,
 * at least 10.1 px from its edges by the spec (the path's least room, 4.96
 * units at the top, less the cloud's 1.6; 11.9 px in the target), and a
 * stray is at least `ambientHole` px outside it. A budget moves a point by a
 * pixel at most (a sparse top-up nudges a copy by up to 1 px, a dense walk by
 * 0.75), so the box widened by half the hole tells the two apart at every
 * budget.
 */
export function inLogoMark(p: { readonly x: number; readonly y: number }) {
  const margin = LOGO_SAMPLING.ambientHole / 2;
  return (
    p.x > -margin &&
    p.x < LOGO_BOX.width + margin &&
    p.y > -margin &&
    p.y < LOGO_BOX.height + margin
  );
}

/** The mark's subpaths as polylines in viewBox units (the curves flattened to about 1 unit). */
export function logoPolylines(): Polyline[] {
  return parsePathData(PALMATE_PATH);
}

interface Walk {
  readonly points: readonly Vec[];
  /** Length up to each point. */
  readonly along: readonly number[];
  readonly length: number;
}

function walkOf({ points }: Polyline): Walk {
  const along = [0];
  for (let i = 1; i < points.length; i += 1) {
    along.push(along[i - 1]! + distance(points[i - 1]!, points[i]!));
  }
  return { points, along, length: along[along.length - 1]! };
}

/** The point at length `u` along the walk, and the unit normal of the segment it is on. */
function placeAt(walk: Walk, u: number): { at: Vec; normal: Vec } {
  const { points, along } = walk;
  let low = 1;
  let high = points.length - 1;
  const target = Math.min(Math.max(u, 0), walk.length);
  while (low < high) {
    const mid = (low + high) >> 1;
    if (along[mid]! < target) low = mid + 1;
    else high = mid;
  }
  const a = points[low - 1]!;
  const b = points[low]!;
  const size = along[low]! - along[low - 1]!;
  const t = size === 0 ? 0 : (target - along[low - 1]!) / size;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy) || 1;
  return {
    at: [a[0] + dx * t, a[1] + dy * t],
    normal: [-dy / length, dx / length],
  };
}

/**
 * The bell's quantile: the z with Phi(z) = p, for p in (0, 1) (Acklam's
 * rational approximation, |error| < 1.2e-9). Pure arithmetic and `Math.log`,
 * `Math.sqrt`, so the committed JSON is the same on every machine that
 * rounds those alike. `level` is held to 1e-12 .. 1 - 1e-12 (z of about
 * -7 to 7), so 0 and 1 give a number and not NaN (log 0), which the clip
 * after it could not catch.
 */
export function bellQuantile(level: number): number {
  const p = Math.min(1 - 1e-12, Math.max(1e-12, level));
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269,
    -30.66479806614716, 2.506628277459239,
  ];
  const b = [
    -54.47609879822406, 161.5858368580409, -155.6989798598866,
    66.80131188771972, -13.28068155288572,
  ];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    0.007784695709041462, 0.3224671290700398, 2.445134137142996,
    3.754408661907416,
  ];
  const tail = (q: number) =>
    (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q +
      c[5]!) /
    ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  const low = 0.02425;
  if (p < low) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - low) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r +
      a[5]!) *
      q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  );
}

/** The golden ratio's fractional part: the step of the low-discrepancy order the cloud's points take the bell's quantiles in. */
export const GOLDEN_STEP = 0.6180339887498949;

/** The bell's width (one standard deviation, units) on line `line` (0 to 3) at `u` units along it: `spread` times 1 plus or minus `widthSwing`, a sine of `widthPeriod` units, `widthPhase` radians on per line. */
export function logoWidthAt(line: number, u: number): number {
  const s = LOGO_SAMPLING;
  return (
    s.spread *
    (1 +
      s.widthSwing *
        Math.sin((2 * Math.PI * u) / s.widthPeriod + s.widthPhase * line))
  );
}

/**
 * The logo's particle target in stage px: `particles` points along the four
 * subpaths (one run each, in path order), then the dot's `dotCore` and
 * `dotRing` points (a run of one each), all inside `LOGO_BOX`; then `ambient` single stray
 * points (a run of one each) outside it, in the frame `strayReach()` gives. Pure and
 * seeded by `LOGO_SEED`: the same points every time, on every machine that
 * rounds `Math.log` and `cos` alike (the committed JSON is checked against a
 * fresh run by a test).
 */
export function sampleLogoPoints(): {
  points: TargetPoint[];
  runs: StrokeRun[];
} {
  const s = LOGO_SAMPLING;
  const random = mulberry32(LOGO_SEED);
  const toBox = ([x, y]: Vec): Vec => [
    (x - LOGO_VIEWBOX.x) * LOGO_SCALE,
    (y - LOGO_VIEWBOX.y) * LOGO_SCALE,
  ];

  const walks = logoPolylines().map(walkOf);
  // Each line gets its share of the points by its length (exactly `particles`
  // in all).
  const pointsOf = shareOut(
    walks.map((w) => w.length),
    s.particles,
  );

  const points: TargetPoint[] = [];
  const runs: StrokeRun[] = [];
  // The cloud's points in order, across all four lines: the low-discrepancy
  // order's counter.
  let nth = 0;
  walks.forEach((walk, w) => {
    const start = points.length;
    // The line's places, an even step apart, and which of them carry two
    // points: exactly `pointsOf[w] - count` of them, picked by a seeded shuffle.
    const count = Math.round(pointsOf[w]! / (1 + s.doubled));
    const step = walk.length / count;
    const doubled = new Uint8Array(count);
    const order = Array.from({ length: count }, (_, i) => i);
    for (let i = count - 1; i > 0; i -= 1) {
      const k = Math.floor(random() * (i + 1));
      const held = order[i]!;
      order[i] = order[k]!;
      order[k] = held;
    }
    for (let i = 0; i < pointsOf[w]! - count; i += 1) doubled[order[i]!] = 1;
    for (let k = 0; k < count; k += 1) {
      const pieces = doubled[k]! + 1;
      for (let j = 0; j < pieces; j += 1) {
        // A place with two points puts them a quarter and three quarters of
        // the way along its step, each moved a little.
        const u =
          (k +
            0.5 +
            (pieces === 1
              ? 0
              : (j === 0 ? -s.pairAt : s.pairAt) +
                (random() - 0.5) * 2 * s.pairJitter)) *
          step;
        const { at, normal } = placeAt(walk, u);
        // Two draws the random bell took before the quantiles replaced it:
        // still drawn, so the strays, made from the same stream, stay put.
        random();
        random();
        const level = (0.5 + nth * GOLDEN_STEP) % 1;
        nth += 1;
        const across = Math.max(
          -s.maxSpread,
          Math.min(s.maxSpread, bellQuantile(level) * logoWidthAt(w, u)),
        );
        const [x, y] = toBox([
          at[0] + normal[0] * across,
          at[1] + normal[1] * across,
        ]);
        points.push({ x, y, tone: random() < s.brightShare ? 1 : 0 });
      }
    }
    runs.push({ start, count: points.length - start, closed: false });
  });

  // The dot: the bright core, then the dim ring, a run of one each. (As one
  // run, a dense budget would walk the chords between them; a run of one
  // grows into a small clump on its own place, so the dot keeps its shape at
  // every budget.) Fixed angles, no random numbers, so the cloud's and the
  // strays' are the ones they always were.
  const dotAt = (radius: number, angle: number) =>
    toBox([
      PALMATE_DOT.cx + radius * Math.cos(angle),
      PALMATE_DOT.cy + radius * Math.sin(angle),
    ]);
  for (let k = 0; k < s.dotCore; k += 1) {
    const [x, y] = dotAt(
      s.dotCoreRadius,
      -Math.PI / 2 + (2 * Math.PI * k) / s.dotCore,
    );
    runs.push({ start: points.length, count: 1, closed: false });
    points.push({ x, y, tone: 1 });
  }
  for (let k = 0; k < s.dotRing; k += 1) {
    const [x, y] = dotAt(
      PALMATE_DOT.r,
      Math.PI / 2 + (2 * Math.PI * (k + 0.5)) / s.dotRing,
    );
    runs.push({ start: points.length, count: 1, closed: false });
    points.push({ x, y, tone: 0 });
  }

  // The strays: outside the box (and a hole round it), inside the room the
  // page has round the image, no two close together.
  const { x: reachX, y: reachY } = strayReach();
  const strays: Vec[] = [];
  for (let tries = 0; strays.length < s.ambient; tries += 1) {
    if (tries > 20000) throw new Error("the logo's strays do not fit");
    const x = -reachX + random() * (LOGO_BOX.width + 2 * reachX);
    const y = -reachY + random() * (LOGO_BOX.height + 2 * reachY);
    const inHole =
      x > -s.ambientHole &&
      x < LOGO_BOX.width + s.ambientHole &&
      y > -s.ambientHole &&
      y < LOGO_BOX.height + s.ambientHole;
    if (inHole) continue;
    if (strays.some((o) => distance(o, [x, y]) < s.ambientGap)) continue;
    strays.push([x, y]);
  }
  for (const [x, y] of strays) {
    runs.push({ start: points.length, count: 1, closed: false });
    points.push({ x, y, tone: 0 });
  }
  return { points, runs };
}
