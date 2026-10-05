import {
  type LegWeights,
  interpolateAxis,
  legWeights,
  swirlDirection,
} from "./interpolate";
import { LOGO_BOX } from "./logo";
import { mulberry32 } from "./random";
import type { Pairing } from "./pairing";
import type { Phase } from "./timeline";

/**
 * The particles of the home page's story as typed arrays, and the function
 * that moves them (Home v3, PR B). Pure: the DOM glue measures the page, gives
 * this the boxes the targets should land in, and draws what comes out.
 */

/** Maps a target's own coordinates ("stage px") to canvas CSS px: X = x + px * scale. */
export interface StageBox {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The logo drawn where the static <img> is: the SVG is fitted inside the
 * image's box (object-fit: contain), so the scale is the smaller of the two
 * ratios and the mark is centred.
 */
export function logoBox(rect: Rect): StageBox {
  const scale = Math.min(
    rect.width / LOGO_BOX.width,
    rect.height / LOGO_BOX.height,
  );
  return {
    x: rect.x + (rect.width - LOGO_BOX.width * scale) / 2,
    y: rect.y + (rect.height - LOGO_BOX.height * scale) / 2,
    scale,
  };
}

/** The hand drawn where its static image is. The drawing's own viewBox starts at (viewBox.x, viewBox.y) in stage px. */
export function handBox(
  rect: Rect,
  viewBox: { readonly x: number; readonly y: number; readonly width: number },
): StageBox {
  const scale = rect.width / viewBox.width;
  return {
    x: rect.x - viewBox.x * scale,
    y: rect.y - viewBox.y * scale,
    scale,
  };
}

/** A mouse drawn where its static image is: the sketch's width (stage px) fills the image's width. */
export function mouseBox(rect: Rect, stageWidth: number): StageBox {
  return { x: rect.x, y: rect.y, scale: rect.width / stageWidth };
}

export interface StageLayout {
  /** The canvas's size in CSS px. */
  readonly width: number;
  readonly height: number;
  readonly logo: StageBox;
  readonly hand: StageBox;
  /** One box per mouse slot (top to bottom when stacked, left to right in a row). */
  readonly mice: readonly StageBox[];
}

/** How far a particle swings out sideways on its way, as a share of the canvas's shorter side. */
export const SWIRL = { form: 0.22, split: 0.18 } as const;
/** Each particle's own swing is between this share of the full amplitude and all of it. */
const MIN_SWING = 0.3;

export interface ParticleSet {
  readonly count: number;
  /** x, y per particle, in canvas CSS px, at each resting state. */
  readonly logo: Float32Array;
  readonly hand: Float32Array;
  readonly mouse: Float32Array;
  /** 1 for a bright particle, 0 for a dim one, at each resting state. */
  readonly toneLogo: Uint8Array;
  readonly toneHand: Uint8Array;
  readonly toneMouse: Uint8Array;
  /** The swirl vector at full amplitude (x, y per particle, canvas px), for logo to hand and for hand to mice. */
  readonly swirlForm: Float32Array;
  readonly swirlSplit: Float32Array;
  /** 0 at the logo's left edge to 1 at its right, for the shimmer. */
  readonly shimmerX: Float32Array;
}

/**
 * What a pairing fixes whatever the layout: the tones, the shimmer's x, and
 * each particle's swing and direction (the golden-angle swirl and the seeded
 * swing, before the canvas's reach scales them). A resize changes only where
 * things are, so these are made once per pairing and seed: with 20,000
 * particles the trigonometry and the random numbers were most of a rebuild.
 * The stage asks for them in a slice of their own, before the first layout.
 */
export interface PairingTables {
  readonly seed: number;
  readonly toneLogo: Uint8Array;
  readonly toneHand: Uint8Array;
  readonly toneMouse: Uint8Array;
  readonly shimmerX: Float32Array;
  /** direction * swing, x and y, for logo to hand and for hand to mice (doubles: the maths below is the same as it always was). */
  readonly formX: Float64Array;
  readonly formY: Float64Array;
  readonly splitX: Float64Array;
  readonly splitY: Float64Array;
}

const tablesOf = new WeakMap<Pairing, PairingTables>();

export function pairingTables(pairing: Pairing, seed: number): PairingTables {
  const known = tablesOf.get(pairing);
  if (known && known.seed === seed) return known;
  const n = pairing.count;
  const random = mulberry32(seed);
  const tables: PairingTables = {
    seed,
    toneLogo: new Uint8Array(n),
    toneHand: new Uint8Array(n),
    toneMouse: new Uint8Array(n),
    shimmerX: new Float32Array(n),
    formX: new Float64Array(n),
    formY: new Float64Array(n),
    splitX: new Float64Array(n),
    splitY: new Float64Array(n),
  };
  let minX = Infinity;
  let maxX = -Infinity;
  for (const p of pairing.logo) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
  }
  const span = maxX - minX || 1;
  for (let i = 0; i < n; i += 1) {
    const l = pairing.logo[i]!;
    tables.toneLogo[i] = l.tone;
    tables.toneHand[i] = pairing.hand[i]!.tone;
    tables.toneMouse[i] = pairing.mouse[i]!.tone;
    tables.shimmerX[i] = (l.x - minX) / span;
    // A golden-angle direction per particle; the second leg is turned by a
    // fixed angle so it does not retrace the first one's swings.
    const swing = MIN_SWING + (1 - MIN_SWING) * random();
    const form = swirlDirection(i);
    const split = swirlDirection(i, 1.9);
    tables.formX[i] = form[0] * swing;
    tables.formY[i] = form[1] * swing;
    tables.splitX[i] = split[0] * swing;
    tables.splitY[i] = split[1] * swing;
  }
  tablesOf.set(pairing, tables);
  return tables;
}

export function buildParticleSet(
  pairing: Pairing,
  layout: StageLayout,
  seed: number,
): ParticleSet {
  const n = pairing.count;
  const tables = pairingTables(pairing, seed);
  const reach = Math.min(layout.width, layout.height);
  const form = SWIRL.form;
  const split = SWIRL.split;
  const set: ParticleSet = {
    count: n,
    logo: new Float32Array(2 * n),
    hand: new Float32Array(2 * n),
    mouse: new Float32Array(2 * n),
    toneLogo: tables.toneLogo,
    toneHand: tables.toneHand,
    toneMouse: tables.toneMouse,
    swirlForm: new Float32Array(2 * n),
    swirlSplit: new Float32Array(2 * n),
    shimmerX: tables.shimmerX,
  };
  for (let i = 0; i < n; i += 1) {
    const l = pairing.logo[i]!;
    const h = pairing.hand[i]!;
    const m = pairing.mouse[i]!;
    const box = layout.mice[pairing.slot[i]!]!;
    set.logo[2 * i] = layout.logo.x + l.x * layout.logo.scale;
    set.logo[2 * i + 1] = layout.logo.y + l.y * layout.logo.scale;
    set.hand[2 * i] = layout.hand.x + h.x * layout.hand.scale;
    set.hand[2 * i + 1] = layout.hand.y + h.y * layout.hand.scale;
    set.mouse[2 * i] = box.x + m.x * box.scale;
    set.mouse[2 * i + 1] = box.y + m.y * box.scale;
    set.swirlForm[2 * i] = tables.formX[i]! * form * reach;
    set.swirlForm[2 * i + 1] = tables.formY[i]! * form * reach;
    set.swirlSplit[2 * i] = tables.splitX[i]! * split * reach;
    set.swirlSplit[2 * i + 1] = tables.splitY[i]! * split * reach;
  }
  return set;
}

export interface Frame {
  /** x, y per particle in canvas CSS px. */
  readonly xy: Float32Array;
  /** 0 (dim) to 1 (bright) per particle. */
  readonly bright: Float32Array;
}

export function createFrame(count: number): Frame {
  return { xy: new Float32Array(2 * count), bright: new Float32Array(count) };
}

/** Which leg of the story a phase is in, and how far along it: what both drawing paths read. */
export interface Leg {
  /** False: logo to hand. True: hand to the three mice. */
  readonly split: boolean;
  /** Progress along the leg, 0 to 1. */
  readonly t: number;
  /** The eased `e(t)` and the swing `sin(pi * e(t))`, exact at the ends of the leg. */
  readonly weights: LegWeights;
}

/**
 * Logo to hand while `formT` runs (the hand rests until the lines are drawn),
 * then hand to mice while `mouseT` runs. The one place that decides it: the
 * frame writer below (Canvas 2D) and the WebGL stage's uniforms both call it.
 */
export function legOf(phase: Pick<Phase, "formT" | "mouseT">): Leg {
  const split = phase.mouseT > 0;
  const t = split ? phase.mouseT : phase.formT;
  return { split, t, weights: legWeights(t) };
}

/**
 * Where every particle is at this phase: logo to hand while `formT` runs
 * (the hand rests until the lines are drawn), then hand to mice while `mouseT`
 * runs. The position is `a + (b - a) * e(t) + sin(pi * e(t)) * A`, with the
 * endpoints exact: at t = 0 and t = 1 every particle is on its target.
 */
export function writeParticles(
  set: ParticleSet,
  phase: Pick<Phase, "formT" | "mouseT">,
  frame: Frame,
): void {
  const { split, weights } = legOf(phase);
  const from = split ? set.hand : set.logo;
  const to = split ? set.mouse : set.hand;
  const toneFrom = split ? set.toneHand : set.toneLogo;
  const toneTo = split ? set.toneMouse : set.toneHand;
  const swirl = split ? set.swirlSplit : set.swirlForm;
  const { xy, bright } = frame;
  const n = set.count;
  for (let i = 0; i < n; i += 1) {
    const x = 2 * i;
    const y = x + 1;
    xy[x] = interpolateAxis(from[x]!, to[x]!, weights, swirl[x]!);
    xy[y] = interpolateAxis(from[y]!, to[y]!, weights, swirl[y]!);
    bright[i] = toneFrom[i]! + (toneTo[i]! - toneFrom[i]!) * weights.e;
  }
}
