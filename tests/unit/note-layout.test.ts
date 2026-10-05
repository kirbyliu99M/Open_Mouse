import { describe, expect, it } from "vitest";
import { DEMO_STAGE_SCALE } from "@/lib/particles/hand-outline";
import {
  noteMode,
  noteTextWidths,
  placeNotes,
  sideRoom,
  type NoteLayoutInput,
  type NoteShape,
  type NoteText,
} from "@/lib/particles/note-layout";
import { handBox } from "@/lib/particles/particle-set";
import {
  A4_MM,
  HAND_MARGIN_MM,
  LANDMARKS_MM,
  LENGTH_LINE_MM,
  STAGE_SCALE,
  TICK_MM,
  WIDTH_LINE_MM,
} from "@/lib/particles/template-hand";

/**
 * Every number the layout is held to is written here as a literal, on purpose:
 * a test that imports a constant to compare it with itself passes whatever the
 * constant is. (The demo's numbers: the ring is 12 px in radius and 2 px thick,
 * the emphasised line 2.5 px, a leader stops 4 px above a text block below the
 * hand and 20 px short of one beside it; the text is 73 px under the A4 sheet
 * and 28 px from the hand's image.)
 */

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

function input(
  panelWidth: number,
  panelHeight: number,
  imageWidth: number,
  mode: "below" | "beside",
  texts: NoteText[] = [oneLine, oneLine, twoLines, oneLine, oneLine],
  widths?: number[],
): NoteLayoutInput {
  const { rect, box } = setup(panelWidth, panelHeight, imageWidth);
  return {
    box,
    rect,
    panel: { width: panelWidth, height: panelHeight },
    mode,
    widths:
      widths ??
      [1, 2, 3, 4, 5].map(() => (mode === "below" ? rect.width : 300)),
    texts,
  };
}

/** The shapes for a layout that must have a place for them. */
function layout(
  panelWidth: number,
  panelHeight: number,
  imageWidth: number,
  mode: "below" | "beside",
  texts?: NoteText[],
  widths?: number[],
): { input: NoteLayoutInput; shapes: NoteShape[] } {
  const given = input(panelWidth, panelHeight, imageWidth, mode, texts, widths);
  const shapes = placeNotes(given);
  if (!shapes) throw new Error("the notes have no place in this layout");
  return { input: given, shapes };
}

const canvasPoint = (
  box: { x: number; y: number; scale: number },
  mm: readonly [number, number],
) =>
  [
    box.x + mm[0] * STAGE_SCALE * box.scale,
    box.y + mm[1] * STAGE_SCALE * box.scale,
  ] as const;

/** The A4 sheet's bottom edge in canvas px. */
const sheetBottomOf = (box: { y: number; scale: number }) =>
  box.y + 297 * STAGE_SCALE * box.scale;

describe("beside or below", () => {
  it("is beside only when both sides of the hand have room for the text", () => {
    expect(noteMode({ left: 176, right: 176 })).toBe("beside");
    expect(noteMode({ left: 400, right: 400 })).toBe("beside");
    expect(noteMode({ left: 175, right: 400 })).toBe("below");
    expect(noteMode({ left: 400, right: 175 })).toBe("below");
    expect(noteMode({ left: -10, right: -10 })).toBe("below");
  });

  it("measures the room from the image's edges to the page's gutter (24 px), less the gap (28 px)", () => {
    // 1440 wide, a 608 px hand centred: 416 px at each side of the image.
    expect(sideRoom(416, 1024, 1440)).toEqual({
      left: 416 - 28 - 24,
      right: 1440 - 24 - 1024 - 28,
    });
    expect(noteMode(sideRoom(416, 1024, 1440))).toBe("beside");
    // A phone and a 768 px wide window: no room at the sides, text below.
    expect(noteMode(sideRoom(24, 366, 390))).toBe("below");
    expect(noteMode(sideRoom(80, 688, 768))).toBe("below");
  });

  it("gives a block below the hand the image's width, and a block beside it the room (to 420)", () => {
    expect(noteTextWidths("below", 342, { left: 0, right: 0 })).toEqual([
      342, 342, 342, 342, 342,
    ]);
    expect(noteTextWidths("beside", 600, { left: 900, right: 300 })).toEqual([
      300, 300, 300, 300, 420,
    ]);
    expect(noteTextWidths("beside", 600, { left: 419, right: 421 })).toEqual([
      420, 420, 420, 420, 419,
    ]);
  });
});

describe("the five annotations' shapes: below the hand (a phone)", () => {
  const { input: given, shapes } = layout(342, 844, 342, "below");
  const { box, rect, panel } = given;
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
      tick: TICK_MM * STAGE_SCALE * k,
    });
    const W = WIDTH_LINE_MM;
    expect(shapes[1]!.emphasis).toEqual({
      from: canvasPoint(box, [W.left, W.y]),
      to: canvasPoint(box, [W.right, W.y]),
      tick: TICK_MM * STAGE_SCALE * k,
    });
  });

  it("start each leader at its anchor and end it 4 px above the text, which is the same row for all five", () => {
    const top = shapes[0]!.text.top;
    for (const note of shapes) {
      expect(note.text.top).toBe(top);
      expect(note.text.left).toBe(rect.x);
      expect(note.text.width).toBe(rect.width);
      expect(note.text.align).toBe("left");
      expect(note.leader.at(-1)![1]).toBeCloseTo(top - 4, 9);
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
  });

  it("turn at the demo's x, read off its phone frames, in mm on the A4 sheet: palm width 207.2, knuckles 201.7, fingertips 212.8, thumb 3.5", () => {
    const turnAt = (note: number, mm: number) => {
      expect(shapes[note]!.leader[1]![0], `note ${note + 1}`).toBeCloseTo(
        canvasPoint(box, [mm, 0])[0],
        9,
      );
    };
    turnAt(1, 207.2);
    turnAt(2, 201.7);
    turnAt(3, 212.8);
    turnAt(4, 3.5);
    // The ruler's note does not turn: it goes down the ruler, at 222 mm.
    expect(shapes[0]!.leader[1]![0]).toBeCloseTo(
      canvasPoint(box, [222, 0])[0],
      9,
    );
  });

  it("keep the text under the A4 sheet's bottom edge by the demo's 73 px, and inside the panel", () => {
    const sheetBottom = sheetBottomOf(box);
    expect(shapes[0]!.text.top).toBeCloseTo(sheetBottom + 73, 6);
    // The tallest block (two lines of small text, 86 px) ends 16 px or more above the panel's bottom.
    expect(shapes[0]!.text.top + 86).toBeLessThanOrEqual(panel.height - 16);
  });
});

describe("the text never crosses the A4 sheet's bottom edge, or its corner marks", () => {
  /**
   * The five windows where the text used to cross the sheet's bottom edge
   * (measured in the page before the fix: the text's top was this many px above
   * the sheet's bottom edge, the first line over the hairline and the corner
   * marks). The hand's image is as home.css sizes it: the panel's width, to 26
   * rem (416 px) under 768 px wide and 38 rem (608 px) from there, and 86 % of
   * the viewport's height in the image's aspect.
   */
  const crossed = [
    [800, 600, 37.6],
    [900, 700, 28.3],
    [800, 700, 28.3],
    [700, 600, 19.2],
    [1000, 800, 19.1],
  ] as const;
  /** Windows where it never did: both phones, and a tablet at 768 and at 820 wide. */
  const fine = [
    [375, 667],
    [390, 844],
    [768, 1024],
    [820, 1180],
  ] as const;

  /** A window as the page lays it out: the panel, the hand's image, the mode and the measured text (phone type under 768 px wide, desktop type from there). */
  function scene(width: number, height: number) {
    const gutter = Math.min(24, Math.max(16, 16 + (width - 360) * 0.5));
    const panelWidth = Math.min(width, 1248) - 2 * gutter;
    const handMax = width >= 768 ? 608 : 416;
    const image = Math.min(panelWidth, handMax, 0.86 * height * (411 / 507));
    const left = (width - image) / 2;
    const mode = noteMode(sideRoom(left, left + image, width));
    const text: NoteText =
      width >= 768
        ? { height: 77, smallTop: 50 }
        : { height: 60, smallTop: 40 };
    return {
      mode,
      given: input(panelWidth, height, image, mode, [
        text,
        text,
        text,
        text,
        text,
      ]),
    };
  }

  it("has no place for them in the five windows where it used to cross: below mode, and more than 15 px short of fitting", () => {
    for (const [width, height, wasOver] of crossed) {
      const { mode, given } = scene(width, height);
      expect(mode, `${width}x${height} is below the hand`).toBe("below");
      expect(placeNotes(given), `${width}x${height}`).toBeNull();
      // The reason: the first place under the sheet's edge leaves the block
      // past the panel's bottom, by more than the overlap the old rule bought.
      const sheetBottom = sheetBottomOf(given.box);
      const bottom = sheetBottom + 10 + given.texts[0]!.height;
      expect(bottom, `${width}x${height}`).toBeGreaterThan(height - 8 + 15);
      // And the old rule would have put the top this far above the sheet's edge.
      const old = Math.min(
        sheetBottom + 73,
        height - 16 - given.texts[0]!.height,
      );
      expect(sheetBottom - old, `${width}x${height} before`).toBeGreaterThan(
        wasOver - 1.5,
      );
      expect(sheetBottom - old).toBeLessThan(wasOver + 1.5);
    }
  });

  it("places them clear of the sheet, 10 px or more under its bottom edge, in the four windows that always worked, and the phones' places are unchanged", () => {
    for (const [width, height] of fine) {
      const { mode, given } = scene(width, height);
      expect(mode, `${width}x${height}`).toBe("below");
      const shapes = placeNotes(given)!;
      expect(shapes, `${width}x${height}`).not.toBeNull();
      const sheetBottom = sheetBottomOf(given.box);
      for (const note of shapes) {
        expect(note.text.top).toBeGreaterThanOrEqual(sheetBottom + 10);
        expect(note.text.top + given.texts[0]!.height).toBeLessThanOrEqual(
          height - 8,
        );
      }
      // The demo's 73 px under the sheet, pulled up only as far as the panel's
      // 16 px bottom margin asks (the shortest phone, 375x667, is pulled up).
      expect(shapes[0]!.text.top).toBeCloseTo(
        Math.min(sheetBottom + 73, height - 16 - given.texts[0]!.height),
        6,
      );
    }
    // The shortest phone keeps its place: 73 px under the sheet, and 16 px or more above the bottom.
    const phone = scene(375, 667);
    const top = placeNotes(phone.given)![0]!.text.top;
    expect(top + 60).toBeLessThanOrEqual(667 - 16);
  });

  it("holds the floor on every window from 360 to 1440 px wide and 601 to 1300 px tall: a place is 10 px or more under the sheet and 8 px or more above the panel's bottom, or there is none", () => {
    let placed = 0;
    let left = 0;
    for (let width = 360; width <= 1440; width += 20) {
      for (let height = 601; height <= 1300; height += 23) {
        const { mode, given } = scene(width, height);
        const shapes = placeNotes(given);
        if (!shapes) {
          left += 1;
          continue;
        }
        placed += 1;
        const sheetBottom = sheetBottomOf(given.box);
        const tallest = given.texts[0]!.height;
        for (const note of shapes) {
          if (mode === "below") {
            expect(note.text.top, `${width}x${height}`).toBeGreaterThanOrEqual(
              sheetBottom + 10,
            );
            expect(
              note.text.top + tallest,
              `${width}x${height}`,
            ).toBeLessThanOrEqual(height - 8);
          } else {
            expect(note.text.top, `${width}x${height}`).toBeGreaterThanOrEqual(
              16,
            );
            expect(
              note.text.top + tallest,
              `${width}x${height}`,
            ).toBeLessThanOrEqual(height - 8);
          }
        }
      }
    }
    // Most windows have a place; the band of small ones does not.
    expect(placed).toBeGreaterThan(left * 3);
    expect(left).toBeGreaterThan(0);
  });

  it("is exact at the floor: pulled up on a short panel the block stops 10 px under the sheet, and with less than 8 px to spare under it there is no place", () => {
    const base = input(342, 844, 342, "below");
    const sheetBottom = sheetBottomOf(base.box);
    const height = 63;
    const texts = [1, 2, 3, 4, 5].map(() => ({ height, smallTop: 40 }));
    const at = (panelHeight: number) =>
      placeNotes({
        ...base,
        panel: { width: 342, height: panelHeight },
        texts,
      });
    // The preferred margin (16 px) pulls the block up to 14 px under the sheet.
    expect(at(sheetBottom + 14 + height + 16)![0]!.text.top).toBeCloseTo(
      sheetBottom + 14,
      9,
    );
    // Pulled up further it stops at the floor: 10 px under the sheet's edge.
    expect(at(sheetBottom + 10 + height + 12)![0]!.text.top).toBeCloseTo(
      sheetBottom + 10,
      9,
    );
    expect(at(sheetBottom + 10 + height + 8)![0]!.text.top).toBeCloseTo(
      sheetBottom + 10,
      9,
    );
    // 7 px to spare under the block: it does not fit, so there is no place.
    expect(at(sheetBottom + 10 + height + 7)).toBeNull();
    // With room to spare it is 73 px under the sheet, as in the demo.
    expect(at(sheetBottom + 73 + height + 16)![0]!.text.top).toBeCloseTo(
      sheetBottom + 73,
      9,
    );
  });

  it("beside the hand: a block taller than the panel less 16 px has no place; one that just fits sits 16 px in", () => {
    const tall: NoteText = { height: 300, smallTop: 40 };
    const five = [tall, tall, tall, tall, tall];
    expect(placeNotes(input(1200, 315, 300, "beside", five))).toBeNull();
    const fits = placeNotes(input(1200, 316, 300, "beside", five))!;
    expect(fits.map((note) => note.text.top)).toEqual([16, 16, 16, 16, 16]);
  });
});

describe("the five annotations' shapes: beside the hand (a desktop)", () => {
  const { input: given, shapes } = layout(1200, 900, 608, "beside");
  const { rect } = given;

  it("put the text 28 px from the hand's image, level with its leader, and the thumb's at the left, right-aligned", () => {
    for (const n of [0, 1, 2, 3]) {
      expect(shapes[n]!.text.left).toBe(rect.x + rect.width + 28);
      expect(shapes[n]!.text.align).toBe("left");
    }
    expect(shapes[4]!.text.align).toBe("right");
    expect(shapes[4]!.text.left + shapes[4]!.text.width).toBe(rect.x - 28);
  });

  it("run straight across from the anchor, ending 20 px short of the text", () => {
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
    const { box } = given;
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
      expect(note.text.top).toBeGreaterThanOrEqual(16);
      expect(note.text.top + 63).toBeLessThanOrEqual(900 - 16 + 23);
    }
  });

  it("clamp a block to the panel, 16 px in, when its anchor is near an edge", () => {
    const tall: NoteText = { height: 300, smallTop: 40 };
    const five = [tall, tall, tall, tall, tall];
    // A short panel: every block is held 16 px from the top.
    const short = layout(1200, 332, 400, "beside", five).shapes;
    expect(short.map((n) => n.text.top)).toEqual([16, 16, 16, 16, 16]);
    // A taller one: held 16 px from the bottom (500 - 16 - 300 = 184), except
    // the fingertips' note, whose anchor is high enough to sit level with it.
    const clamped = layout(1200, 500, 400, "beside", five).shapes;
    expect(clamped.map((n) => Math.round(n.text.top * 10) / 10)).toEqual([
      184,
      184,
      184,
      Math.round((clamped[3]!.leader[0]![1] - 42) * 10) / 10,
      184,
    ]);
    expect(clamped[3]!.text.top).toBeLessThan(184);
  });
});

describe("following the stage's transform", () => {
  it("moves and scales with the hand: twice the hand, twice the offsets from its corner; shifted hand, shifted shapes", () => {
    const a = layout(600, 1200, 300, "below");
    const b = layout(600, 1200, 600, "below");
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
    })!;
    expect(moved[2]!.rings[0]!.x).toBeCloseTo(ringA.x + 40, 9);
    expect(moved[2]!.rings[0]!.y).toBeCloseTo(ringA.y + 25, 9);
  });

  it("is a pure function of its input", () => {
    const a = layout(390, 844, 342, "below");
    expect(placeNotes(a.input)).toEqual(a.shapes);
  });
});
