/**
 * The share card's layout, pure: inputs in, a list of draw operations out.
 * `render.ts` runs the operations on a 1080 x 1920 canvas; nothing here touches
 * a canvas, a DOM or a network, so the wrapping of a long model name, the card
 * with no hand type and the card with no photo are unit-tested.
 *
 * Privacy (AGENTS.md hard rule 5 and the brief): nothing on the card is a
 * measurement. The only numbers are the fit total (from the fit response) and
 * the QR code, which points at the site root and carries no per-person value.
 */
import type { UiLanguage } from "../../../client/uiLanguage";
import type { HandType } from "../../../lib/contracts/fit";
import { shareCardCopy } from "../../../lib/copy/share-card";
import { SITE_NAME, SITE_URL } from "../../../lib/site";
import {
  clampLines,
  fitLine,
  wrapParts,
  wrapText,
  type FontSpec,
  type MeasureText,
} from "./text";

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1920;
export const CARD_PADDING = 84;
export const CONTENT_WIDTH = CARD_WIDTH - 2 * CARD_PADDING;

export const QR_SIZE = 216;
export const PHOTO_RADIUS = 48;
/** The photo frame is never shorter than this; the layout is built so it never has to be. */
export const MIN_PHOTO_HEIGHT = 300;
/** The frame stops growing here; with no header (fit-v0) it may be taller, since it starts the card. */
const MAX_PHOTO_HEIGHT = 780;
const MAX_PHOTO_HEIGHT_NO_HEADER = 1000;
const SCORE_FONT: FontSpec = { size: 192, weight: 800 };

export type ColorKey = "primary" | "secondary" | "accent";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type DrawOp =
  | { kind: "background" }
  | {
      kind: "text";
      text: string;
      /** Left edge, or right edge when `align` is "right". */
      x: number;
      /** Alphabetic baseline. */
      baseline: number;
      font: FontSpec;
      color: ColorKey;
      align: "left" | "right";
    }
  | { kind: "photoFrame"; box: Box; radius: number }
  /** The official product photo, drawn "contain" inside the frame. */
  | { kind: "photo"; box: Box; src: string }
  /** A neutral mouse outline, shown when there is no photo. */
  | { kind: "silhouette"; box: Box }
  | { kind: "qr"; box: Box; text: string };

export interface ShareCardInput {
  lang: UiLanguage;
  /** Missing under fit-v0, which sends none. Then the card starts at the photo. */
  handType?: HandType;
  brand: string;
  model: string;
  /** The fit total, 0 to 100, from the fit response. */
  total: number;
  /** The band's name in `lang`, or null when none applies. */
  bandLabel: string | null;
  /** A site-relative path that has already loaded, or null for the silhouette. */
  photoSrc: string | null;
}

export interface ShareCardLayout {
  width: number;
  height: number;
  ops: DrawOp[];
  photoBox: Box;
  /** True when the hand-type title and kicker are on the card. */
  hasHeader: boolean;
}

/** A path on this site: one leading slash, not `//`, no backslash, no `..`. */
export function isSitePath(value: string | null | undefined): value is string {
  return (
    typeof value === "string" &&
    /^\/[^/\\]/.test(value) &&
    !value.includes("\\") &&
    !value.split("/").includes("..")
  );
}

/**
 * Where a QR code's modules go inside its white panel: a whole-pixel step per
 * module (so no module is wider than its slot and none overlaps the next) and
 * the offset that centres the code. `quiet` is the margin in modules. The
 * remainder after the integer step is split evenly around the code.
 */
export function qrGrid(
  panelSize: number,
  modules: number,
  quiet: number,
): { step: number; offset: number } {
  const step = Math.max(1, Math.floor(panelSize / (modules + 2 * quiet)));
  const offset = Math.floor((panelSize - step * modules) / 2);
  return { step, offset };
}

/** What the card's QR code encodes: the site root, always. */
export function shareQrTarget(): string {
  return SITE_URL;
}

const f = (size: number, weight: FontSpec["weight"]): FontSpec => ({
  size,
  weight,
});

const LINE = 1.22;

export function layoutShareCard(
  input: ShareCardInput,
  measure: MeasureText,
): ShareCardLayout {
  const copy = shareCardCopy(input.lang);
  const ops: DrawOp[] = [{ kind: "background" }];
  const text = (
    value: string,
    x: number,
    baseline: number,
    font: FontSpec,
    color: ColorKey,
    align: "left" | "right" = "left",
  ) => ops.push({ kind: "text", text: value, x, baseline, font, color, align });

  // Header: kicker, hand-type title, one sentence about the mouse.
  let cursor = CARD_PADDING + 12;
  const hasHeader = input.handType !== undefined;
  if (input.handType) {
    const kickerFont = f(36, 600);
    text(
      copy.kicker,
      CARD_PADDING,
      cursor + kickerFont.size,
      kickerFont,
      "accent",
    );
    cursor += kickerFont.size * LINE + 28;

    const parts = [
      copy.size[input.handType.size],
      copy.grip[input.handType.grip],
      copy.width[input.handType.width],
    ];
    // The largest size that fits two lines; failing that, the smallest, clamped to three.
    let titleFont = f(60, 800);
    let titleLines: string[] = [];
    for (const size of [84, 72, 60]) {
      titleFont = f(size, 800);
      titleLines = wrapParts(
        parts,
        copy.partSeparator,
        CONTENT_WIDTH,
        titleFont,
        measure,
      );
      if (titleLines.length <= 2) break;
    }
    titleLines = clampLines(titleLines, 3, CONTENT_WIDTH, titleFont, measure);
    for (const line of titleLines) {
      text(line, CARD_PADDING, cursor + titleFont.size, titleFont, "primary");
      cursor += titleFont.size * LINE;
    }
    cursor += 20;

    const sentenceFont = f(39, 400);
    const sentenceLines = clampLines(
      wrapText(
        copy.sentence(input.handType),
        CONTENT_WIDTH,
        sentenceFont,
        measure,
      ),
      2,
      CONTENT_WIDTH,
      sentenceFont,
      measure,
    );
    for (const line of sentenceLines) {
      text(
        line,
        CARD_PADDING,
        cursor + sentenceFont.size,
        sentenceFont,
        "secondary",
      );
      cursor += sentenceFont.size * 1.4;
    }
  }
  const headerBottom = cursor;

  // Footer: site name, tagline, QR. Fixed to the bottom edge.
  const footerTop = CARD_HEIGHT - CARD_PADDING - QR_SIZE;
  const qrBox: Box = {
    x: CARD_WIDTH - CARD_PADDING - QR_SIZE,
    y: footerTop,
    w: QR_SIZE,
    h: QR_SIZE,
  };
  const footerTextWidth = qrBox.x - CARD_PADDING - 36;
  const nameFont = f(48, 700);
  const taglineFont = f(36, 400);
  text(
    fitLine(SITE_NAME, footerTextWidth, nameFont, measure),
    CARD_PADDING,
    footerTop + QR_SIZE / 2 - 6,
    nameFont,
    "primary",
  );
  text(
    fitLine(copy.tagline, footerTextWidth, taglineFont, measure),
    CARD_PADDING,
    footerTop + QR_SIZE / 2 + 52,
    taglineFont,
    "secondary",
  );
  ops.push({ kind: "qr", box: qrBox, text: shareQrTarget() });

  // Result block: label, brand, model, band on the left; the score on the right.
  const scoreText = String(input.total);
  const scoreWidth = measure(scoreText, SCORE_FONT);
  const columnWidth = Math.max(240, CONTENT_WIDTH - scoreWidth - 48);
  const labelFont = f(36, 400);
  const brandFont = f(38, 400);
  // The largest size that keeps the name on one line; failing that, the
  // largest that fits two; failing that, the smallest, cut with an ellipsis.
  const MODEL_SIZES = [64, 56, 48];
  let modelFont = f(48, 700);
  let modelLines: string[] = [];
  for (const size of MODEL_SIZES) {
    const font = f(size, 700);
    const lines = wrapText(input.model, columnWidth, font, measure);
    if (lines.length === 1) {
      modelFont = font;
      modelLines = lines;
      break;
    }
  }
  if (modelLines.length === 0) {
    for (const size of MODEL_SIZES) {
      modelFont = f(size, 700);
      modelLines = wrapText(input.model, columnWidth, modelFont, measure);
      if (modelLines.length <= 2) break;
    }
  }
  modelLines = clampLines(modelLines, 2, columnWidth, modelFont, measure);
  const bandFont = f(40, 700);

  const labelH = labelFont.size * LINE;
  const brandH = brandFont.size * LINE;
  const modelH = modelLines.length * modelFont.size * LINE;
  const bandH = input.bandLabel ? 16 + bandFont.size * LINE : 0;
  const leftH = labelH + 28 + brandH + 4 + modelH + bandH;
  const scoreH = SCORE_FONT.size * 0.82 + 12 + 36 * LINE;
  const resultH = Math.max(leftH, labelH + 28 + scoreH);
  const resultTop = footerTop - 72 - resultH;

  let y = resultTop;
  text(
    copy.topPickLabel,
    CARD_PADDING,
    y + labelFont.size,
    labelFont,
    "secondary",
  );
  y += labelH + 28;
  const brandTop = y;
  text(
    fitLine(input.brand, columnWidth, brandFont, measure),
    CARD_PADDING,
    y + brandFont.size,
    brandFont,
    "secondary",
  );
  y += brandH + 4;
  for (const line of modelLines) {
    text(line, CARD_PADDING, y + modelFont.size, modelFont, "primary");
    y += modelFont.size * LINE;
  }
  if (input.bandLabel) {
    y += 16;
    text(
      fitLine(input.bandLabel, columnWidth, bandFont, measure),
      CARD_PADDING,
      y + bandFont.size,
      bandFont,
      "accent",
    );
  }
  const scoreBaseline = brandTop + SCORE_FONT.size * 0.82;
  text(
    scoreText,
    CARD_WIDTH - CARD_PADDING,
    scoreBaseline,
    SCORE_FONT,
    "primary",
    "right",
  );
  text(
    fitLine(copy.scoreLabel, 360, f(36, 400), measure),
    CARD_WIDTH - CARD_PADDING,
    scoreBaseline + 12 + 36,
    f(36, 400),
    "secondary",
    "right",
  );

  // Photo: whatever is left between the header and the result block.
  const gap = hasHeader ? 48 : 0;
  const availTop = headerBottom + gap;
  const availBottom = resultTop - 48;
  const avail = Math.max(MIN_PHOTO_HEIGHT, availBottom - availTop);
  const photoH = Math.min(
    avail,
    hasHeader ? MAX_PHOTO_HEIGHT : MAX_PHOTO_HEIGHT_NO_HEADER,
  );
  const photoBox: Box = {
    x: CARD_PADDING,
    y: availTop + Math.round((avail - photoH) / 2),
    w: CONTENT_WIDTH,
    h: photoH,
  };
  ops.push({ kind: "photoFrame", box: photoBox, radius: PHOTO_RADIUS });
  if (input.photoSrc !== null && isSitePath(input.photoSrc)) {
    ops.push({ kind: "photo", box: photoBox, src: input.photoSrc });
  } else {
    ops.push({ kind: "silhouette", box: photoBox });
  }

  return {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    ops,
    photoBox,
    hasHeader,
  };
}
