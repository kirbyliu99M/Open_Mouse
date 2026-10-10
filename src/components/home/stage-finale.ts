import {
  DEPTH_LAYERS,
  GATHER,
  GATHER_SPREAD,
  SWEEP,
  type SweepWidths,
  arcControl,
  depthOf,
  easeOutCubic,
  gatherDelay,
  scatterSource,
  sweepX,
} from "@/lib/particles/finale-motion";
import { type GlyphBox, labelsFromGlyphs } from "@/lib/particles/finale-shape";
import type { Rect } from "@/lib/particles/particle-set";
import { mulberry32 } from "@/lib/particles/random";
import {
  METEOR,
  METEOR_LAYOUT,
  type Meteor,
  STAR_CLASSES,
  STAR_COUNTS,
  type Star,
  TRAIL,
  meteorSegments,
  placeMeteors,
  placeStars,
  tailDirection,
} from "@/lib/particles/starfield";
import { sampleMask, spacingForCount } from "@/lib/particles/text-mask";
import type { FinalePhase } from "@/lib/particles/timeline";

/**
 * The home finale's 2D layer (stage 2): the headline that gathers out of
 * particles and is swept solid, and the sky behind it (still stars, meteors).
 * The hand on the mouse is the particle story's last state (the WebGL or 2D
 * particles); this is drawn on the 2D canvas over them.
 *
 * The headline is the real text of the page's `.story-finale-title` (it stays
 * in the DOM, transparent, for a screen reader). Its mask is drawn here with
 * the page's own font, glyph by glyph where the page laid each glyph out, on an
 * offscreen canvas: no font outline is stored anywhere. The pure parts (the
 * mask's particles, the motion, the sky) are in src/lib/particles/.
 *
 * Everything is built once per layout (`buildFinaleScene`); a frame only reads
 * the phase and draws (`drawFinale`). Every number is 未拍板 (candidate).
 */

/** The seed of the finale's own random choices. */
const FINALE_SEED = 20261011;

/** How far the hand's and the mouse's lines keep clear of a letter (px). The v7 look: about 3 to 4 px. */
export const CLIP_PX = 4;

/** At most this many live headline particles fly in (desktop, phone): the rest of the letters' look is the solid image. */
export const LIVE_MAX = { desktop: 2600, mobile: 1300 } as const;
/** The live particles' spacing, and the solid image's finer one (px). */
const LIVE_SPACING = { desktop: 2.3, mobile: 1.75 } as const;
const SOLID_SPACING = { desktop: 1.55, mobile: 1.3 } as const;

/** How far the meteors drift down their own line over the finale (px, as p runs 0.72 to 1): scroll-driven only. */
const METEOR_DRIFT = { desktop: 140, mobile: 70 } as const;

const PAD = CLIP_PX + 4;

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type AnyContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeCanvas(
  width: number,
  height: number,
): { canvas: AnyCanvas; ctx: AnyContext } | null {
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  const canvas =
    typeof OffscreenCanvas === "undefined"
      ? Object.assign(document.createElement("canvas"), { width: w, height: h })
      : new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as
    AnyContext | null;
  return ctx ? { canvas, ctx } : null;
}

function asImage(canvas: AnyCanvas): CanvasImageSource {
  return canvas instanceof HTMLCanvasElement
    ? canvas
    : canvas.transferToImageBitmap();
}

/** One glyph of the headline as the page laid it out, relative to the panel. */
interface Glyph {
  readonly ch: string;
  readonly rect: Rect;
  readonly line: number;
}

/** The headline's glyphs (spaces left out), by line, from the text's own layout (a Range per character). */
function readGlyphs(title: HTMLElement, origin: DOMRect): Glyph[] {
  const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  const glyphs: Glyph[] = [];
  let lastTop = -Infinity;
  let line = -1;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i]!;
      if (/\s/.test(ch)) continue;
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const r = range.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (r.top > lastTop + r.height * 0.5) {
        line += 1;
        lastTop = r.top;
      }
      glyphs.push({
        ch,
        rect: {
          x: r.left - origin.left,
          y: r.top - origin.top,
          width: r.width,
          height: r.height,
        },
        line,
      });
    }
  }
  range.detach();
  return glyphs;
}

/** The headline's computed font, as a canvas font. (Its letter spacing is in the glyphs' own places: each glyph is drawn where the page put it.) */
function fontOf(element: HTMLElement): string {
  const style = getComputedStyle(element);
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
}

export interface FinaleScene {
  /** The headline's box on the canvas (CSS px), the mask's origin and size. */
  readonly title: Rect;
  readonly maskX: number;
  readonly maskY: number;
  readonly maskWidth: number;
  readonly maskHeight: number;
  /** The grown letters (CLIP_PX), 1 per CSS px: where the figure's lines are cut. */
  readonly blocked: Uint8Array;
  /** Live particles: target, source, control (canvas px), delay, depth layer. */
  readonly count: number;
  readonly tx: Float32Array;
  readonly ty: Float32Array;
  readonly sx: Float32Array;
  readonly sy: Float32Array;
  readonly cx: Float32Array;
  readonly cy: Float32Array;
  readonly delay: Float32Array;
  readonly layer: Uint8Array;
  /** The formed letters, as fine dots, and as plain white letters (for the sweep's light). */
  readonly solid: CanvasImageSource | null;
  readonly white: CanvasImageSource | null;
  readonly sweep: SweepWidths;
  readonly stars: CanvasImageSource | null;
  readonly meteors: readonly Meteor[];
  readonly drift: number;
  readonly width: number;
  readonly height: number;
}

export interface SceneInput {
  readonly title: HTMLElement;
  /** The panel's client rect: everything is relative to it. */
  readonly origin: DOMRect;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly wide: boolean;
  /** Where no star or meteor goes (canvas px): the figure, the buttons. */
  readonly avoid: readonly Rect[];
}

/** Whether (x, y) on the canvas is under the headline's grown letters. */
export function isBlocked(scene: FinaleScene, x: number, y: number): boolean {
  const i = Math.floor(x - scene.maskX);
  const j = Math.floor(y - scene.maskY);
  if (i < 0 || j < 0 || i >= scene.maskWidth || j >= scene.maskHeight) {
    return false;
  }
  return scene.blocked[j * scene.maskWidth + i] === 1;
}

function drawGlyphs(
  ctx: AnyContext,
  glyphs: readonly Glyph[],
  dx: number,
  dy: number,
  stroke: number,
): void {
  for (const g of glyphs) {
    const m = ctx.measureText(g.ch);
    const ascent = m.fontBoundingBoxAscent;
    const descent = m.fontBoundingBoxDescent;
    // The glyph's box is its line's content area: the baseline sits the
    // font's ascent below its top (centred, should the two disagree).
    const baseline =
      g.rect.y + (g.rect.height - (ascent + descent)) / 2 + ascent;
    const x = g.rect.x + dx;
    const y = baseline + dy;
    ctx.fillText(g.ch, x, y);
    if (stroke > 0) ctx.strokeText(g.ch, x, y);
  }
}

/** Build the finale's layer for this layout. Null when the headline has no glyphs or no canvas can be made. */
export function buildFinaleScene(input: SceneInput): FinaleScene | null {
  const { title, origin, wide } = input;
  const glyphs = readGlyphs(title, origin);
  if (glyphs.length === 0) return null;
  const tier = wide ? "desktop" : "mobile";
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const g of glyphs) {
    x0 = Math.min(x0, g.rect.x);
    y0 = Math.min(y0, g.rect.y);
    x1 = Math.max(x1, g.rect.x + g.rect.width);
    y1 = Math.max(y1, g.rect.y + g.rect.height);
  }
  const maskX = Math.floor(x0) - PAD;
  const maskY = Math.floor(y0) - PAD;
  const maskWidth = Math.ceil(x1 - maskX) + PAD;
  const maskHeight = Math.ceil(y1 - maskY) + PAD;
  const font = fontOf(title);

  // The letters, then the letters grown by CLIP_PX, at 1 px per CSS px.
  const mask = makeCanvas(maskWidth, maskHeight);
  const grown = makeCanvas(maskWidth, maskHeight);
  if (!mask || !grown) return null;
  for (const { ctx } of [mask, grown]) {
    ctx.font = font;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#fff";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2 * CLIP_PX;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  }
  drawGlyphs(mask.ctx, glyphs, -maskX, -maskY, 0);
  drawGlyphs(grown.ctx, glyphs, -maskX, -maskY, 2 * CLIP_PX);
  const alpha = (ctx: AnyContext) => {
    const data = ctx.getImageData(0, 0, maskWidth, maskHeight).data;
    const out = new Uint8Array(maskWidth * maskHeight);
    for (let i = 0; i < out.length; i += 1) out[i] = data[4 * i + 3]!;
    return out;
  };
  const letterAlpha = alpha(mask.ctx);
  const grownAlpha = alpha(grown.ctx);
  const blocked = new Uint8Array(grownAlpha.length);
  for (let i = 0; i < blocked.length; i += 1) {
    blocked[i] = grownAlpha[i]! >= 128 ? 1 : 0;
  }

  const boxes: GlyphBox[] = glyphs.map((g) => ({
    left: g.rect.x - maskX,
    right: g.rect.x + g.rect.width - maskX,
    top: g.rect.y - maskY,
    bottom: g.rect.y + g.rect.height - maskY,
    line: g.line,
  }));
  const letters = labelsFromGlyphs(maskWidth, maskHeight, boxes);
  let area = 0;
  for (const a of letterAlpha) if (a >= 128) area += 1;
  if (area === 0) return null;

  // The live particles: the tier's spacing, or wider to stay near the cap.
  const cap = LIVE_MAX[tier];
  const live = sampleMask(letterAlpha, maskWidth, maskHeight, {
    spacing: Math.max(LIVE_SPACING[tier], spacingForCount(area, cap)),
    letters,
    seed: FINALE_SEED,
    maxCount: cap,
  });
  const n = live.particles.length;
  const letterCount = Math.max(1, live.letters.length);
  const random = mulberry32(FINALE_SEED + 1);
  const gauss = () => {
    const r = Math.sqrt(-2 * Math.log(1 - random()));
    return r * Math.cos(2 * Math.PI * random());
  };
  const centre: [number, number] = [
    (x0 + x1) / 2,
    (y0 + y1) / 2,
  ];
  const spread = GATHER_SPREAD[tier];
  const scene = {
    tx: new Float32Array(n),
    ty: new Float32Array(n),
    sx: new Float32Array(n),
    sy: new Float32Array(n),
    cx: new Float32Array(n),
    cy: new Float32Array(n),
    delay: new Float32Array(n),
    layer: new Uint8Array(n),
  };
  live.particles.forEach((p, i) => {
    const target: [number, number] = [p.x + maskX, p.y + maskY];
    const source = scatterSource(target, centre, [gauss(), gauss()], spread);
    const bend = GATHER.bendMin + GATHER.bendRange * random();
    const control = arcControl(source, target, (random() < 0.5 ? -1 : 1) * bend);
    scene.tx[i] = target[0];
    scene.ty[i] = target[1];
    scene.sx[i] = source[0];
    scene.sy[i] = source[1];
    scene.cx[i] = control[0];
    scene.cy[i] = control[1];
    scene.delay[i] = gatherDelay(p.letter, letterCount, random());
    scene.layer[i] = depthOf(target[0], target[1], random()).layer;
  });

  // The solid letters: a finer field of the same dots, drawn once at the
  // device's pixel ratio; and the plain white letters for the sweep's light.
  const dpr = input.dpr;
  let solid: CanvasImageSource | null = null;
  let white: CanvasImageSource | null = null;
  const solidCanvas = makeCanvas(maskWidth * dpr, maskHeight * dpr);
  const whiteCanvas = makeCanvas(maskWidth * dpr, maskHeight * dpr);
  if (solidCanvas && whiteCanvas) {
    const fine = sampleMask(letterAlpha, maskWidth, maskHeight, {
      spacing: SOLID_SPACING[tier],
      letters,
      seed: FINALE_SEED + 2,
      jitter: 0.18,
    });
    const r = mulberry32(FINALE_SEED + 3);
    const ctx = solidCanvas.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // A faint fill under the dots, so the letters read as solid.
    ctx.font = font;
    ctx.fillStyle = "rgba(207, 224, 255, 0.28)";
    drawGlyphs(ctx, glyphs, -maskX, -maskY, 0);
    DEPTH_LAYERS.forEach((look, layer) => {
      ctx.fillStyle = look.colour;
      ctx.globalAlpha = look.alpha;
      ctx.beginPath();
      for (const p of fine.particles) {
        if (depthOf(p.x + maskX, p.y + maskY, r()).layer !== layer) continue;
        const s = look.px * 0.82;
        ctx.rect(p.x - s / 2, p.y - s / 2, s, s);
      }
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    solid = asImage(solidCanvas.canvas);
    const w = whiteCanvas.ctx;
    w.setTransform(dpr, 0, 0, dpr, 0, 0);
    w.font = font;
    w.fillStyle = "#ffffff";
    drawGlyphs(w, glyphs, -maskX, -maskY, 0);
    white = asImage(whiteCanvas.canvas);
  }

  // The sky: still stars, drawn once; meteors, drawn each frame.
  const titleBox: Rect = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  const avoid = [titleBox, ...input.avoid];
  const counts = STAR_COUNTS[tier];
  const stars = placeStars({
    width: input.width,
    height: input.height,
    seed: FINALE_SEED + 4,
    counts,
    avoid,
    padding: 10,
  });
  const meteors = placeMeteors({
    width: input.width,
    height: input.height,
    seed: FINALE_SEED + 5,
    count: METEOR_LAYOUT[tier].count,
    length: METEOR_LAYOUT[tier].length,
    avoid,
    padding: 12,
  });
  return {
    title: titleBox,
    maskX,
    maskY,
    maskWidth,
    maskHeight,
    blocked,
    count: n,
    ...scene,
    solid,
    white,
    sweep: SWEEP[tier],
    stars: drawStars(stars, input.width, input.height, dpr),
    meteors,
    drift: METEOR_DRIFT[tier],
    width: input.width,
    height: input.height,
  };
}

function drawStars(
  stars: readonly Star[],
  width: number,
  height: number,
  dpr: number,
): CanvasImageSource | null {
  const layer = makeCanvas(width * dpr, height * dpr);
  if (!layer) return null;
  const { ctx } = layer;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  STAR_CLASSES.forEach((cls, index) => {
    ctx.fillStyle = cls.colour;
    ctx.globalAlpha = cls.alpha;
    ctx.beginPath();
    for (const s of stars) {
      if (s.cls !== index) continue;
      ctx.moveTo(s.x + cls.px / 2, s.y);
      ctx.arc(s.x, s.y, cls.px / 2, 0, Math.PI * 2);
    }
    ctx.fill();
  });
  return asImage(layer.canvas);
}

export interface FinaleFrame {
  readonly phase: FinalePhase;
  /** The story's progress (the meteors drift with it). */
  readonly progress: number;
  /** How long the meteors' tails are, times their rest length (starfield.ts's trailScale of the scroll speed). */
  readonly trail: number;
  /** False for prefers-contrast: more: no halos, no sweep light. */
  readonly glow: boolean;
}

/** Draw the finale's layer for this frame. Nothing at all before the sky starts. */
export function drawFinale(
  ctx: CanvasRenderingContext2D,
  scene: FinaleScene,
  frame: FinaleFrame,
): void {
  const { phase } = frame;
  if (phase.sky > 0) drawSky(ctx, scene, frame);
  if (phase.gather > 0) drawHeadline(ctx, scene, frame);
  ctx.globalAlpha = 1;
}

function drawSky(
  ctx: CanvasRenderingContext2D,
  scene: FinaleScene,
  frame: FinaleFrame,
): void {
  const sky = frame.phase.sky;
  if (scene.stars) {
    ctx.globalAlpha = sky;
    ctx.drawImage(scene.stars, 0, 0, scene.width, scene.height);
  }
  const dir = tailDirection();
  const drift = (frame.progress - 0.86) * (scene.drift / 0.28);
  const scale = Math.min(TRAIL.max, Math.max(1, frame.trail));
  ctx.lineCap = "round";
  ctx.strokeStyle = METEOR.colour;
  for (const meteor of scene.meteors) {
    const moved: Meteor = {
      head: [meteor.head[0] - dir[0] * drift, meteor.head[1] - dir[1] * drift],
      length: meteor.length,
    };
    for (const seg of meteorSegments(moved, scale)) {
      ctx.globalAlpha = sky * seg.alpha;
      ctx.lineWidth = seg.width;
      ctx.beginPath();
      ctx.moveTo(seg.from[0], seg.from[1]);
      ctx.lineTo(seg.to[0], seg.to[1]);
      ctx.stroke();
    }
    const [hx, hy] = moved.head;
    if (frame.glow) {
      ctx.globalAlpha = sky * METEOR.halo.alpha;
      ctx.fillStyle = METEOR.halo.colour;
      ctx.beginPath();
      ctx.arc(hx, hy, METEOR.halo.px / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = sky * METEOR.head.alpha;
    ctx.fillStyle = METEOR.head.colour;
    ctx.beginPath();
    ctx.arc(hx, hy, METEOR.head.px / 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHeadline(
  ctx: CanvasRenderingContext2D,
  scene: FinaleScene,
  frame: FinaleFrame,
): void {
  const t = frame.phase.gather;
  const s = frame.phase.sweep;
  const left = scene.title.x;
  const right = scene.title.x + scene.title.width;
  const widths = scene.sweep;
  const at = s > 0 ? sweepX(s, left, right, widths) : -Infinity;
  const back = at - widths.core;
  const top = scene.maskY;
  const height = scene.maskHeight;
  const imgW = scene.maskWidth;

  // The solid letters, left of the sweep's core.
  if (s > 0 && scene.solid && back > scene.maskX) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(scene.maskX, top, back - scene.maskX, height);
    ctx.clip();
    ctx.globalAlpha = 1;
    ctx.drawImage(scene.solid, scene.maskX, top, imgW, height);
    if (frame.glow && scene.white && widths.afterglow > 0) {
      // The afterglow: brighter nearer the core, in four strips.
      for (let k = 0; k < 4; k += 1) {
        const from = back - (widths.afterglow * (4 - k)) / 4;
        const to = back - (widths.afterglow * (3 - k)) / 4;
        ctx.save();
        ctx.beginPath();
        ctx.rect(from, top, to - from, height);
        ctx.clip();
        ctx.globalAlpha = 0.07 + 0.09 * k;
        ctx.drawImage(scene.white, scene.maskX, top, imgW, height);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  // The live particles: waiting, flying, landed; none left of the core.
  const fadeIn = Math.min(1, t / 0.12);
  const n = scene.count;
  const duration = GATHER.duration;
  for (let layer = 0; layer < DEPTH_LAYERS.length; layer += 1) {
    const look = DEPTH_LAYERS[layer]!;
    ctx.fillStyle = look.colour;
    ctx.globalAlpha = look.alpha * fadeIn;
    ctx.beginPath();
    const size = look.px;
    for (let i = 0; i < n; i += 1) {
      if (scene.layer[i] !== layer) continue;
      if (scene.tx[i]! < back) continue;
      const q = (t - scene.delay[i]!) / duration;
      let x: number;
      let y: number;
      if (q <= 0) {
        x = scene.sx[i]!;
        y = scene.sy[i]!;
      } else if (q >= 1) {
        x = scene.tx[i]!;
        y = scene.ty[i]!;
      } else {
        const e = easeOutCubic(q);
        const u = 1 - e;
        x = u * u * scene.sx[i]! + 2 * u * e * scene.cx[i]! + e * e * scene.tx[i]!;
        y = u * u * scene.sy[i]! + 2 * u * e * scene.cy[i]! + e * e * scene.ty[i]!;
      }
      const k = q <= 0 ? 0.7 : 1;
      ctx.rect(x - (size * k) / 2, y - (size * k) / 2, size * k, size * k);
    }
    ctx.fill();
  }

  // The sweep's core: a band of white heat on the letters.
  if (s > 0 && s < 1 && frame.glow && scene.white) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(at - 1.7 * widths.core, top, 2.25 * widths.core, height);
    ctx.clip();
    ctx.globalAlpha = 0.9;
    ctx.drawImage(scene.white, scene.maskX, top, imgW, height);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}
