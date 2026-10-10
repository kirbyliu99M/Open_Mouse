import type { Vec } from "./geometry";
import { clamp01 } from "./interpolate";
import { mulberry32 } from "./random";

/**
 * The finale's sky (home finale, stage 1: nothing on the page uses this yet):
 * still stars in four sizes and meteors streaking down and to the left, along
 * the arm toward the mouse. Pure and seeded: the same size, seed and options
 * give the same sky. Nothing moves by itself; a meteor's tail only stretches
 * with the reader's scroll speed (`trailScale`), and with reduced motion the
 * stage keeps every tail at its rest length.
 *
 * Classes, counts, colours and the meteors' look are read from the v17
 * desktop (EdWeI) and v18 phone (s3nxQl) frames in Pencil; the scroll mapping
 * is new. All 未拍板 (candidate).
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The four kinds of star, smallest first: diameter (px), colour, opacity. */
export const STAR_CLASSES = [
  { name: "small", px: 1.1, colour: "#CFE0FF", alpha: 0.5 },
  { name: "medium", px: 1.7, colour: "#8DB8FF", alpha: 0.8 },
  { name: "bright", px: 2.3, colour: "#FFFFFF", alpha: 1 },
  { name: "large", px: 3.2, colour: "#7FA8FF", alpha: 0.9 },
] as const;

/** How many of each class, per layout (counted in the frames: a 1440 × 900 hero, a 390 × 1088 phone page). */
export const STAR_COUNTS = {
  desktop: [210, 84, 30, 6],
  mobile: [74, 44, 9, 3],
} as const;

/** The meteors' look. */
export const METEOR = {
  /** Degrees below the horizontal the meteors travel, heading left. */
  angleDeg: 40,
  /** The tail's four quarters, from its far end to the head: opacity and stroke width (px), all one colour. */
  colour: "#BFD4FF",
  tail: [
    { alpha: 0.1, width: 0.7 },
    { alpha: 0.22, width: 1 },
    { alpha: 0.45, width: 1.35 },
    { alpha: 0.85, width: 1.8 },
  ],
  head: { px: 2.8, colour: "#FFFFFF", alpha: 1 },
  halo: { px: 7, colour: "#7FA8FF", alpha: 0.22 },
} as const;

/** Meteors per layout and their rest length range (px): measured 110-295 desktop, 56-145 phone. */
export const METEOR_LAYOUT = {
  desktop: { count: 18, length: [110, 295] },
  mobile: { count: 9, length: [56, 145] },
} as const;

/** How the tail follows scroll speed: rest length at a standstill, up to `max` times it at `fullSpeed` px/s and faster. */
export const TRAIL = { max: 1.8, fullSpeed: 2400 } as const;

export interface Star {
  readonly x: number;
  readonly y: number;
  /** An index into STAR_CLASSES. */
  readonly cls: number;
}

export interface Meteor {
  /** The bright head, at the meteor's lower-left end. */
  readonly head: Vec;
  /** Rest length of the tail, px. */
  readonly length: number;
}

function inflate(rect: Rect, pad: number): Rect {
  return {
    x: rect.x - pad,
    y: rect.y - pad,
    width: rect.width + 2 * pad,
    height: rect.height + 2 * pad,
  };
}

/** Whether (x, y) is inside the rectangle (edges included). */
export function inRect(rect: Rect, x: number, y: number): boolean {
  return (
    x >= rect.x &&
    x <= rect.x + rect.width &&
    y >= rect.y &&
    y <= rect.y + rect.height
  );
}

/** Whether the segment a-b touches the rectangle (Liang-Barsky clipping). */
export function segmentHitsRect(a: Vec, b: Vec, rect: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const edges: [number, number][] = [
    [-dx, a[0] - rect.x],
    [dx, rect.x + rect.width - a[0]],
    [-dy, a[1] - rect.y],
    [dy, rect.y + rect.height - a[1]],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return true;
}

function checkArea(width: number, height: number): void {
  if (!(width > 0) || !(height > 0)) {
    throw new RangeError("the sky's width and height must be positive");
  }
}

export interface StarOptions {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  /** How many of each class (STAR_COUNTS). */
  readonly counts: readonly number[];
  /** Where no star may be: the headline band, the hand's box, the buttons, the footer's text. */
  readonly avoid?: readonly Rect[];
  /** Kept this far from every avoided rectangle (px, default 6). */
  readonly padding?: number;
  /** Tries per star before giving it up (default 30). */
  readonly attempts?: number;
}

/**
 * Seeded stars, class by class, placed at random and kept clear of the
 * avoided rectangles. A star that finds no free place in `attempts` tries is
 * left out, so a crowded layout has fewer stars, never one in the way.
 */
export function placeStars(options: StarOptions): Star[] {
  const { width, height, seed, counts } = options;
  checkArea(width, height);
  if (counts.length > STAR_CLASSES.length) {
    throw new RangeError(`at most ${STAR_CLASSES.length} star classes`);
  }
  const avoid = (options.avoid ?? []).map((r) =>
    inflate(r, options.padding ?? 6),
  );
  const attempts = options.attempts ?? 30;
  const random = mulberry32(seed);
  const stars: Star[] = [];
  counts.forEach((count, cls) => {
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError("a star count is a whole number, 0 or more");
    }
    for (let n = 0; n < count; n += 1) {
      for (let k = 0; k < attempts; k += 1) {
        const x = random() * width;
        const y = random() * height;
        if (!avoid.some((r) => inRect(r, x, y))) {
          stars.push({ x, y, cls });
          break;
        }
      }
    }
  });
  return stars;
}

/** The unit vector from a meteor's head back along its tail (up and to the right). */
export function tailDirection(angleDeg = METEOR.angleDeg): Vec {
  const a = (angleDeg * Math.PI) / 180;
  return [Math.cos(a), -Math.sin(a)];
}

export interface MeteorOptions {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly count: number;
  /** [shortest, longest] rest length, px. */
  readonly length: readonly [number, number];
  readonly avoid?: readonly Rect[];
  /** Every tail, at its longest, stays this far from every avoided rectangle (px, default 6). */
  readonly padding?: number;
  readonly attempts?: number;
  /** The longest the tail ever gets, as a multiple of its rest length (TRAIL.max): a meteor is placed so even that tail stays clear. */
  readonly maxScale?: number;
}

/**
 * Seeded meteors: a head inside the sky, a length in the range, and a tail
 * that, at its longest (`maxScale`), crosses no avoided rectangle. One that
 * finds no free place in `attempts` tries is left out.
 */
export function placeMeteors(options: MeteorOptions): Meteor[] {
  const { width, height, seed, count, length } = options;
  checkArea(width, height);
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError("count is a whole number, 0 or more");
  }
  const [shortest, longest] = length;
  if (!(shortest > 0) || !(longest >= shortest)) {
    throw new RangeError("length is [shortest, longest], both positive");
  }
  const avoid = (options.avoid ?? []).map((r) =>
    inflate(r, options.padding ?? 6),
  );
  const attempts = options.attempts ?? 30;
  const maxScale = options.maxScale ?? TRAIL.max;
  const dir = tailDirection();
  const random = mulberry32(seed);
  const meteors: Meteor[] = [];
  for (let n = 0; n < count; n += 1) {
    for (let k = 0; k < attempts; k += 1) {
      const head: Vec = [random() * width, random() * height];
      const len = shortest + (longest - shortest) * random();
      const reach = len * Math.max(1, maxScale);
      const end: Vec = [head[0] + dir[0] * reach, head[1] + dir[1] * reach];
      if (!avoid.some((r) => segmentHitsRect(head, end, r))) {
        meteors.push({ head, length: len });
        break;
      }
    }
  }
  return meteors;
}

/**
 * How long the tails are, as a multiple of their rest length, for a scroll
 * speed in px/s (either direction): 1 at a standstill, rising smoothly to
 * TRAIL.max at TRAIL.fullSpeed (fast at first, flattening toward the top,
 * so it is above the straight line in between) and staying there. Not a number counts as
 * standing still.
 */
export function trailScale(speed: number): number {
  const v = Number.isFinite(speed) ? Math.abs(speed) : 0;
  const s = clamp01(v / TRAIL.fullSpeed);
  return 1 + (TRAIL.max - 1) * s * (2 - s);
}

/**
 * A smoothed scroll speed (px/s): the last value moved toward this frame's
 * speed (`deltaPx` over `dtMs`) by an exponential step with time constant
 * `tauMs`. With no time passed it keeps the last value.
 */
export function smoothSpeed(
  previous: number,
  deltaPx: number,
  dtMs: number,
  tauMs = 120,
): number {
  const last = Number.isFinite(previous) ? previous : 0;
  if (!(dtMs > 0) || !Number.isFinite(deltaPx)) return last;
  const now = (deltaPx / dtMs) * 1000;
  const k = 1 - Math.exp(-dtMs / Math.max(1e-6, tauMs));
  return last + (now - last) * k;
}

export interface TailSegment {
  readonly from: Vec;
  readonly to: Vec;
  readonly alpha: number;
  readonly width: number;
}

/** A meteor's four tail quarters at `scale` times its rest length, far end first, the last ending at the head. */
export function meteorSegments(meteor: Meteor, scale = 1): TailSegment[] {
  const dir = tailDirection();
  const len = meteor.length * (Number.isFinite(scale) && scale > 0 ? scale : 1);
  const quarters = METEOR.tail.length;
  const at = (k: number): Vec => {
    const d = (len * (quarters - k)) / quarters;
    return [meteor.head[0] + dir[0] * d, meteor.head[1] + dir[1] * d];
  };
  return METEOR.tail.map((look, k) => ({
    from: at(k),
    to: at(k + 1),
    alpha: look.alpha,
    width: look.width,
  }));
}
