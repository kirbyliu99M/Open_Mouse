import { interpolateAxis, legWeights, swirlDirection } from "./interpolate";
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

export function buildParticleSet(
  pairing: Pairing,
  layout: StageLayout,
  seed: number,
): ParticleSet {
  const n = pairing.count;
  const random = mulberry32(seed);
  const reach = Math.min(layout.width, layout.height);
  const set: ParticleSet = {
    count: n,
    logo: new Float32Array(2 * n),
    hand: new Float32Array(2 * n),
    mouse: new Float32Array(2 * n),
    toneLogo: new Uint8Array(n),
    toneHand: new Uint8Array(n),
    toneMouse: new Uint8Array(n),
    swirlForm: new Float32Array(2 * n),
    swirlSplit: new Float32Array(2 * n),
    shimmerX: new Float32Array(n),
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
    const h = pairing.hand[i]!;
    const m = pairing.mouse[i]!;
    const box = layout.mice[pairing.slot[i]!]!;
    set.logo[2 * i] = layout.logo.x + l.x * layout.logo.scale;
    set.logo[2 * i + 1] = layout.logo.y + l.y * layout.logo.scale;
    set.hand[2 * i] = layout.hand.x + h.x * layout.hand.scale;
    set.hand[2 * i + 1] = layout.hand.y + h.y * layout.hand.scale;
    set.mouse[2 * i] = box.x + m.x * box.scale;
    set.mouse[2 * i + 1] = box.y + m.y * box.scale;
    set.toneLogo[i] = l.tone;
    set.toneHand[i] = h.tone;
    set.toneMouse[i] = m.tone;
    set.shimmerX[i] = (l.x - minX) / span;
    // A golden-angle direction per particle; the second leg is turned by a
    // fixed angle so it does not retrace the first one's swings.
    const swing = MIN_SWING + (1 - MIN_SWING) * random();
    const form = swirlDirection(i);
    const split = swirlDirection(i, 1.9);
    set.swirlForm[2 * i] = form[0] * swing * SWIRL.form * reach;
    set.swirlForm[2 * i + 1] = form[1] * swing * SWIRL.form * reach;
    set.swirlSplit[2 * i] = split[0] * swing * SWIRL.split * reach;
    set.swirlSplit[2 * i + 1] = split[1] * swing * SWIRL.split * reach;
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
  const split = phase.mouseT > 0;
  const t = split ? phase.mouseT : phase.formT;
  const from = split ? set.hand : set.logo;
  const to = split ? set.mouse : set.hand;
  const toneFrom = split ? set.toneHand : set.toneLogo;
  const toneTo = split ? set.toneMouse : set.toneHand;
  const swirl = split ? set.swirlSplit : set.swirlForm;
  const { xy, bright } = frame;
  const n = set.count;
  const weights = legWeights(t);
  for (let i = 0; i < n; i += 1) {
    const x = 2 * i;
    const y = x + 1;
    xy[x] = interpolateAxis(from[x]!, to[x]!, weights, swirl[x]!);
    xy[y] = interpolateAxis(from[y]!, to[y]!, weights, swirl[y]!);
    bright[i] = toneFrom[i]! + (toneTo[i]! - toneFrom[i]!) * weights.e;
  }
}
