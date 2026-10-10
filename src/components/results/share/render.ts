/**
 * The thin renderer: runs the layout's draw operations on a plain Canvas 2D and
 * returns a PNG. All the decisions (wrapping, sizes, what is shown) are in
 * `layout.ts`; this file only paints. Browser only.
 *
 * `qrcode` is loaded with a dynamic `import()` when a card is made, so it is in
 * no route's first-load JS (the results page's chunk loads it on the click).
 */
import type { UiLanguage } from "../../../client/uiLanguage";
import type { FitResponse } from "../../../lib/contracts/fit";
import { buildShareCardInput, topPickPhotoPath } from "./input";
import {
  PHOTO_RADIUS,
  QR_MIN_QUIET_MODULES,
  type ShareCardOptions,
  layoutShareCard,
  qrGrid,
  type Box,
  type ColorKey,
  type DrawOp,
} from "./layout";
import type { FontSpec, MeasureText } from "./text";
import {
  PALMATE_MARK_DOT,
  PALMATE_MARK_PATH,
  PALMATE_MARK_STROKE,
  PALMATE_MARK_STROKE_WIDTH,
  PALMATE_MARK_VIEWBOX,
} from "../../../lib/brand/palmate-mark";

/** The values of tokens.css, used when a token cannot be read. */
const TOKEN_FALLBACK = {
  "--bg": "#060709",
  "--text-primary": "#f5f5f7",
  "--text-secondary": "#a1a1a6",
  "--accent-text": "#7fa8ff",
  "--glow": "#3b82f6",
  "--sketch-line-detail": "#6e9bf5",
} as const;

const FALLBACK_STACK =
  'system-ui, "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';

interface Theme {
  bg: string;
  glow: string;
  detail: string;
  colors: Record<ColorKey, string>;
  fontStack: string;
}

function readTheme(): Theme {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const token = (name: keyof typeof TOKEN_FALLBACK) =>
    style.getPropertyValue(name).trim() || TOKEN_FALLBACK[name];
  return {
    bg: token("--bg"),
    // The glow is an 8-digit hex below; the high-contrast token is
    // "transparent", which that can not take, so the card keeps the default.
    glow: /^#[0-9a-f]{6}$/i.test(token("--glow"))
      ? token("--glow")
      : TOKEN_FALLBACK["--glow"],
    detail: token("--sketch-line-detail"),
    colors: {
      primary: token("--text-primary"),
      secondary: token("--text-secondary"),
      accent: token("--accent-text"),
    },
    // The site's own font stack (globals.css sets it on :root).
    fontStack: style.fontFamily.trim() || FALLBACK_STACK,
  };
}

function fontString(font: FontSpec, stack: string): string {
  return `${font.weight} ${font.size}px ${stack}`;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  box: Box,
  radius: number,
): void {
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, radius);
}

/** A generic mouse, seen from above, nose up. Not any real model. */
function drawSilhouette(
  ctx: CanvasRenderingContext2D,
  box: Box,
  color: string,
): void {
  const h = box.h * 0.74;
  const w = Math.min(h * 0.56, box.w * 0.6);
  const x = box.x + (box.w - w) / 2;
  const y = box.y + (box.h - h) / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 6;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0.5 * w, 0);
  ctx.bezierCurveTo(0.86 * w, 0, w, 0.18 * h, w, 0.42 * h);
  ctx.bezierCurveTo(w, 0.72 * h, 0.9 * w, h, 0.5 * w, h);
  ctx.bezierCurveTo(0.1 * w, h, 0, 0.72 * h, 0, 0.42 * h);
  ctx.bezierCurveTo(0, 0.18 * h, 0.14 * w, 0, 0.5 * w, 0);
  ctx.closePath();
  ctx.stroke();
  // The split between the two main buttons, and the line across them.
  ctx.beginPath();
  ctx.moveTo(0.5 * w, 0.01 * h);
  ctx.lineTo(0.5 * w, 0.3 * h);
  ctx.moveTo(0.03 * w, 0.34 * h);
  ctx.quadraticCurveTo(0.5 * w, 0.28 * h, 0.97 * w, 0.34 * h);
  ctx.stroke();
  // The wheel.
  ctx.beginPath();
  ctx.roundRect(0.5 * w - 0.045 * w, 0.1 * h, 0.09 * w, 0.11 * h, 0.04 * w);
  ctx.stroke();
  ctx.restore();
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawPhoto(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  box: Box,
  radius: number,
): void {
  const inset = 36;
  const maxW = box.w - 2 * inset;
  const maxH = box.h - 2 * inset;
  const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  ctx.save();
  roundRectPath(ctx, box, radius);
  ctx.clip();
  ctx.drawImage(img, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h);
  ctx.restore();
}

/** The Palmate mark, drawn from its path data scaled to `box`. */
function drawMark(ctx: CanvasRenderingContext2D, box: Box): void {
  const vb = PALMATE_MARK_VIEWBOX;
  const scale = box.w / vb.w;
  ctx.save();
  ctx.translate(box.x, box.y);
  ctx.scale(scale, scale);
  ctx.translate(-vb.x, -vb.y);
  ctx.strokeStyle = PALMATE_MARK_STROKE;
  ctx.lineWidth = PALMATE_MARK_STROKE_WIDTH;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke(new Path2D(PALMATE_MARK_PATH));
  // The core dot: a filled disc inside a ring whose outer edge is the radius.
  const d = PALMATE_MARK_DOT;
  ctx.beginPath();
  ctx.arc(d.cx, d.cy, d.outerRadius - d.ringWidth / 2, 0, Math.PI * 2);
  ctx.fillStyle = d.fillColor;
  ctx.fill();
  ctx.strokeStyle = d.ringColor;
  ctx.lineWidth = d.ringWidth;
  ctx.stroke();
  ctx.restore();
}

async function drawQr(
  ctx: CanvasRenderingContext2D,
  box: Box,
  text: string,
  dark: string,
): Promise<void> {
  const { default: QRCode } = await import("qrcode");
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const { step, offset } = qrGrid(box.w, size, QR_MIN_QUIET_MODULES);
  ctx.save();
  ctx.fillStyle = "#ffffff";
  roundRectPath(ctx, box, 28);
  ctx.fill();
  // Whole-pixel squares, no anti-aliased seams between neighbouring modules.
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = dark;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (qr.modules.get(row, col) === 1) {
        ctx.fillRect(
          box.x + offset + col * step,
          box.y + offset + row * step,
          step,
          step,
        );
      }
    }
  }
  ctx.restore();
}

async function paint(
  ctx: CanvasRenderingContext2D,
  ops: readonly DrawOp[],
  theme: Theme,
  photo: HTMLImageElement | null,
  width: number,
  height: number,
): Promise<void> {
  for (const op of ops) {
    switch (op.kind) {
      case "background": {
        ctx.fillStyle = theme.bg;
        ctx.fillRect(0, 0, width, height);
        const glow = ctx.createRadialGradient(540, 760, 0, 540, 760, 900);
        glow.addColorStop(0, `${theme.glow}30`);
        glow.addColorStop(1, `${theme.glow}00`);
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, width, height);
        break;
      }
      case "text": {
        ctx.font = fontString(op.font, theme.fontStack);
        ctx.fillStyle = theme.colors[op.color];
        ctx.textAlign = op.align;
        ctx.textBaseline = "alphabetic";
        ctx.fillText(op.text, op.x, op.baseline);
        break;
      }
      case "photoFrame": {
        const { box } = op;
        const g = ctx.createRadialGradient(
          box.x + box.w / 2,
          box.y + box.h / 2,
          0,
          box.x + box.w / 2,
          box.y + box.h / 2,
          box.w * 0.7,
        );
        g.addColorStop(0, "#14284f");
        g.addColorStop(1, "#0c0e13");
        ctx.fillStyle = g;
        roundRectPath(ctx, box, op.radius);
        ctx.fill();
        ctx.strokeStyle = "#ffffff24";
        ctx.lineWidth = 2;
        ctx.stroke();
        break;
      }
      case "photo": {
        if (photo) drawPhoto(ctx, photo, op.box, PHOTO_RADIUS);
        break;
      }
      case "silhouette":
        drawSilhouette(ctx, op.box, theme.detail);
        break;
      case "qr":
        await drawQr(ctx, op.box, op.text, theme.bg);
        break;
      case "mark":
        drawMark(ctx, op.box);
        break;
    }
  }
}

/** The card as a 1080 x 1920 PNG. Rejects if the canvas cannot be made. */
export async function makeShareCardPng(
  fit: FitResponse,
  lang: UiLanguage,
  options: ShareCardOptions = {},
): Promise<Blob> {
  // Fonts first: measuring and drawing before the site's font is ready would
  // wrap the text for one font and paint it in another.
  await document.fonts.ready;
  const theme = readTheme();

  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is not available.");

  const photoPath = topPickPhotoPath(fit);
  const photo = photoPath ? await loadImage(photoPath) : null;
  const input = buildShareCardInput(fit, lang, photo ? photoPath : null);
  if (!input) throw new Error("There is no result to share.");

  const measure: MeasureText = (text, font) => {
    ctx.font = fontString(font, theme.fontStack);
    return ctx.measureText(text).width;
  };
  const layout = layoutShareCard(input, measure, options);
  await paint(ctx, layout.ops, theme, photo, layout.width, layout.height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("The PNG could not be made.")),
      "image/png",
    );
  });
}
