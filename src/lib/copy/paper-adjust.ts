/**
 * Words of the paper-frame adjustment (V3.2 F2, 手動調整邊框), zh-TW and
 * English, same keys. Shown after the automatic detection turned a photo back
 * for any paper reason (or after a frame placed by hand was turned back), as
 * 檢查邊框 on a measured photo (F7, 2026-10-21), and, with `?debug=1`, as
 * Kirby's corner check.
 *
 * Every string here is a CANDIDATE (未拍板) until Kirby has read it. No health
 * claim, and no promise of accuracy: a frame placed by hand has no numeric
 * quality gate (R5 E3), so nothing here says the result is precise.
 */
import type { Locale } from "../contracts/locale";
import type {
  HiddenCornerProblem,
  ManualQuadProblem,
} from "../../client/paper/manualQuad";

export interface PaperAdjustCopy {
  /** The secondary button on the failure sheet that opens the adjustment. */
  entry: string;
  /** The screen's heading. */
  title: string;
  /** One line under the heading, when the frame starts from the detector's corners. */
  instructionDetected: string;
  /** ...when some corners are only a starting guess. */
  instructionGuess: string;
  /** The four corners as the person sees them, top left first, clockwise. */
  cornerNames: readonly [string, string, string, string];
  /** A handle's accessible name. */
  handleLabel: (corner: string) => string;
  /** Added to the name of a corner still at its starting guess. */
  handleNotPlaced: string;
  /** How to move a handle from the keyboard (its description). */
  keyboardHint: string;
  /** The button that switches a corner to "mark its edges". */
  edgeModeStart: string;
  /** Shown when that button is pressed with no corner chosen. */
  chooseCornerFirst: string;
  /** Shown when that button is pressed while a neighbour of the hidden corner is still only a guess. */
  placeNeighboursFirst: (hiddenCorner: string, neighbour: string) => string;
  /** A worked-out corner whose neighbour then moved: it is no longer placed. */
  edgeUndone: (corner: string) => string;
  /** Step 1 and 2 of marking a hidden corner's edges. */
  edgeStep: (step: 1 | 2, hiddenCorner: string, otherCorner: string) => string;
  /** Leaves the edge mode. */
  edgeModeCancel: string;
  /** A hidden corner worked out from its edges. */
  edgeSolved: (corner: string) => string;
  /** Why a hidden corner could not be worked out. */
  edgeProblem: Record<HiddenCornerProblem, string>;
  /** Why the frame cannot be used as it is. */
  quadProblem: Record<ManualQuadProblem, string>;
  /** A corner that is still only a starting guess. */
  notPlaced: (corner: string) => string;
  confirm: string;
  cancel: string;
  reset: string;
  /** The measured sheet's line after a frame placed by hand. */
  measuredNote: string;
  /**
   * Shown on the screen before confirming, after the sheet was measured as
   * curled (`PAPER_CURLED`, F7): a frame placed by hand cannot fix that.
   */
  curledWarning: string;
  /** 檢查邊框 on a measured photo (F7): the detector's frame, to confirm or move. */
  review: {
    entry: string;
    title: string;
    instruction: string;
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
  instructionDetected: "把四個角對準紙的四個角。拖曳時會出現放大鏡。",
  instructionGuess:
    "把空心的角拖到紙角上；被手遮住的角，可以改用「這個角被手遮住」。",
  cornerNames: ["左上角", "右上角", "右下角", "左下角"],
  handleLabel: (corner) => corner,
  handleNotPlaced: "，還沒對齊",
  keyboardHint: "用方向鍵移動，按住 Shift 移動得更多。",
  edgeModeStart: "這個角被手遮住",
  chooseCornerFirst: "先點一下被遮住的那個角。",
  placeNeighboursFirst: (hidden, neighbour) =>
    `請先把${neighbour}對齊紙角，才能用紙邊算出${hidden}。`,
  edgeUndone: (corner) =>
    `旁邊的角移動了，${corner}需要重新標點，或直接拖到紙角上。`,
  edgeStep: (step, hidden, other) =>
    `第 ${step} 步：在${other}和${hidden}之間的紙邊上，點一下還看得到的地方。`,
  edgeModeCancel: "取消標點",
  edgeSolved: (corner) => `已由兩條紙邊算出${corner}的位置。`,
  edgeProblem: {
    need_points: "請點在紙邊上，離另一個角遠一點的地方。",
    parallel: "這兩條邊太接近平行，算不出角在哪裡。請重拍，讓這個角露出來。",
    wrong_side: "點的位置超過了這個角。請點在兩個角之間的紙邊上。",
    too_hidden:
      "這兩條邊被遮住太多，算出來的角不可靠。請把手移開一點，再拍一次。",
    outside_image: "算出來的角離照片太遠。請重拍，讓整張紙都在畫面裡。",
  },
  quadProblem: {
    not_finite: "有一個角的位置無法使用，請按「重設」再試一次。",
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
  reset: "重設",
  measuredNote: "紙張邊框是手動調整的。",
  curledWarning:
    "紙好像沒有平貼，手動調整後量測可能不準，建議先把紙壓平再拍一次。",
  review: {
    entry: "檢查邊框",
    title: "檢查紙張邊框",
    instruction:
      "這是自動找到的邊框。對齊了就按「邊框沒問題」；角沒對準，就把它拖到紙角上，會用新的邊框重新測量。",
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
  instructionDetected:
    "Line the four corners up with the paper's corners. A magnifier appears while you drag.",
  instructionGuess:
    "Drag the hollow corners onto the paper's corners. If your hand covers a corner, use “My hand covers this corner”.",
  cornerNames: [
    "Top-left corner",
    "Top-right corner",
    "Bottom-right corner",
    "Bottom-left corner",
  ],
  handleLabel: (corner) => corner,
  handleNotPlaced: ", not placed yet",
  keyboardHint: "Use the arrow keys to move it; hold Shift to move further.",
  edgeModeStart: "My hand covers this corner",
  chooseCornerFirst: "First tap the corner that is covered.",
  placeNeighboursFirst: (hidden, neighbour) =>
    `First line the ${neighbour.toLowerCase()} up with the paper's corner; the ${hidden.toLowerCase()} is worked out from it.`,
  edgeUndone: (corner) =>
    `A corner next to it moved, so mark the ${corner.toLowerCase()}'s edges again or drag it onto the paper's corner.`,
  edgeStep: (step, hidden, other) =>
    `Step ${step}: tap the paper's edge between the ${other.toLowerCase()} and the ${hidden.toLowerCase()}, where you can still see it.`,
  edgeModeCancel: "Stop marking",
  edgeSolved: (corner) =>
    `The ${corner.toLowerCase()} was worked out from two edges.`,
  edgeProblem: {
    need_points: "Tap the paper's edge further from the other corner.",
    parallel:
      "These two edges are too close to parallel to say where the corner is. Retake the photo with this corner showing.",
    wrong_side:
      "That point is past the corner. Tap the edge between the two corners.",
    too_hidden:
      "Too much of these edges is covered to trust the corner. Move your hand a little and retake.",
    outside_image:
      "That corner would be too far outside the photo. Retake with the whole sheet in view.",
  },
  quadProblem: {
    not_finite: "One corner can't be used. Tap Reset and try again.",
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
  reset: "Reset",
  measuredNote: "The paper's frame was adjusted by hand.",
  curledWarning:
    "The paper doesn't seem to lie flat. After adjusting by hand the measurement may be off; we suggest pressing the paper flat and taking the photo again.",
  review: {
    entry: "Check the frame",
    title: "Check the paper's frame",
    instruction:
      "This is the frame found automatically. If it lines up, tap “The frame is right”; if a corner is off, drag it onto the paper's corner and your hand is measured again with the new frame.",
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
