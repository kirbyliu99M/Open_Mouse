import type { Vec } from "./geometry";

/**
 * The template hand of the home page's particle story: a fixed, stylised set of
 * the 21 MediaPipe landmark positions lying on an A4 sheet. Its shape (the
 * outline, and the area the particles fill) is hand-outline.ts; the fill is
 * hand-fill.ts.
 *
 * It is an illustration. It is NOT a user's hand and NOT a measurement, so the
 * two measurement lines carry no numbers anywhere (docs/design/
 * home-v3-2026-10-03/README.md, "The particle stage").
 *
 * Positions are millimetres on the A4 sheet (origin top-left, x right, y down,
 * 210 × 297), a right hand seen from above, fingers up. They are hand-set from
 * the design screens (screens/04-desktop-en.png), not derived from any dataset
 * or photo.
 */

export const A4_MM = { width: 210, height: 297 } as const;

/** Stage px per millimetre: the A4 sheet is 340 px wide in the target space. */
export const STAGE_SCALE = 340 / A4_MM.width;

/**
 * Margins, in mm, between the sheet and the edge of the drawing. Equal left
 * and right keep the sheet centred; the right one holds the ruler (and its
 * ticks).
 */
export const HAND_MARGIN_MM = {
  left: 22,
  top: 8,
  right: 22,
  bottom: 8,
} as const;

/**
 * Where the A4 sheet sits inside the hand drawing, as percentages of the
 * drawing's own width and height. The page lays a CSS border (--hairline,
 * which turns solid with `prefers-contrast: more`) over exactly this
 * rectangle, so the outline follows the user's setting and the same numbers
 * will place the particle canvas.
 */
export function handSheetFrame(): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const width = A4_MM.width + HAND_MARGIN_MM.left + HAND_MARGIN_MM.right;
  const height = A4_MM.height + HAND_MARGIN_MM.top + HAND_MARGIN_MM.bottom;
  return {
    left: (HAND_MARGIN_MM.left / width) * 100,
    top: (HAND_MARGIN_MM.top / height) * 100,
    width: (A4_MM.width / width) * 100,
    height: (A4_MM.height / height) * 100,
  };
}

/** MediaPipe hand landmark order: 0 wrist; thumb 1-4; index 5-8; middle 9-12; ring 13-16; pinky 17-20. */
export const LANDMARKS_MM: readonly Vec[] = [
  [115.3, 242.5], // 0 wrist
  [83.2, 221.5], // 1 thumb CMC
  [57.8, 199.0], // 2 thumb MCP
  [40.0, 176.1], // 3 thumb IP
  [23.9, 156.0], // 4 thumb tip
  [88.0, 151.2], // 5 index MCP
  [80.9, 112.4], // 6 index PIP
  [77.5, 90.0], // 7 index DIP
  [74.2, 69.4], // 8 index tip
  [115.3, 146.9], // 9 middle MCP
  [115.3, 103.3], // 10 middle PIP
  [115.3, 78.5], // 11 middle DIP
  [115.3, 53.1], // 12 middle tip
  [140.2, 151.2], // 13 ring MCP
  [146.9, 112.4], // 14 ring PIP
  [150.7, 90.0], // 15 ring DIP
  [154.1, 71.3], // 16 ring tip
  [163.6, 162.7], // 17 pinky MCP
  [174.6, 135.4], // 18 pinky PIP
  [181.3, 117.1], // 19 pinky DIP
  [186.1, 100.9], // 20 pinky tip
];

/** MediaPipe's HAND_CONNECTIONS: the skeleton the measured step draws. */
export const SKELETON: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];

/** The five finger chains (landmark indices), thumb first: the chains the hand's outline, and so its particle fill, follow (hand-outline.ts). */
export const FINGER_CHAINS: readonly (readonly number[])[] = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];

/** Hand length: a ruler beside the hand, from the middle fingertip to the wrist crease. */
export const LENGTH_LINE_MM = {
  x: 222,
  top: 47,
  bottom: 246,
  /** Where the two extension lines start, so they reach in towards the hand. */
  topFrom: 122,
  bottomFrom: 140,
} as const;

/** Palm width: across the palm at the knuckle line. */
export const WIDTH_LINE_MM = { y: 170, left: 70, right: 170 } as const;

/** Half the length of an end tick, in mm. */
export const TICK_MM = 3;
