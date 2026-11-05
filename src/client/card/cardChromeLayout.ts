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
import { GM2_WRIST_LINE_Y } from "./hand/gm2Rules";
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

/** The card rule's line count at this width (CJK ≈ one font size per glyph). */
export function ruleLines(text: string, viewportWidth: number): number {
  const c = CARD_CHROME;
  const inner = viewportWidth - 2 * c.ruleSideMarginPx - 2 * c.rulePadXPx;
  const perLine = Math.max(1, Math.floor(inner / c.ruleFontPx));
  return Math.max(1, Math.ceil([...text].length / perLine));
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** The live card screen's pieces at this size (review G5). */
export function cardChromeBoxes(
  viewport: { readonly width: number; readonly height: number },
  options: {
    readonly ruleText: string;
    readonly tilt: boolean;
    readonly typedEntry: boolean;
  },
): Record<
  "cue" | "rule" | "tilt" | "wristLabel" | "chip" | "shutter" | "upload",
  Box | null
> {
  const c = CARD_CHROME;
  const w = viewport.width;
  const h = viewport.height;
  const cue: Box = {
    x: 16,
    y: c.cueTopPx,
    width: w - 32,
    height: c.cueHeightPx,
  };
  const ruleH =
    ruleLines(options.ruleText, w) * c.ruleLinePx + 2 * c.rulePadYPx;
  const rule: Box = {
    x: c.ruleSideMarginPx,
    y: cue.y + cue.height + c.rowGapPx,
    width: w - 2 * c.ruleSideMarginPx,
    height: ruleH,
  };
  const tilt: Box | null = options.tilt
    ? {
        x: w / 2 - 80,
        y: rule.y + rule.height + c.rowGapPx,
        width: 160,
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
  const labelCentre = (GM2_WRIST_LINE_Y - GM2_WRIST_LABEL_RISE) * h;
  const wristLabel: Box = {
    x: 0.04 * w,
    y: guideLabelTop(labelCentre, c.wristLabelHeightPx, dockTop),
    width: c.wristLabelWidthPx,
    height: c.wristLabelHeightPx,
  };
  return { cue, rule, tilt, wristLabel, chip, shutter, upload };
}
