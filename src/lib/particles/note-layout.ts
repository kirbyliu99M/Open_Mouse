import type { Vec } from "./geometry";
import { DEMO_STAGE_SCALE, OUTLINE_PALM } from "./hand-outline";
import type { Rect, StageBox } from "./particle-set";
import {
  A4_MM,
  LANDMARKS_MM,
  LENGTH_LINE_MM,
  STAGE_SCALE,
  WIDTH_LINE_MM,
} from "./template-hand";
import { NOTE_COUNT } from "./timeline";

/**
 * Where the five annotations' parts go (Home v3.1; the Pencil demo of
 * 2026-10-05): the rings around the anchor landmarks, the emphasised
 * measurement line where there is one, the thin leader from the anchor to the
 * text, and the text block itself. Pure: the stage measures the page, hands
 * this the hand's box and the measured text sizes, and draws what comes out.
 * Every position follows the hand's own transform (`box`), so it follows a
 * resize.
 *
 * Two modes. On a narrow window the text sits below the hand and each leader
 * runs sideways from its anchor to a vertical line down to the text, as in the
 * demo's phone frames. When there is room at the sides of the hand the text
 * sits beside it, and each leader runs straight across (the demo's desktop
 * frames). The demo shows only the right-hand side on a desktop; the thumb is
 * on the hand's left, so its text goes to the left (a deviation reported in
 * the PR).
 */

export type NoteMode = "below" | "beside";

/** The gap between the hand's image and a text block beside it (px). */
export const SIDE_GAP = 28;
/** The text needs at least this much room at each side of the hand to sit beside it (px). */
export const MIN_SIDE_TEXT = 176;
/** The widest a text block gets (px): the demo's callout beside the hand is 420. */
export const MAX_TEXT_WIDTH = 420;
/** The page's own side gutter, which a block beside the hand never crosses (px). */
export const PAGE_GUTTER = 24;
/** A leader stops this far short of a text block beside the hand, and of the block's top below it (the demo: 20 and 4). */
export const LEADER_GAP_SIDE = 20;
export const LEADER_GAP_BELOW = 4;
/** In the demo, a text block below the hand starts this far under the A4 sheet's bottom edge (px). */
export const BELOW_FROM_SHEET = 73;
/** A text block never sits closer than this to the panel's bottom edge, or to the wrist's outline above it (px). */
export const PANEL_MARGIN = 16;
export const WRIST_CLEARANCE = 20;

/** Ring and line sizes, in the demo's pixels: they scale with the hand. */
const RING_RADIUS_DEMO = 12;
const RING_WIDTH_DEMO = 2;
const EMPHASIS_WIDTH_DEMO = 2.5;
/** Where each leader turns, in mm on the A4 sheet, read off the demo's phone frames (palm width, knuckles, fingertips, thumb). */
const TURN_X_MM = {
  width: 207.2,
  knuckles: 201.7,
  fingertips: 212.8,
  thumb: 3.5,
};

/** Where the room is: how many px a text block can take at each side of the hand, between it and the page's gutter. */
export interface SideRoom {
  readonly left: number;
  readonly right: number;
}

/** Text goes beside the hand when both sides have at least `MIN_SIDE_TEXT` of room: otherwise below it. */
export function noteMode(room: SideRoom): NoteMode {
  return room.left >= MIN_SIDE_TEXT && room.right >= MIN_SIDE_TEXT
    ? "beside"
    : "below";
}

/** The room at each side of the hand's image, given where the image is on the page. */
export function sideRoom(
  /** The image's left and right edges on the page (viewport px). */
  imageLeft: number,
  imageRight: number,
  pageWidth: number,
): SideRoom {
  return {
    left: imageLeft - SIDE_GAP - PAGE_GUTTER,
    right: pageWidth - PAGE_GUTTER - imageRight - SIDE_GAP,
  };
}

/** How wide each of the five text blocks is: the image's width below the hand, the room at its side (to 420) beside it. */
export function noteTextWidths(
  mode: NoteMode,
  imageWidth: number,
  room: SideRoom,
): number[] {
  if (mode === "below") {
    return Array.from({ length: NOTE_COUNT }, () => Math.max(1, imageWidth));
  }
  const right = Math.min(MAX_TEXT_WIDTH, room.right);
  const left = Math.min(MAX_TEXT_WIDTH, room.left);
  return [right, right, right, right, left];
}

/** A text block, as measured in the page once it has its width. */
export interface NoteText {
  /** The block's height. */
  readonly height: number;
  /** How far down the block the small line starts: a leader beside the text is level with it. */
  readonly smallTop: number;
}

export interface NoteRing {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

export interface NoteShape {
  /** The rings around the anchor landmarks. */
  readonly rings: readonly NoteRing[];
  /** The measurement line drawn heavier, where the note is about a measurement. */
  readonly emphasis: { readonly from: Vec; readonly to: Vec } | null;
  /** The thin leader: from the anchor to just short of the text. */
  readonly leader: readonly Vec[];
  /** Where the text block goes, in the panel's px. */
  readonly text: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly align: "left" | "right";
  };
  /** Stroke widths in canvas px. */
  readonly ringWidth: number;
  readonly emphasisWidth: number;
}

export interface NoteLayoutInput {
  /** The hand's drawing placed on the canvas (stage px to canvas px). */
  readonly box: StageBox;
  /** The hand's image, in the panel's px. */
  readonly rect: Rect;
  /** The panel (the canvas's size). */
  readonly panel: { readonly width: number; readonly height: number };
  readonly mode: NoteMode;
  /** The five blocks' widths (`noteTextWidths`) and their measured sizes at those widths. */
  readonly widths: readonly number[];
  readonly texts: readonly NoteText[];
}

/** The five notes' shapes, in the story's order. */
export function placeNotes(input: NoteLayoutInput): NoteShape[] {
  const { box, rect, panel, mode, widths, texts } = input;
  const k = box.scale;
  const s = k / DEMO_STAGE_SCALE;
  const X = (mm: number) => box.x + mm * STAGE_SCALE * k;
  const Y = (mm: number) => box.y + mm * STAGE_SCALE * k;
  const landmark = (i: number): Vec => [
    X(LANDMARKS_MM[i]![0]),
    Y(LANDMARKS_MM[i]![1]),
  ];
  const rings = (indices: readonly number[]): NoteRing[] =>
    indices.map((i) => {
      const [x, y] = landmark(i);
      return { x, y, r: RING_RADIUS_DEMO * s };
    });

  // The one row of text below the hand: under the A4 sheet, clear of the wrist
  // above it and of the panel's bottom edge below it.
  const sheetBottom = Y(A4_MM.height);
  const wristBottom = Y(246 + OUTLINE_PALM.width / 2);
  const tallest = Math.max(...texts.map((t) => t.height), 0);
  const belowTop = Math.max(
    Math.min(
      sheetBottom + BELOW_FROM_SHEET,
      panel.height - PANEL_MARGIN - tallest,
    ),
    wristBottom + WRIST_CLEARANCE,
  );

  const rightEdge = rect.x + rect.width;
  const shape = (
    index: number,
    anchor: Vec,
    /** Where a leader below the hand turns downwards, and which way it goes first. */
    turnX: number,
    parts: Pick<NoteShape, "rings" | "emphasis">,
  ): NoteShape => {
    const width = widths[index] ?? rect.width;
    const text = texts[index] ?? { height: 0, smallTop: 0 };
    const common = {
      ...parts,
      ringWidth: RING_WIDTH_DEMO * s,
      emphasisWidth: EMPHASIS_WIDTH_DEMO * s,
    };
    if (mode === "below") {
      const end = belowTop - LEADER_GAP_BELOW;
      return {
        ...common,
        leader:
          Math.abs(turnX - anchor[0]) < 0.5
            ? [anchor, [anchor[0], end]]
            : [anchor, [turnX, anchor[1]], [turnX, end]],
        text: { left: rect.x, top: belowTop, width, align: "left" },
      };
    }
    // Beside: the thumb is on the hand's left, so its text goes there.
    const onLeft = index === 4;
    const left = onLeft ? rect.x - SIDE_GAP - width : rightEdge + SIDE_GAP;
    const top = Math.min(
      Math.max(anchor[1] - text.smallTop - 2, PANEL_MARGIN),
      Math.max(PANEL_MARGIN, panel.height - PANEL_MARGIN - text.height),
    );
    const tip = onLeft
      ? left + width + LEADER_GAP_SIDE
      : left - LEADER_GAP_SIDE;
    return {
      ...common,
      leader: [anchor, [tip, anchor[1]]],
      text: { left, top, width, align: onLeft ? "right" : "left" },
    };
  };

  const L = LENGTH_LINE_MM;
  const W = WIDTH_LINE_MM;
  const rulerX = X(L.x);
  return [
    // 1 Hand length: the ruler beside the hand, wrist to middle fingertip. The
    // leader goes on down the ruler's own line (below), or out from its middle.
    shape(
      0,
      mode === "below"
        ? [rulerX, Y(L.bottom)]
        : [rulerX, Y((L.top + L.bottom) / 2)],
      rulerX,
      {
        rings: [],
        emphasis: { from: [rulerX, Y(L.top)], to: [rulerX, Y(L.bottom)] },
      },
    ),
    // 2 Palm width: the line across the palm, from its right end.
    shape(1, [X(W.right), Y(W.y)], X(TURN_X_MM.width), {
      rings: [],
      emphasis: { from: [X(W.left), Y(W.y)], to: [X(W.right), Y(W.y)] },
    }),
    // 3 Knuckles: the four finger bases (5, 9, 13, 17), from the last.
    shape(2, landmark(17), X(TURN_X_MM.knuckles), {
      rings: rings([5, 9, 13, 17]),
      emphasis: null,
    }),
    // 4 Fingertips: 8, 12, 16, 20, from the little finger's.
    shape(3, landmark(20), X(TURN_X_MM.fingertips), {
      rings: rings([8, 12, 16, 20]),
      emphasis: null,
    }),
    // 5 Thumb: 2 and 4, from the tip, out to the left.
    shape(4, landmark(4), X(TURN_X_MM.thumb), {
      rings: rings([2, 4]),
      emphasis: null,
    }),
  ];
}
