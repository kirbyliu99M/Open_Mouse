import { A4_MM, STAGE_SCALE } from "./template-hand";

/**
 * How a particle looks in the WebGL stage (Home v3, the WebGL stage). The
 * Canvas 2D path stamps a 6 px glow sprite for a bright particle and a 1.4 px
 * square for a dim one, tuned for about 1,300 particles. With five to ten times
 * as many, the same sprites would overlap into a smear and burn the picture
 * out, so a particle gets smaller and fainter the more of them crowd the
 * picture: the drawing keeps its weight and gains fineness.
 *
 * What counts is the crowd, not the count: particles per pixel of the picture.
 * A phone's 6,000 particles on a 340 px sheet are as crowded as a desktop's
 * 12,000 on a 410 px one. These numbers are looks, not budgets (未拍板, tuned
 * by eye from screenshots), and pure functions, so a test can pin their
 * direction and their limits.
 */
export interface GlLook {
  /** A bright particle's diameter, CSS px (before the shimmer's swell and the state's gain). */
  readonly brightPx: number;
  /** A dim particle's diameter, CSS px. */
  readonly dimPx: number;
  /** A bright particle's opacity at its centre, 0 to 1. */
  readonly brightAlpha: number;
  /** A dim particle's opacity at its centre, 0 to 1. */
  readonly dimAlpha: number;
}

/** The count and the sheet scale the Canvas 2D look was tuned for: 1,300 particles on a desktop, whose A4 sheet is drawn at about 1.2 CSS px per stage px. */
export const REFERENCE_COUNT = 1300;
export const REFERENCE_SCALE = 1.2;

/** The A4 sheet's area in stage px (the hand's drawing is 340 px wide on it). */
const SHEET_AREA = A4_MM.width * STAGE_SCALE * (A4_MM.height * STAGE_SCALE);

/** Particles per CSS px² of the A4 sheet that the 2D look was tuned for. */
const REFERENCE_DENSITY =
  REFERENCE_COUNT / (SHEET_AREA * REFERENCE_SCALE * REFERENCE_SCALE);

/** The shimmer swells a lit particle by up to this share of its size (the same as the Canvas 2D path). */
export const SHIMMER_GROWTH = 0.9;

/** A state's gain also grows its particles, by the gain to this power (the shader's `pow(gain, ...)`). */
export const GAIN_SIZE_POWER = 0.35;

/** The most and the least a look may say: a bound on the biggest point the GPU is asked for, and a floor so nothing vanishes. */
export const LOOK_LIMITS = {
  brightPx: [2.2, 4],
  dimPx: [1.6, 3.2],
  brightAlpha: [0.2, 1],
  dimAlpha: [0.1, 0.72],
} as const;

const clamp = (value: number, [low, high]: readonly [number, number]) =>
  Math.min(high, Math.max(low, value));

/**
 * How crowded the picture is relative to the 2D look's: 1 or more.
 * `count` particles on a sheet drawn at `scale` CSS px per stage px.
 */
export function crowdOf(count: number, scale: number): number {
  const s = scale > 0 ? scale : REFERENCE_SCALE;
  return Math.max(1, count / (SHEET_AREA * s * s) / REFERENCE_DENSITY);
}

/** The look for `count` particles drawn on a sheet at `scale` CSS px per stage px. */
export function glLook(count: number, scale: number): GlLook {
  const crowd = crowdOf(count, scale);
  return {
    brightPx: clamp(6 / crowd ** 0.355, LOOK_LIMITS.brightPx),
    dimPx: clamp(3.2 / crowd ** 0.19, LOOK_LIMITS.dimPx),
    brightAlpha: clamp(1.4 / crowd ** 0.2, LOOK_LIMITS.brightAlpha),
    dimAlpha: clamp(0.9 / crowd ** 0.25, LOOK_LIMITS.dimAlpha),
  };
}

/**
 * How much stronger (more opaque, a little bigger) a state's particles are
 * drawn than the look says, because the state spreads the same particles
 * thinner. All three states hold every particle, but the logo is one thin
 * outline, the hand a filled shape and each mouse a third of the particles
 * on a long sketch: per pixel of line the logo has the most particles and a
 * mouse the fewest, so left alone the logo burns and the mice fade. The gain
 * is a constant per state (the ratio between the states does not depend on the
 * budget); 未拍板, tuned by eye.
 */
export const STATE_GAIN = { logo: 0.45, hand: 1, mouse: 2 } as const;

/** The gains at the start and at the end of a leg: logo to hand, or hand to mice. */
export function legGain(split: boolean): readonly [number, number] {
  return split
    ? [STATE_GAIN.hand, STATE_GAIN.mouse]
    : [STATE_GAIN.logo, STATE_GAIN.hand];
}

/**
 * The biggest point the stage ever asks the GPU for, in CSS px: the biggest
 * particle a look can have, at the top of the shimmer's swell, in the state
 * with the biggest gain. The GPU's largest point must exceed this times the
 * pixel ratio, with room to spare (`pointSizeFits`).
 */
export function maxPointCssPx(): number {
  const biggestGain = Math.max(...Object.values(STATE_GAIN));
  return (
    Math.max(LOOK_LIMITS.brightPx[1], LOOK_LIMITS.dimPx[1]) *
    (1 + SHIMMER_GROWTH) *
    biggestGain ** GAIN_SIZE_POWER
  );
}
