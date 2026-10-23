/**
 * Words of the paper-frame adjustment (V3.2 F2, 手動調整邊框), zh-TW and
 * English, same keys. Shown after the automatic detection turned a photo back
 * for any paper reason (or after a frame placed by hand was turned back), and,
 * since F15 (2026-10-23), by itself on every photo measured from the
 * detector's own corners, before its lengths are shown. The same heading and
 * confirm button serve both (F15 removed 檢查邊框, Kirby's corner check and
 * the sheet's "adjusted by hand" line; the results page says that instead).
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
}

export const zhTW: PaperAdjustCopy = {
  entry: "手動調整邊框",
  title: "調整紙張邊框",
  cornerNames: ["左上角", "右上角", "右下角", "左下角"],
  handleLabel: (corner) => corner,
  handleNotPlaced: "，還沒對齊",
  keyboardHint: "用方向鍵移動，按住 Shift 移動得更多。",
  quadProblem: {
    // Kirby 2026-10-22 (candidate): short messages.
    not_finite: "偵測失敗，請重試。",
    self_intersecting: "邊框交叉了。請把每個角拖回它自己的位置。",
    not_convex: "邊框凹進去了。請把四個角拖到紙的四個角上。",
    degenerate:
      "有兩個角疊在一起，或三個角排成一直線。請把四個角拖到紙的四個角上。",
    outside_image: "有一個角在照片外面。請把它拖回照片裡。",
    // V3.2 F16 (candidate, 未拍板): a frame on a sheet that is itself this
    // small cannot be measured; the way out is a closer photo.
    too_small:
      "邊框太小了。請把四個角拖到紙的四個角上；如果紙在照片裡就這麼小，請把手機拿近一點重拍。",
  },
  // Candidate (Kirby 2026-10-22: short messages).
  notPlaced: (corner) => `${corner}還沒對齊，請拖到紙角。`,
  confirm: "用這個邊框測量",
  cancel: "取消",
  retake: "重拍",
};

export const en: PaperAdjustCopy = {
  entry: "Adjust the frame by hand",
  title: "Adjust the paper's frame",
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
    not_finite: "Please retry.",
    self_intersecting:
      "The frame crosses itself. Drag each corner back to its own place.",
    not_convex:
      "The frame bends inwards. Drag the four corners onto the paper's corners.",
    degenerate:
      "Two corners are on top of each other, or three are in a line. Drag the four corners onto the paper's corners.",
    outside_image: "A corner is outside the photo. Drag it back in.",
    // V3.2 F16 (candidate).
    too_small:
      "The frame is too small. Drag the four corners onto the paper's corners; if the paper really is this small in the photo, move the phone closer and retake.",
  },
  notPlaced: (corner) =>
    `Move the ${corner.toLowerCase()} to the paper's corner.`,
  confirm: "Measure with this frame",
  cancel: "Cancel",
  retake: "Retake",
};

const TABLES: Record<Locale, PaperAdjustCopy> = { "zh-TW": zhTW, en };

export function paperAdjustCopy(locale: Locale): PaperAdjustCopy {
  return TABLES[locale];
}
