import { describe, expect, it } from "vitest";
import { DEMO_STAGE_SCALE, OUTLINE_PALM } from "@/lib/particles/hand-outline";
import {
  BELOW_FROM_SHEET,
  LEADER_GAP_BELOW,
  LEADER_GAP_SIDE,
  MAX_TEXT_WIDTH,
  MIN_SIDE_TEXT,
  PANEL_MARGIN,
  SIDE_GAP,
  WRIST_CLEARANCE,
  noteMode,
  noteTextWidths,
  placeNotes,
  sideRoom,
  type NoteLayoutInput,
  type NoteText,
} from "@/lib/particles/note-layout";
import { handBox } from "@/lib/particles/particle-set";
import {
  A4_MM,
  HAND_MARGIN_MM,
  LANDMARKS_MM,
  LENGTH_LINE_MM,
  STAGE_SCALE,
  WIDTH_LINE_MM,
} from "@/lib/particles/template-hand";

const viewBox = {
  x: -HAND_MARGIN_MM.left * STAGE_SCALE,
  y: -HAND_MARGIN_MM.top * STAGE_SCALE,
  width:
    (A4_MM.width + HAND_MARGIN_MM.left + HAND_MARGIN_MM.right) * STAGE_SCALE,
};
const ASPECT = 507 / 411;

/** The hand's image centred in a panel, as home.css lays it out. */
function setup(panelWidth: number, panelHeight: number, imageWidth: number) {
  const imageHeight = imageWidth * ASPECT;
  const rect = {
    x: (panelWidth - imageWidth) / 2,
    y: (panelHeight - imageHeight) / 2,
    width: imageWidth,
    height: imageHeight,
  };
  return { rect, box: handBox(rect, viewBox) };
}

const oneLine: NoteText = { height: 63, smallTop: 40 };
const twoLines: NoteText = { height: 86, smallTop: 40 };

function layout(
  panelWidth: number,
  panelHeight: number,
  imageWidth: number,
  mode: "below" | "beside",
  texts: NoteText[] = [oneLine, oneLine, twoLines, oneLine, oneLine],
  widths?: number[],
): { input: NoteLayoutInput; shapes: ReturnType<typeof placeNotes> } {
  const { rect, box } = setup(panelWidth, panelHeight, imageWidth);
  const input: NoteLayoutInput = {
    box,
    rect,
    panel: { width: panelWidth, height: panelHeight },
    mode,
    widths:
      widths ??
      [1, 2, 3, 4, 5].map(() => (mode === "below" ? rect.width : 300)),
    texts,
  };
  return { input, shapes: placeNotes(input) };
}

const canvasPoint = (
  box: { x: number; y: number; scale: number },
  mm: readonly [number, number],
) =>
  [
    box.x + mm[0] * STAGE_SCALE * box.scale,
    box.y + mm[1] * STAGE_SCALE * box.scale,
  ] as const;

describe("beside or below", () => {
  it("is beside only when both sides of the hand have room for the text", () => {
    expect(MIN_SIDE_TEXT).toBe(176);
    expect(noteMode({ left: 176, right: 176 })).toBe("beside");
    expect(noteMode({ left: 400, right: 400 })).toBe("beside");
    expect(noteMode({ left: 175, right: 400 })).toBe("below");
    expect(noteMode({ left: 400, right: 175 })).toBe("below");
    expect(noteMode({ left: -10, right: -10 })).toBe("below");
  });

  it("measures the room from the image's edges to the page's gutter, less the gap", () => {
    // 1440 wide, a 608 px hand centred: 416 px at each side of the image.
    const room = sideRoom(416, 1024, 1440);
    expect(room.left).toBe(416 - SIDE_GAP - 24);
    expect(room.right).toBe(1440 - 24 - 1024 - SIDE_GAP);
    expect(noteMode(room)).toBe("beside");
    // A phone, a tablet and a narrow laptop: no room, text below.
    expect(noteMode(sideRoom(24, 366, 390))).toBe("below");
    expect(noteMode(sideRoom(80, 688, 768))).toBe("below");
  });

  it("gives a block below the hand the image's width, and a block beside it the room (to 420)", () => {
    expect(noteTextWidths("below", 342, { left: 0, right: 0 })).toEqual([
      342, 342, 342, 342, 342,
    ]);
    expect(MAX_TEXT_WIDTH).toBe(420);
    expect(noteTextWidths("beside", 600, { left: 900, right: 300 })).toEqual([
      300, 300, 300, 300, 420,
    ]);
  });
});

describe("the five annotations' shapes: below the hand (a phone)", () => {
  const { input, shapes } = layout(342, 844, 342, "below");
  const { box, rect, panel } = input;
  const k = box.scale;
  const s = k / DEMO_STAGE_SCALE;

  it("are five, in the story's order, with the demo's rings and emphasised lines", () => {
    expect(shapes).toHaveLength(5);
    expect(shapes.map((n) => n.rings.length)).toEqual([0, 0, 4, 4, 2]);
    expect(shapes.map((n) => n.emphasis !== null)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it("put the rings on the landmarks the copy names: 5, 9, 13, 17; 8, 12, 16, 20; 2 and 4", () => {
    const at = (landmarks: number[]) =>
      landmarks.map((i) => canvasPoint(box, LANDMARKS_MM[i]!));
    const centres = (n: number) =>
      shapes[n]!.rings.map((r) => [r.x, r.y] as const);
    expect(centres(2)).toEqual(at([5, 9, 13, 17]));
    expect(centres(3)).toEqual(at([8, 12, 16, 20]));
    expect(centres(4)).toEqual(at([2, 4]));
    // The demo's ring: a 26 px circle (12 px radius, 2 px stroke) at its scale.
    for (const ring of shapes.flatMap((n) => n.rings)) {
      expect(ring.r).toBeCloseTo(12 * s, 9);
    }
    expect(shapes[2]!.ringWidth).toBeCloseTo(2 * s, 9);
    expect(shapes[0]!.emphasisWidth).toBeCloseTo(2.5 * s, 9);
  });

  it("emphasise the existing measurement lines: the ruler beside the hand, the line across the palm", () => {
    const L = LENGTH_LINE_MM;
    expect(shapes[0]!.emphasis).toEqual({
      from: canvasPoint(box, [L.x, L.top]),
      to: canvasPoint(box, [L.x, L.bottom]),
    });
    const W = WIDTH_LINE_MM;
    expect(shapes[1]!.emphasis).toEqual({
      from: canvasPoint(box, [W.left, W.y]),
      to: canvasPoint(box, [W.right, W.y]),
    });
  });

  it("start each leader at its anchor and end it 4 px above the text, which is the same row for all five", () => {
    expect(LEADER_GAP_BELOW).toBe(4);
    const top = shapes[0]!.text.top;
    for (const note of shapes) {
      expect(note.text.top).toBe(top);
      expect(note.text.left).toBe(rect.x);
      expect(note.text.width).toBe(rect.width);
      expect(note.text.align).toBe("left");
      expect(note.leader.at(-1)![1]).toBeCloseTo(top - LEADER_GAP_BELOW, 9);
    }
    // Anchors: the ruler's foot, the width line's right end, landmark 17, landmark 20, the thumb tip.
    expect(shapes[0]!.leader[0]).toEqual(
      canvasPoint(box, [LENGTH_LINE_MM.x, LENGTH_LINE_MM.bottom]),
    );
    expect(shapes[1]!.leader[0]).toEqual(
      canvasPoint(box, [WIDTH_LINE_MM.right, WIDTH_LINE_MM.y]),
    );
    expect(shapes[2]!.leader[0]).toEqual(canvasPoint(box, LANDMARKS_MM[17]!));
    expect(shapes[3]!.leader[0]).toEqual(canvasPoint(box, LANDMARKS_MM[20]!));
    expect(shapes[4]!.leader[0]).toEqual(canvasPoint(box, LANDMARKS_MM[4]!));
  });

  it("run sideways from the anchor to a vertical line, then down: the ruler's own line straight down, the thumb's out to the left", () => {
    // The length note continues the ruler: one vertical segment.
    expect(shapes[0]!.leader).toHaveLength(2);
    expect(shapes[0]!.leader[1]![0]).toBe(shapes[0]!.leader[0]![0]);
    for (const n of [1, 2, 3]) {
      const [anchor, turn, end] = shapes[n]!.leader;
      expect(turn![1]).toBe(anchor![1]);
      expect(turn![0]).toBeGreaterThan(anchor![0]);
      expect(end![0]).toBe(turn![0]);
      expect(end![1]).toBeGreaterThan(turn![1]);
    }
    const [anchor, turn, end] = shapes[4]!.leader;
    expect(turn![0]).toBeLessThan(anchor![0]);
    expect(end![0]).toBe(turn![0]);
    // The vertical lines sit inside the A4 sheet's width, by the demo's numbers.
    const sheetRight = box.x + A4_MM.width * STAGE_SCALE * k;
    const sheetLeft = box.x;
    for (const n of [1, 2, 3]) {
      expect(shapes[n]!.leader[1]![0]).toBeLessThan(sheetRight + 6 * s);
    }
    expect(turn![0]).toBeGreaterThan(sheetLeft);
  });

  it("keep the text clear of the wrist above and inside the panel below", () => {
    const wristBottom =
      box.y + (246 + OUTLINE_PALM.width / 2) * STAGE_SCALE * k;
    for (const note of shapes) {
      expect(note.text.top).toBeGreaterThanOrEqual(
        wristBottom + WRIST_CLEARANCE,
      );
    }
    const tallest = 86;
    expect(shapes[0]!.text.top + tallest).toBeLessThanOrEqual(
      panel.height - PANEL_MARGIN,
    );
    // At 844 tall there is room for the demo's own spacing: 73 px under the sheet.
    const sheetBottom = box.y + A4_MM.height * STAGE_SCALE * k;
    expect(BELOW_FROM_SHEET).toBe(73);
    expect(shapes[0]!.text.top).toBeCloseTo(sheetBottom + 73, 6);
  });

  it("pull the text up to fit a short panel, but never into the wrist", () => {
    // 390 x 601: the shortest phone the stage animates on.
    const short = layout(342, 601, 342, "below");
    const bottom = short.shapes[0]!.text.top + 86;
    expect(bottom).toBeLessThanOrEqual(601 - PANEL_MARGIN);
    const wristBottom =
      short.input.box.y +
      (246 + OUTLINE_PALM.width / 2) * STAGE_SCALE * short.input.box.scale;
    expect(short.shapes[0]!.text.top).toBeGreaterThanOrEqual(
      wristBottom + WRIST_CLEARANCE,
    );
    // The leader is still a leader: it has some length below the hand.
    const end = short.shapes[2]!.leader.at(-1)![1];
    expect(end).toBeGreaterThan(short.shapes[2]!.leader[1]![1]);
  });
});

describe("the five annotations' shapes: beside the hand (a desktop)", () => {
  const { input, shapes } = layout(1200, 900, 608, "beside");
  const { rect } = input;

  it("put the text at the hand's right, level with its leader, and the thumb's at the left, right-aligned", () => {
    for (const n of [0, 1, 2, 3]) {
      expect(shapes[n]!.text.left).toBe(rect.x + rect.width + SIDE_GAP);
      expect(shapes[n]!.text.align).toBe("left");
    }
    expect(shapes[4]!.text.align).toBe("right");
    expect(shapes[4]!.text.left + shapes[4]!.text.width).toBe(
      rect.x - SIDE_GAP,
    );
  });

  it("run straight across from the anchor, ending 20 px short of the text", () => {
    expect(LEADER_GAP_SIDE).toBe(20);
    for (const n of [0, 1, 2, 3]) {
      const [anchor, end] = shapes[n]!.leader;
      expect(shapes[n]!.leader).toHaveLength(2);
      expect(end![1]).toBe(anchor![1]);
      expect(end![0]).toBe(shapes[n]!.text.left - 20);
      expect(end![0]).toBeGreaterThan(anchor![0]);
    }
    const [anchor, end] = shapes[4]!.leader;
    expect(end![1]).toBe(anchor![1]);
    expect(end![0]).toBe(shapes[4]!.text.left + shapes[4]!.text.width + 20);
    expect(end![0]).toBeLessThan(anchor![0]);
  });

  it("leave the ruler's leader from its middle, so the text is beside the hand's middle", () => {
    const { box } = input;
    const middle = canvasPoint(box, [
      LENGTH_LINE_MM.x,
      (LENGTH_LINE_MM.top + LENGTH_LINE_MM.bottom) / 2,
    ]);
    expect(shapes[0]!.leader[0]).toEqual(middle);
  });

  it("have the small line level with the leader (the demo), and the block inside the panel", () => {
    for (const note of shapes) {
      const [anchor] = note.leader;
      expect(note.text.top + 40 + 2).toBeCloseTo(anchor![1], 6);
      expect(note.text.top).toBeGreaterThanOrEqual(PANEL_MARGIN);
      expect(note.text.top + 63).toBeLessThanOrEqual(900 - PANEL_MARGIN + 23);
    }
  });

  it("clamp a block to the panel when its anchor is near an edge", () => {
    const tall: NoteText = { height: 300, smallTop: 40 };
    const clamped = layout(1200, 500, 400, "beside", [
      tall,
      tall,
      tall,
      tall,
      tall,
    ]);
    for (const note of clamped.shapes) {
      expect(note.text.top).toBeGreaterThanOrEqual(PANEL_MARGIN);
      expect(note.text.top + 300).toBeLessThanOrEqual(500 - PANEL_MARGIN);
    }
  });
});

describe("following the stage's transform", () => {
  it("moves and scales with the hand: twice the hand, twice the offsets from its corner; shifted hand, shifted shapes", () => {
    const a = layout(600, 900, 300, "below");
    const b = layout(600, 900, 600, "below");
    const offset = (x: number, y: number, box: { x: number; y: number }) =>
      [x - box.x, y - box.y] as const;
    const ringA = a.shapes[2]!.rings[0]!;
    const ringB = b.shapes[2]!.rings[0]!;
    const [ax, ay] = offset(ringA.x, ringA.y, a.input.box);
    const [bx, by] = offset(ringB.x, ringB.y, b.input.box);
    expect(bx).toBeCloseTo(ax * 2, 9);
    expect(by).toBeCloseTo(ay * 2, 9);
    expect(ringB.r).toBeCloseTo(ringA.r * 2, 9);

    // Move the same hand by (40, 25): every ring moves by exactly that.
    const moved = placeNotes({
      ...a.input,
      box: { ...a.input.box, x: a.input.box.x + 40, y: a.input.box.y + 25 },
    });
    expect(moved[2]!.rings[0]!.x).toBeCloseTo(ringA.x + 40, 9);
    expect(moved[2]!.rings[0]!.y).toBeCloseTo(ringA.y + 25, 9);
  });

  it("is a pure function of its input", () => {
    const a = layout(390, 844, 342, "below");
    expect(placeNotes(a.input)).toEqual(a.shapes);
  });
});
