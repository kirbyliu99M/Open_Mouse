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
  STAR_CLASSES,
  STAR_COUNTS,
  type Star,
  TRAIL,
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
  const ctx = canvas.getContext("2d", {
    willReadFrequently: true,
  }) as AnyContext | null;
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
  /** The meteors' heads (x, y each) and rest lengths, packed so a frame allocates nothing. */
  readonly meteorHead: Float32Array;
  readonly meteorLength: Float32Array;
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
  /**
   * The most live headline particles this drawing path may have: LIVE_MAX on
   * the WebGL path, and no more than the 2D budget on the Canvas 2D fallback.
   */
  readonly liveMax: number;
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

/**
 * Build the finale's layer for this layout. Null when it can not be built
 * whole: no glyphs, no canvas, a canvas that does not report its font's
 * ascent and descent (Firefox before 116), an empty mask, or no solid
 * letters. The stage then shows the headline as DOM text instead.
 */
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
  // The baseline comes from the font's own ascent and descent: a canvas that
  // does not report them can not place the letters where the page has them.
  const probe = mask.ctx.measureText("M");
  if (
    !Number.isFinite(probe.fontBoundingBoxAscent) ||
    !Number.isFinite(probe.fontBoundingBoxDescent)
  ) {
    return null;
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
  const cap = Math.max(1, Math.min(LIVE_MAX[tier], Math.floor(input.liveMax)));
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
  const centre: [number, number] = [(x0 + x1) / 2, (y0 + y1) / 2];
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
    const control = arcControl(
      source,
      target,
      (random() < 0.5 ? -1 : 1) * bend,
    );
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
  const solidCanvas = makeCanvas(maskWidth * dpr, maskHeight * dpr);
  const whiteCanvas = makeCanvas(maskWidth * dpr, maskHeight * dpr);
  if (!solidCanvas || !whiteCanvas) return null;
  {
    // The letters filled with a fine hexagonal field of dots (a pattern,
    // so this costs one fill, not a dot at a time: sampling the dots one by
    // one took about 300 ms at 4 times the CPU), over a faint plain fill so
    // they read as solid.
    const ctx = solidCanvas.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = font;
    ctx.fillStyle = "rgba(207, 224, 255, 0.28)";
    drawGlyphs(ctx, glyphs, -maskX, -maskY, 0);
    const pattern = dotPattern(ctx, SOLID_SPACING[tier], dpr);
    if (!pattern) return null;
    ctx.fillStyle = pattern;
    drawGlyphs(ctx, glyphs, -maskX, -maskY, 0);
    ctx.globalAlpha = 1;
    const w = whiteCanvas.ctx;
    w.setTransform(dpr, 0, 0, dpr, 0, 0);
    w.font = font;
    w.fillStyle = "#ffffff";
    drawGlyphs(w, glyphs, -maskX, -maskY, 0);
  }
  const solid = asImage(solidCanvas.canvas);
  const white = asImage(whiteCanvas.canvas);

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
    meteorHead: Float32Array.from(meteors.flatMap((m) => [...m.head])),
    meteorLength: Float32Array.from(meteors.map((m) => m.length)),
    drift: METEOR_DRIFT[tier],
    width: input.width,
    height: input.height,
  };
}

/**
 * A repeating tile of dots on a hexagonal grid `spacing` CSS px apart, in the
 * formed letters' brightest colours (finale-motion.ts's DEPTH_LAYERS), for a
 * canvas drawn at `dpr`. Null when no tile can be made.
 */
function dotPattern(
  ctx: AnyContext,
  spacing: number,
  dpr: number,
): CanvasPattern | null {
  const w = spacing;
  const h = spacing * Math.sqrt(3);
  const tile = makeCanvas(w * dpr, h * dpr);
  if (!tile) return null;
  const t = tile.ctx;
  t.setTransform(Math.ceil(w * dpr) / w, 0, 0, Math.ceil(h * dpr) / h, 0, 0);
  const dots: [number, number, number][] = [
    [w / 2, h / 4, 4],
    [0, (3 * h) / 4, 3],
    [w, (3 * h) / 4, 3],
  ];
  for (const [x, y, layer] of dots) {
    const look = DEPTH_LAYERS[layer]!;
    t.globalAlpha = look.alpha;
    t.fillStyle = look.colour;
    const r = (look.px * 0.82) / 2;
    t.beginPath();
    t.arc(x, y, r, 0, Math.PI * 2);
    t.fill();
  }
  const pattern = ctx.createPattern(tile.canvas, "repeat");
  if (!pattern) return null;
  // The tile is in device px: back to CSS px, where the context draws.
  pattern.setTransform(
    new DOMMatrix().scale(w / Math.ceil(w * dpr), h / Math.ceil(h * dpr)),
  );
  return pattern;
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

/** What a frame of the finale needs. The stage keeps one and fills it in each frame (no allocation per frame). */
export interface FinaleFrame {
  phase: FinalePhase;
  /** The story's progress (the meteors drift with it). */
  progress: number;
  /** How long the meteors' tails are, times their rest length (starfield.ts's trailScale of the scroll speed). */
  trail: number;
  /** False for prefers-contrast: more: no halos, no sweep light. */
  glow: boolean;
  /**
   * The share of the live headline particles to draw, 0 to 1: the slow-frame
   * guard's (degrade.ts) drawn share of the particle budget, so a slow device
   * draws fewer of these too. 1 on the Canvas 2D path.
   */
  share: number;
  /** False when the headline is shown as DOM text instead (forced colours): only the sky is drawn. */
  headline: boolean;
}

/**
 * Whether live headline particle `i` (in reading order) is drawn when only
 * `share` (0 to 1) of them are: an even pick, so any share is spread over the
 * whole headline, `floor(n * share)` of the first n in all.
 */
export function drawnAtShare(i: number, share: number): boolean {
  if (!(share > 0)) return false;
  if (share >= 1) return true;
  return Math.floor((i + 1) * share) !== Math.floor(i * share);
}

/** From a meteor's head back along its tail (up and to the right). */
const TAIL = tailDirection();

/** Draw the finale's layer for this frame. Nothing at all before the sky starts. */
export function drawFinale(
  ctx: CanvasRenderingContext2D,
  scene: FinaleScene,
  frame: FinaleFrame,
): void {
  const { phase } = frame;
  if (phase.sky > 0) drawSky(ctx, scene, frame);
  if (frame.headline && phase.gather > 0) drawHeadline(ctx, scene, frame);
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
  const drift = (frame.progress - 0.86) * (scene.drift / 0.28);
  const scale = Math.min(TRAIL.max, Math.max(1, frame.trail));
  ctx.lineCap = "round";
  ctx.strokeStyle = METEOR.colour;
  const quarters = METEOR.tail.length;
  const count = scene.meteorLength.length;
  for (let m = 0; m < count; m += 1) {
    // The same tail as starfield.ts's meteorSegments, without its arrays.
    const hx = scene.meteorHead[2 * m]! - TAIL[0] * drift;
    const hy = scene.meteorHead[2 * m + 1]! - TAIL[1] * drift;
    const len = scene.meteorLength[m]! * scale;
    for (let k = 0; k < quarters; k += 1) {
      const look = METEOR.tail[k]!;
      const from = (len * (quarters - k)) / quarters;
      const to = (len * (quarters - k - 1)) / quarters;
      ctx.globalAlpha = sky * look.alpha;
      ctx.lineWidth = look.width;
      ctx.beginPath();
      ctx.moveTo(hx + TAIL[0] * from, hy + TAIL[1] * from);
      ctx.lineTo(hx + TAIL[0] * to, hy + TAIL[1] * to);
      ctx.stroke();
    }
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

  // The live particles: waiting, flying, landed; none left of the core. A
  // guard that draws a share of the budget draws that share of these too,
  // evenly through their reading order.
  const fadeIn = Math.min(1, t / 0.12);
  const n = scene.count;
  const share = Math.min(1, Math.max(0, frame.share));
  const duration = GATHER.duration;
  for (let layer = 0; layer < DEPTH_LAYERS.length; layer += 1) {
    const look = DEPTH_LAYERS[layer]!;
    ctx.fillStyle = look.colour;
    ctx.globalAlpha = look.alpha * fadeIn;
    ctx.beginPath();
    const size = look.px;
    for (let i = 0; i < n; i += 1) {
      if (scene.layer[i] !== layer) continue;
      if (!drawnAtShare(i, share)) continue;
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
        x =
          u * u * scene.sx[i]! +
          2 * u * e * scene.cx[i]! +
          e * e * scene.tx[i]!;
        y =
          u * u * scene.sy[i]! +
          2 * u * e * scene.cy[i]! +
          e * e * scene.ty[i]!;
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
