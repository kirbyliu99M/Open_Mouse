/**
 * v3.4 card mode (review G5, candidate 未拍板): where the live card screen's
 * pieces sit, as rectangles, so "nothing overlaps" can be checked without a
 * browser. The sizes mirror the CSS (camera.css, easy-scan.css,
 * manual-entry.css); `CARD_CHROME` is what the rules below use.
 *
 * The rule the screen follows:
 * - top band: the cue pill, then the card rule, then (iOS, no sensor yet)
 *   the 開啟水平提示 button, each in its own row (EasyScanCamera.tsx,
 *   `.cameraCueWrap`);
 * - the wrist label at the reference line's left end, just above it, and
 *   never lower than just above the dock (`guideLabelTop`, the overlay is
 *   given the dock's top);
 * - the dock: chip, shutter, upload in one row, the typed-length link and
 *   the typed-size strip under it.
 */
import { GM2_CARD_ZONE, GM2_WRIST_LINE_Y } from "./hand/gm2Rules";
import { GM2_WRIST_LABEL_RISE } from "./hand/guides/gm2";

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const CARD_CHROME = {
  /** `.easyScanStaged .cameraCueWrap` top: max(0.875rem, inset) + 3.25rem. */
  cueTopPx: 14 + 52,
  /** `.cameraCue`: 0.625rem padding × 2 + one 17 px line. */
  cueHeightPx: 20 + 24,
  /** `.cameraCueWrap` (camera.css): 0.75rem padding on top. */
  wrapPadTopPx: 12,
  /** `.easyCardRule`: 13 px at 1.4, 0.375rem / 0.75rem padding, 0.5rem above. */
  ruleFontPx: 13,
  ruleLinePx: 13 * 1.4,
  rulePadYPx: 6,
  rulePadXPx: 12,
  ruleSideMarginPx: 16,
  rowGapPx: 8,
  /** `.easyTiltPermission`: 44 px, 0.5rem above. */
  tiltHeightPx: 44,
  /** The overlay label: 13 px at 1.2 plus 0.125rem padding × 2. */
  wristLabelHeightPx: 13 * 1.2 + 4,
  wristLabelWidthPx: 130,
  /** Kept between a label and the dock, px. */
  labelGapPx: 8,
  /** `.easyBottomRow`: 1rem above, the 92 px shutter, 0.75rem below. */
  rowTopPadPx: 16,
  shutterPx: 92,
  rowBottomPadPx: 12,
  rowSidePadPx: 24,
  /** `.easyNoPaperRow`: a 44 px link and 1rem under it (typed-length flag on). */
  noPaperRowPx: 44 + 16,
  /** `.manualEntry-handle`: bar, a 2.75rem label and 0.5rem padding × 2. */
  handlePx: 12 + 44 + 16,
  chipWidthPx: 64,
  chipHeightPx: 44,
  uploadPx: 44,
} as const;

/**
 * A guide label's top, px: centred on `centreY`, but never lower than
 * `labelGapPx` above `floorY` (the dock's top), when there is one.
 */
export function guideLabelTop(
  centreY: number,
  height: number,
  floorY: number | null,
): number {
  const top = centreY - height / 2;
  if (floorY === null || !Number.isFinite(floorY)) return top;
  return Math.min(top, floorY - CARD_CHROME.labelGapPx - height);
}

/** The card rule's line count in a pill this wide (one font size per glyph). */
export function ruleLinesIn(text: string, pillWidth: number): number {
  const c = CARD_CHROME;
  const inner = pillWidth - 2 * c.rulePadXPx;
  // A CJK glyph is one font size wide; Latin letters, digits and spaces
  // about 0.55 of it (a word may wrap early: one extra line is allowed).
  const em = [...text].reduce(
    (sum, ch) => sum + ((ch.codePointAt(0) ?? 0) < 0x2e80 ? 0.55 : 1),
    0,
  );
  const perLineEm = Math.max(1, Math.floor(inner / c.ruleFontPx));
  const lines = Math.ceil(em / perLineEm);
  return Math.max(1, hasLatin(text) ? lines + 1 : lines);
}

/** Text with Latin words, which wrap at spaces (one line more, worst case). */
function hasLatin(text: string): boolean {
  return /[A-Za-z]/.test(text);
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** The live card screen's pieces at this size (review G5, H1, H4). */
export function cardChromeBoxes(
  viewport: { readonly width: number; readonly height: number },
  options: {
    readonly ruleText: string;
    readonly tilt: boolean;
    readonly typedEntry: boolean;
    /** The hand chip's side (the rule and the button sit on the hand's side). */
    readonly side?: "right" | "left";
  },
): Record<
  | "cue"
  | "rule"
  | "tilt"
  | "wristLabel"
  | "chip"
  | "shutter"
  | "upload"
  | "slot"
  | "slotLabel",
  Box | null
> {
  const c = CARD_CHROME;
  const w = viewport.width;
  const h = viewport.height;
  const side = options.side ?? "right";
  // The wrap is a column (H1): the cue centred on its own row, after the
  // wrap's 0.75rem top padding.
  const cue: Box = {
    x: 16,
    y: c.cueTopPx + c.wrapPadTopPx,
    width: w - 32,
    height: c.cueHeightPx,
  };
  // Then the rule and the button, each on its own row, on the hand's side,
  // at most 64% − 1rem wide (clear of the card slot on the other side).
  const ruleWidth = Math.min(
    w - 2 * c.ruleSideMarginPx,
    0.64 * (w - 2 * c.ruleSideMarginPx) - 16,
  );
  const ruleH =
    ruleLinesIn(options.ruleText, ruleWidth) * c.ruleLinePx + 2 * c.rulePadYPx;
  const ruleX =
    side === "right" ? c.ruleSideMarginPx : w - c.ruleSideMarginPx - ruleWidth;
  const rule: Box = {
    x: ruleX,
    y: cue.y + cue.height + c.rowGapPx,
    width: ruleWidth,
    height: ruleH,
  };
  const tilt: Box | null = options.tilt
    ? {
        x: side === "right" ? c.ruleSideMarginPx : w - c.ruleSideMarginPx - 170,
        y: rule.y + rule.height + c.rowGapPx,
        width: 170,
        height: c.tiltHeightPx,
      }
    : null;
  const dockHeight =
    c.rowTopPadPx +
    c.shutterPx +
    c.rowBottomPadPx +
    (options.typedEntry ? c.noPaperRowPx : 0) +
    c.handlePx;
  const dockTop = h - dockHeight;
  const rowY = dockTop + c.rowTopPadPx;
  const shutter: Box = {
    x: w / 2 - c.shutterPx / 2,
    y: rowY,
    width: c.shutterPx,
    height: c.shutterPx,
  };
  const chip: Box = {
    x: c.rowSidePadPx,
    y: rowY + (c.shutterPx - c.chipHeightPx) / 2,
    width: c.chipWidthPx,
    height: c.chipHeightPx,
  };
  const upload: Box = {
    x: w - c.rowSidePadPx - c.uploadPx,
    y: rowY + (c.shutterPx - c.uploadPx) / 2,
    width: c.uploadPx,
    height: c.uploadPx,
  };
  // The wrist label: kept above the dock, left out when its line is under
  // the dock (H4), as `labelTopPx` in CardGuideOverlay.tsx.
  const lineY = GM2_WRIST_LINE_Y * h;
  const labelCentre = (GM2_WRIST_LINE_Y - GM2_WRIST_LABEL_RISE) * h;
  const wristLabel: Box | null =
    lineY >= dockTop
      ? null
      : {
          x: side === "right" ? 0.04 * w : 0.34 * w + 0.01 * w,
          y: guideLabelTop(labelCentre, c.wristLabelHeightPx, dockTop),
          width: c.wristLabelWidthPx,
          height: c.wristLabelHeightPx,
        };
  // The card slot and its label (not moved: H4).
  const z = GM2_CARD_ZONE;
  const slotX0 = side === "right" ? z.x0 : 1 - z.x1;
  const slot: Box = {
    x: slotX0 * w,
    y: (z.cy - z.height / 2) * h,
    width: (z.x1 - z.x0) * w,
    height: z.height * h,
  };
  const slotLabelH = 2 * 15 * 1.2 + 4;
  const slotLabel: Box = {
    x: slot.x + slot.width / 2 - 30,
    y: slot.y + slot.height + 22 - slotLabelH / 2,
    width: 60,
    height: slotLabelH,
  };
  return {
    cue,
    rule,
    tilt,
    wristLabel,
    chip,
    shutter,
    upload,
    slot,
    slotLabel,
  };
}
