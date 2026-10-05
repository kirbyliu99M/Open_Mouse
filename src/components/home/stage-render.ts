import { PALETTE, shimmerBoost } from "@/lib/particles/budget";
import type {
  Frame,
  ParticleSet,
  StageBox,
} from "@/lib/particles/particle-set";
import type { HandTarget } from "@/lib/particles/targets";
import type { Phase } from "@/lib/particles/timeline";

/**
 * Canvas 2D drawing for the home page's particle stage (Home v3, PR B). One
 * context, no CSS filters: a bright particle is a pre-rendered glow sprite
 * stamped with drawImage, and the dim ones are one batched path. The numbers
 * here (sizes, alphas) are looks, not budgets.
 *
 * It draws two things: the particles, when the stage has fallen back to Canvas
 * 2D (or never had WebGL), and the overlay, always. When WebGL draws the
 * particles (stage-gl.ts) this canvas is the layer on top of it and carries the
 * overlay alone.
 */

/** The key light and the landmark halos (the `--glow` token; decorative). */
const GLOW = hexToRgb(PALETTE.glow);
const PRIMARY = hexToRgb(PALETTE.primary);
const DETAIL = hexToRgb(PALETTE.detail);

function hexToRgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/** The size a bright particle is stamped at, in CSS px. The sprite itself is drawn larger, so it can swell during the shimmer. */
const BRIGHT_PX = 6;
const SPRITE_PX = 14;
const HALO_PX = 30;
/** A dim particle is a square this wide. */
const DIM_PX = 1.4;
/** The shimmer lights a dim particle above this share of the band. */
const LIT_DIM_FROM = 0.12;

export interface Sprites {
  readonly particle: CanvasImageSource;
  /** Null when the glow is switched off (prefers-contrast: more). */
  readonly halo: CanvasImageSource | null;
}

/**
 * A radial-gradient sprite. It is handed back as an ImageBitmap where
 * OffscreenCanvas exists: stamping a canvas element with drawImage makes the
 * browser snapshot it on every call, which is what costs the frame time with
 * hundreds of stamps (measured in a trace: one snapshot per stamp).
 */
function makeSprite(
  cssSize: number,
  dpr: number,
  stops: readonly (readonly [number, string])[],
): CanvasImageSource {
  const px = Math.max(1, Math.ceil(cssSize * dpr));
  const offscreen =
    typeof OffscreenCanvas === "undefined" ? null : new OffscreenCanvas(px, px);
  const canvas = offscreen ?? document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d") as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (ctx) {
    const gradient = ctx.createRadialGradient(
      px / 2,
      px / 2,
      0,
      px / 2,
      px / 2,
      px / 2,
    );
    for (const [at, colour] of stops) gradient.addColorStop(at, colour);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, px, px);
  }
  return offscreen ? offscreen.transferToImageBitmap() : canvas;
}

/** The pre-rendered glow sprites, made once per device pixel ratio. */
export function createSprites(dpr: number, glow: boolean): Sprites {
  return {
    particle: makeSprite(
      SPRITE_PX,
      dpr,
      glow
        ? [
            [0, `rgba(${PRIMARY}, 1)`],
            [0.16, `rgba(${PRIMARY}, 0.95)`],
            [0.3, `rgba(${DETAIL}, 0.3)`],
            [1, `rgba(${GLOW}, 0)`],
          ]
        : [
            [0, `rgba(${PRIMARY}, 1)`],
            [0.2, `rgba(${PRIMARY}, 0.95)`],
            [0.28, `rgba(${PRIMARY}, 0)`],
            [1, `rgba(${PRIMARY}, 0)`],
          ],
    ),
    halo: glow
      ? makeSprite(HALO_PX, dpr, [
          [0, `rgba(${GLOW}, 0.55)`],
          [0.5, `rgba(${GLOW}, 0.22)`],
          [1, `rgba(${GLOW}, 0)`],
        ])
      : null,
  };
}

export interface DrawState {
  /** The canvas's size in CSS px. */
  readonly width: number;
  readonly height: number;
  /**
   * The particles to draw on this canvas. Null when the WebGL stage draws
   * them on its own canvas underneath: this canvas then only carries the
   * overlay (the A4 corners, the skeleton, the measurement lines, the 21
   * landmarks).
   */
  readonly particles: {
    readonly set: ParticleSet;
    readonly frame: Frame;
  } | null;
  readonly phase: Phase;
  readonly sprites: Sprites;
  readonly hand: HandTarget;
  readonly handBox: StageBox;
  /** Where the shimmer's band is (0 to 1 across the logo), or null when it is not playing. */
  readonly shimmer: number | null;
}

export function drawStage(ctx: CanvasRenderingContext2D, s: DrawState): void {
  ctx.clearRect(0, 0, s.width, s.height);
  ctx.globalAlpha = 1;
  drawSheetCorners(ctx, s);
  if (s.particles) drawParticles(ctx, s, s.particles);
  drawHandOverlay(ctx, s);
  ctx.globalAlpha = 1;
}

/** The four corner marks of the A4 sheet, as in the static drawing (its outline is a CSS border). */
function drawSheetCorners(ctx: CanvasRenderingContext2D, s: DrawState): void {
  const alpha = s.phase.sheet;
  if (alpha <= 0) return;
  const { handBox: box, hand } = s;
  const k = box.scale;
  const w = hand.a4.width * k;
  const h = hand.a4.height * k;
  const c = 14 * k;
  ctx.globalAlpha = alpha * 0.4;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(1, 1.4 * k);
  ctx.lineCap = "round";
  ctx.beginPath();
  for (const [cx, cy, dx, dy] of [
    [0, 0, 1, 1],
    [w, 0, -1, 1],
    [w, h, -1, -1],
    [0, h, 1, -1],
  ] as const) {
    ctx.moveTo(box.x + cx + dx * c, box.y + cy);
    ctx.lineTo(box.x + cx, box.y + cy);
    ctx.lineTo(box.x + cx, box.y + cy + dy * c);
  }
  ctx.stroke();
}

function drawParticles(
  ctx: CanvasRenderingContext2D,
  s: DrawState,
  particles: NonNullable<DrawState["particles"]>,
): void {
  const { xy, bright } = particles.frame;
  const { shimmerX, count } = particles.set;
  const { particle } = s.sprites;
  const band = s.shimmer;
  const lit = (i: number) =>
    band === null ? 0 : shimmerBoost(shimmerX[i]!, band);

  // The dim ones are one path.
  ctx.fillStyle = `rgba(${DETAIL}, 0.72)`;
  ctx.beginPath();
  for (let i = 0; i < count; i += 1) {
    if (bright[i]! >= 0.5) continue;
    if (band !== null && lit(i) > LIT_DIM_FROM) continue;
    ctx.rect(
      xy[2 * i]! - DIM_PX / 2,
      xy[2 * i + 1]! - DIM_PX / 2,
      DIM_PX,
      DIM_PX,
    );
  }
  ctx.fill();

  // The bright ones, and any dim one the shimmer's band is on, are glow sprites.
  for (let i = 0; i < count; i += 1) {
    const isBright = bright[i]! >= 0.5;
    const boost = band === null ? 0 : lit(i);
    if (!isBright && boost <= LIT_DIM_FROM) continue;
    const size = (isBright ? BRIGHT_PX : BRIGHT_PX * 0.55) * (1 + 0.9 * boost);
    ctx.globalAlpha = isBright ? 1 : Math.min(1, 0.35 + boost);
    ctx.drawImage(
      particle,
      xy[2 * i]! - size / 2,
      xy[2 * i + 1]! - size / 2,
      size,
      size,
    );
  }
  ctx.globalAlpha = 1;
}

/**
 * Story 4: the 21 landmarks light in order, the skeleton draws, and the two
 * measurement lines extend with end ticks. No numbers, ever: this is an
 * illustration, not a user's measurement.
 */
function drawHandOverlay(ctx: CanvasRenderingContext2D, s: DrawState): void {
  const { phase, hand, handBox: box } = s;
  if (phase.overlay <= 0 || (phase.landmarks <= 0 && phase.lines <= 0)) return;
  const k = box.scale;
  const X = (x: number) => box.x + x * k;
  const Y = (y: number) => box.y + y * k;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // The skeleton, one edge after another.
  const edges = hand.skeleton;
  const reach = phase.skeleton * edges.length;
  if (reach > 0) {
    ctx.globalAlpha = phase.overlay * 0.9;
    ctx.strokeStyle = `rgb(${DETAIL})`;
    ctx.lineWidth = Math.max(1, k);
    ctx.beginPath();
    edges.forEach(([a, b], i) => {
      const share = Math.min(1, reach - i);
      if (share <= 0) return;
      const from = hand.landmarks[a]!;
      const to = hand.landmarks[b]!;
      ctx.moveTo(X(from[0]), Y(from[1]));
      ctx.lineTo(
        X(from[0] + (to[0] - from[0]) * share),
        Y(from[1] + (to[1] - from[1]) * share),
      );
    });
    ctx.stroke();
  }

  // The two measurement lines (and the length line's two extensions) extend
  // from one end; the end ticks appear when they arrive.
  if (phase.lines > 0) {
    const grow = (line: { from: readonly number[]; to: readonly number[] }) => {
      ctx.moveTo(X(line.from[0]!), Y(line.from[1]!));
      ctx.lineTo(
        X(line.from[0]! + (line.to[0]! - line.from[0]!) * phase.lines),
        Y(line.from[1]! + (line.to[1]! - line.from[1]!) * phase.lines),
      );
    };
    ctx.globalAlpha = phase.overlay * 0.55;
    ctx.strokeStyle = `rgb(${DETAIL})`;
    ctx.lineWidth = Math.max(1, k);
    ctx.beginPath();
    for (const extension of hand.lengthExtensions) grow(extension);
    ctx.stroke();

    ctx.globalAlpha = phase.overlay;
    ctx.lineWidth = Math.max(1, 1.4 * k);
    ctx.beginPath();
    grow(hand.lengthLine);
    grow(hand.widthLine);
    ctx.stroke();

    const tickAlpha = Math.max(0, (phase.lines - 0.85) / 0.15);
    if (tickAlpha > 0) {
      ctx.globalAlpha = phase.overlay * tickAlpha;
      ctx.beginPath();
      for (const tick of hand.ticks) {
        ctx.moveTo(X(tick.from[0]), Y(tick.from[1]));
        ctx.lineTo(X(tick.to[0]), Y(tick.to[1]));
      }
      ctx.stroke();
    }
  }

  // The landmarks, in order: a halo and a bright core each.
  if (phase.landmarks > 0) {
    const { halo } = s.sprites;
    hand.landmarks.forEach((point, index) => {
      const on = Math.min(1, Math.max(0, phase.landmarks - index));
      if (on <= 0) return;
      const x = X(point[0]);
      const y = Y(point[1]);
      if (halo) {
        const size = (HALO_PX * (0.55 + 0.45 * on) * Math.max(k, 0.8)) / 1.2;
        ctx.globalAlpha = phase.overlay * on;
        ctx.drawImage(halo, x - size / 2, y - size / 2, size, size);
      }
      ctx.globalAlpha = phase.overlay * on;
      ctx.fillStyle = `rgb(${PRIMARY})`;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.6, 2.4 * k * (0.6 + 0.4 * on)), 0, Math.PI * 2);
      ctx.fill();
    });
  }
}
