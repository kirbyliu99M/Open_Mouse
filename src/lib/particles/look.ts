import { A4_MM, STAGE_SCALE } from "./template-hand";

/**
 * How a particle looks in the WebGL stage, and which of them are lit (Home v3,
 * the WebGL stage).
 *
 * Looks. The Canvas 2D path stamps a 6 px glow sprite for a bright particle
 * and a 1.4 px square for a dim one, tuned for about 1,300 particles. With
 * five to ten times as many, the same sprites would overlap into a smear and
 * burn the picture out, so the hand, which keeps every particle (a fine dust),
 * draws each of them smaller and fainter the more of them crowd the picture.
 *
 * Stars. The drawings (the logo, the mice) are not dust: they are a few
 * hundred glowing stars each, as in the Canvas 2D version. Each state lights
 * only a fraction of the particles (`LIT_FRACTION`), those whose rank is under
 * it, and draws them with the look of that many particles, which is about the
 * 2D look's own. The others fade out as the particles move into the state and
 * fade in as they leave it.
 *
 * What counts for a look is the crowd, not the count: particles per pixel of
 * the picture. A phone's 6,000 particles on a 340 px sheet are as crowded as a
 * desktop's 12,000 on a 410 px one. These numbers are looks, not budgets (未拍板,
 * tuned by eye from screenshots), and pure functions, so a test can pin their
 * direction and their limits.
 */
export interface GlLook {
  /** A bright particle's diameter, CSS px (before the shimmer's swell). */
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

/** The most and the least a look may say: a bound on the biggest point the GPU is asked for, and a floor so nothing vanishes. */
export const LOOK_LIMITS = {
  brightPx: [2.2, 6],
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
 * The share of the particles each state lights: the logo and the mice show
 * that share as stars, the hand shows them all, as dust. A particle is lit in
 * a state when its rank (0 to 1, `rankOf`) is under the share, so a smaller
 * share lights a subset of a bigger one.
 *
 * The logo's share is under the mice's because its stars sit on a short line:
 * the 2D version drew the logo as about 260 points (and 1,300 particles
 * stacked on them), against a mouse's 433. For scale: on a desktop's 12,000
 * particles 0.06 is 720 stars on the logo, and 0.15 is 1,800 on the mice, 600
 * to a mouse; a phone's 6,000 has half as many. 未拍板 (candidate): Kirby
 * picks the set in screenshots.
 */
export const LIT_FRACTION = { logo: 0.06, hand: 1, mouse: 0.15 } as const;

export type StateName = keyof typeof LIT_FRACTION;

/**
 * How much bigger than the look a state's lit particles are drawn. The 2D
 * version's logo was topped up with copies nudged by a pixel, five on every
 * point, so each logo point glowed as a small clump, a third bigger and
 * brighter than a mouse's single point; a logo star here is made that much
 * bigger so the logo has the same weight as the accepted picture. 未拍板,
 * tuned by eye from screenshots.
 */
export const STAR_SIZE = { logo: 1.35, hand: 1, mouse: 1 } as const;

/**
 * A particle's rank: its place in the order (from 0) as a share of all the
 * particles, taken at the middle of its place so that no particle's rank is on
 * a fraction's edge (the shader reads it as a float).
 */
export function rankOf(place: number, total: number): number {
  return (place + 0.5) / total;
}

/** Whether a particle of this rank is lit in a state that lights `fraction` of them. */
export function isLit(rank: number, fraction: number): boolean {
  return rank < fraction;
}

/**
 * How many of the first `drawn` particles (of `total`) a state with `fraction`
 * lights: the same count as running `isLit` over `rankOf(place, total)`.
 * (The guard draws the first `drawn` particles only; the lit ones come first
 * in the order, so a thinned picture loses dust before it loses stars.)
 */
export function litCount(
  fraction: number,
  total: number,
  drawn: number,
): number {
  const lit = Math.ceil(fraction * total - 0.5);
  return Math.max(0, Math.min(drawn, total, lit));
}

/**
 * How much of a particle shows part-way through a leg (0 to 1): 1 where it is
 * lit and 0 where it is not, at the start (`from`) and at the end (`to`) of
 * the leg, and a straight blend between the two by `e`, the leg's progress
 * (the same `e(t)` that moves it). The ends are exact: at `e` of 0 or less it
 * is the start state's value, at 1 or more the end state's. The shader has the
 * same formula (`stage-gl.ts`).
 */
export function litness(
  rank: number,
  from: number,
  to: number,
  e: number,
): number {
  const a = isLit(rank, from) ? 1 : 0;
  const b = isLit(rank, to) ? 1 : 0;
  if (e <= 0) return a;
  if (e >= 1) return b;
  return a + (b - a) * e;
}

/** The two states a leg runs between: logo to hand, or hand to mice. */
export function legStates(split: boolean): readonly [StateName, StateName] {
  return split ? ["hand", "mouse"] : ["logo", "hand"];
}

/** The lit share at the start and at the end of a leg. */
export function legFractions(split: boolean): readonly [number, number] {
  const [from, to] = legStates(split);
  return [LIT_FRACTION[from], LIT_FRACTION[to]];
}

/** What the shader needs for a leg: each end's lit share, and each end's look. */
export interface LegLook {
  readonly fractions: readonly [number, number];
  readonly looks: readonly [GlLook, GlLook];
}

/**
 * The look of each end of a leg. A state's look is the look for the number of
 * particles it lights: the hand's every particle (a dust, small and faint),
 * the stars' few (about the 2D look's size and glow). `drawn` particles of
 * `total` are drawn, `scale` is the sheet's CSS px per stage px.
 */
export function legLook(
  split: boolean,
  total: number,
  drawn: number,
  scale: number,
): LegLook {
  const [from, to] = legStates(split);
  const look = (state: StateName): GlLook => {
    const base = glLook(litCount(LIT_FRACTION[state], total, drawn), scale);
    const k = STAR_SIZE[state];
    return { ...base, brightPx: base.brightPx * k, dimPx: base.dimPx * k };
  };
  return { fractions: legFractions(split), looks: [look(from), look(to)] };
}

/**
 * The biggest point the stage ever asks the GPU for, in CSS px: the biggest
 * particle a look can have, at the top of the shimmer's swell. The GPU's
 * largest point must exceed this times the pixel ratio, with room to spare
 * (`pointSizeFits`).
 */
export function maxPointCssPx(): number {
  return (
    Math.max(LOOK_LIMITS.brightPx[1], LOOK_LIMITS.dimPx[1]) *
    Math.max(...Object.values(STAR_SIZE)) *
    (1 + SHIMMER_GROWTH)
  );
}
