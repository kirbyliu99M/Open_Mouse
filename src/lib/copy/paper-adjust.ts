/**
 * Words of the paper-frame adjustment (V3.2 F2, 手動調整邊框), zh-TW and
 * English, same keys. Shown after the automatic detection turned a photo back
 * for any paper reason (or after a frame placed by hand was turned back), as
 * 檢查邊框 on a measured photo (F7, 2026-10-21), and, with `?debug=1`, as
 * Kirby's corner check.
 *
 * F14 (2026-10-22): the screen shows no instructions, gesture hint or
 * per-corner lines any more, so their words are gone; a line is shown only
 * when the frame cannot be used as it is.
 *
 * Every string here is a CANDIDATE (未拍板) until Kirby has read it. No health
 * claim, and no promise of accuracy: a frame placed by hand has no numeric
 * quality gate (R5 E3), so nothing here says the result is precise.
 */
import type { Locale } from "../contracts/locale";
import type { ManualQuadProblem } from "../../client/paper/manualQuad";

export interface PaperAdjustCopy {
  /** The secondary button on the failure sheet that opens the adjustment. */
  entry: string;
  /** The screen's heading. */
  title: string;
  /** F10: show the whole photo, and zoom back onto the frame. */
  wholePhoto: string;
  zoomToFrame: string;
  /** F10 (rescue): start again from the centred frame. */
  centreFrame: string;
  /** The four corners as the person sees them, top left first, clockwise. */
  cornerNames: readonly [string, string, string, string];
  /** A handle's accessible name. */
  handleLabel: (corner: string) => string;
  /** Added to the name of a corner still at its starting guess. */
  handleNotPlaced: string;
  /** How to move a handle from the keyboard (its description). */
  keyboardHint: string;
  /** Why the frame cannot be used as it is. */
  quadProblem: Record<ManualQuadProblem, string>;
  /** A corner of the centred frame not moved yet (F14: only that frame asks for it). */
  notPlaced: (corner: string) => string;
  confirm: string;
  cancel: string;
  /** F14: the way out when the screen opened by itself after a paper failure (back to the camera). */
  retake: string;
  /** The measured sheet's line after a frame placed by hand. */
  measuredNote: string;
  /** 檢查邊框 on a measured photo (F7): the detector's frame, to confirm or move. */
  review: {
    entry: string;
    title: string;
    confirm: string;
  };
  /** Kirby's corner check (`?debug=1` only). */
  check: {
    entry: string;
    instruction: string;
    magnifierOn: string;
    magnifierOff: string;
    confirm: string;
    recorded: (largestPx: string) => string;
  };
}

export const zhTW: PaperAdjustCopy = {
  entry: "手動調整邊框",
  title: "調整紙張邊框",
  wholePhoto: "看整張照片",
  zoomToFrame: "放大到邊框",
  centreFrame: "改用置中框",
  cornerNames: ["左上角", "右上角", "右下角", "左下角"],
  handleLabel: (corner) => corner,
  handleNotPlaced: "，還沒對齊",
  keyboardHint: "用方向鍵移動，按住 Shift 移動得更多。",
  quadProblem: {
    not_finite: "有一個角的位置無法使用，請重拍一次。",
    self_intersecting: "邊框交叉了。請把每個角拖回它自己的位置。",
    not_convex: "邊框凹進去了。請把四個角拖到紙的四個角上。",
    degenerate:
      "有兩個角疊在一起，或三個角排成一直線。請把四個角拖到紙的四個角上。",
    outside_image: "有一個角在照片外面。請把它拖回照片裡。",
    too_small: "邊框太小了。請把四個角拖到紙的四個角上。",
  },
  notPlaced: (corner) => `${corner}還沒對齊，請先把它拖到紙角上。`,
  confirm: "用這個邊框測量",
  cancel: "取消",
  retake: "重拍",
  measuredNote: "紙張邊框是手動調整的。",
  review: {
    entry: "檢查邊框",
    title: "檢查紙張邊框",
    confirm: "邊框沒問題",
  },
  check: {
    entry: "拖角精度測試",
    instruction: "把四個角拖到紙角上，再按「記錄這次」。只記錄距離，不存照片。",
    magnifierOn: "放大鏡：開",
    magnifierOff: "放大鏡：關",
    confirm: "記錄這次",
    recorded: (largest) => `已記錄。最大的差距是 ${largest} px。`,
  },
};

export const en: PaperAdjustCopy = {
  entry: "Adjust the frame by hand",
  title: "Adjust the paper's frame",
  wholePhoto: "Show the whole photo",
  zoomToFrame: "Zoom to the frame",
  centreFrame: "Start from a centred frame",
  cornerNames: [
    "Top-left corner",
    "Top-right corner",
    "Bottom-right corner",
    "Bottom-left corner",
  ],
  handleLabel: (corner) => corner,
  handleNotPlaced: ", not placed yet",
  keyboardHint: "Use the arrow keys to move it; hold Shift to move further.",
  quadProblem: {
    not_finite: "One corner can't be used. Please retake the photo.",
    self_intersecting:
      "The frame crosses itself. Drag each corner back to its own place.",
    not_convex:
      "The frame bends inwards. Drag the four corners onto the paper's corners.",
    degenerate:
      "Two corners are on top of each other, or three are in a line. Drag the four corners onto the paper's corners.",
    outside_image: "A corner is outside the photo. Drag it back in.",
    too_small:
      "The frame is too small. Drag the four corners onto the paper's corners.",
  },
  notPlaced: (corner) =>
    `The ${corner.toLowerCase()} isn't placed yet. Drag it onto the paper's corner first.`,
  confirm: "Measure with this frame",
  cancel: "Cancel",
  retake: "Retake",
  measuredNote: "The paper's frame was adjusted by hand.",
  review: {
    entry: "Check the frame",
    title: "Check the paper's frame",
    confirm: "The frame is right",
  },
  check: {
    entry: "Corner drag check",
    instruction:
      "Drag the four corners onto the paper's corners, then tap Record. Only the distances are kept; no photo.",
    magnifierOn: "Magnifier: on",
    magnifierOff: "Magnifier: off",
    confirm: "Record",
    recorded: (largest) => `Recorded. The largest gap is ${largest} px.`,
  },
};

const TABLES: Record<Locale, PaperAdjustCopy> = { "zh-TW": zhTW, en };

export function paperAdjustCopy(locale: Locale): PaperAdjustCopy {
  return TABLES[locale];
}
