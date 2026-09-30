import { describe, expect, it } from "vitest";
import {
  bestCyclicShift,
  shiftFour,
  type Four,
} from "../../src/client/camera/labelShift";
import {
  INITIAL_CORNER_STATES,
  advanceCorners,
  alignObservation,
  cornerDrawPoint,
  type CornerStates,
  type Observed,
} from "../../src/client/camera/cornerSmoother";
import {
  computeMaxCornerMovement,
  isSteady,
} from "../../src/client/camera/steadiness";
import type { Point, Quad } from "../../src/client/camera/quad";

const SHEET: Four<Point> = [
  { x: 30, y: 166 },
  { x: 362, y: 166 },
  { x: 362, y: 640 },
  { x: 30, y: 640 },
];

/** `shift` as the detector would deliver the same corners: label i holds corner (i + shift) % 4. */
const relabelled = (shift: number): Four<Point> => shiftFour(SHEET, shift);

/** States that are following SHEET. */
function tracking(): CornerStates {
  return advanceCorners(INITIAL_CORNER_STATES, SHEET, 125);
}

describe("bestCyclicShift and shiftFour", () => {
  it.each([0, 1, 2, 3])(
    "finds the shift %i the labels were rotated by",
    (shift) => {
      // candidate[(i + s) % 4] must land on reference[i]: the labels arrived
      // rotated so that label i holds the corner that was at (i - shift).
      const candidate = shiftFour(SHEET, (4 - shift) % 4);
      const found = bestCyclicShift(SHEET, candidate);
      expect(shiftFour(candidate, found)).toEqual(SHEET);
    },
  );

  it("shiftFour reads round the ring", () => {
    expect(shiftFour(["a", "b", "c", "d"], 0)).toEqual(["a", "b", "c", "d"]);
    expect(shiftFour(["a", "b", "c", "d"], 1)).toEqual(["b", "c", "d", "a"]);
    expect(shiftFour(["a", "b", "c", "d"], 3)).toEqual(["d", "a", "b", "c"]);
  });

  it("is not thrown by noise: corners a few px off still match", () => {
    const noisy: Four<Point> = [
      { x: 31.5, y: 164.9 },
      { x: 360.6, y: 167.4 },
      { x: 363.2, y: 638.7 },
      { x: 28.9, y: 641.3 },
    ];
    for (let shift = 0; shift < 4; shift++) {
      const arrived = shiftFour(noisy, (4 - shift) % 4);
      expect(shiftFour(arrived, bestCyclicShift(SHEET, arrived))).toEqual(
        noisy,
      );
    }
  });

  it("a tie keeps the smaller shift: four corners that cannot tell the labellings apart stay as they are", () => {
    // The same point four times: every shift costs the same.
    const same: Four<Point> = [
      { x: 10, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 10 },
    ];
    expect(bestCyclicShift(same, same)).toBe(0);
    // The same square with its labels turned: each labelling has its own
    // shift, so there is no tie there...
    const square: Four<Point> = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    // (arriving rotated by 1, it is undone by reading from 3 on)
    expect(bestCyclicShift(square, shiftFour(square, 1))).toBe(3);
    expect(bestCyclicShift(square, shiftFour(square, 2))).toBe(2);
    // ...but an observation equidistant from shifts 0 and 2 is a real tie.
    const flat: Four<Point> = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(bestCyclicShift(flat, flat)).toBe(0);
  });
});

describe("alignObservation: the dots follow the corners, not the labels", () => {
  it.each([0, 1, 2, 3])(
    "an observation relabelled by %i is put back in the order the dots are in",
    (shift) => {
      const observed = relabelled(shift);
      const aligned = alignObservation(tracking(), observed);
      expect(aligned).toEqual(SHEET);
    },
  );

  it("does nothing when a corner is missing: it cannot tell which labelling this is", () => {
    const partial: Observed = [null, SHEET[1], SHEET[2], SHEET[3]];
    expect(alignObservation(tracking(), partial)).toBe(partial);
    const turned: Observed = [
      null,
      ...shiftFour(SHEET, 2).slice(1),
    ] as unknown as Observed;
    expect(alignObservation(tracking(), turned)).toBe(turned);
  });

  it("does nothing while a dot has no position yet (the first sightings)", () => {
    const observed = relabelled(2);
    expect(alignObservation(INITIAL_CORNER_STATES, observed)).toBe(observed);
    const oneUnknown = advanceCorners(
      INITIAL_CORNER_STATES,
      [SHEET[0], SHEET[1], SHEET[2], null],
      125,
    );
    expect(alignObservation(oneUnknown, observed)).toBe(observed);
  });

  it("a tie leaves the observation as it came", () => {
    const flat: Four<Point> = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    const states = advanceCorners(INITIAL_CORNER_STATES, flat, 125);
    expect(alignObservation(states, flat)).toBe(flat);
  });
});

describe("advanceCorners across a relabel", () => {
  it.each([1, 2, 3])(
    "when the labels turn by %i no dot moves: the smoothed points stay where they were",
    (shift) => {
      let states = tracking();
      for (let i = 0; i < 5; i++) states = advanceCorners(states, SHEET, 125);
      const before = states.map((state) => cornerDrawPoint(state, SHEET[0]));
      const after = advanceCorners(states, relabelled(shift), 125).map(
        (state) => cornerDrawPoint(state, SHEET[0]),
      );
      for (let i = 0; i < 4; i++)
        expect(
          Math.hypot(after[i].x - before[i].x, after[i].y - before[i].y),
        ).toBeLessThan(1e-9);
    },
  );

  it("a genuine move is still followed and filtered, not mistaken for a relabel", () => {
    const moved: Four<Point> = SHEET.map((p) => ({
      x: p.x + 12,
      y: p.y - 8,
    })) as unknown as Four<Point>;
    const states = advanceCorners(tracking(), moved, 125);
    const point = cornerDrawPoint(states[0], SHEET[0]);
    expect(point.x).toBeCloseTo(30 + 0.35 * 12, 6);
    expect(point.y).toBeCloseTo(166 - 0.35 * 8, 6);
  });

  it("the outline does not collapse with the labels flipping back and forth around the boundary", () => {
    let states = tracking();
    for (let i = 0; i < 40; i++)
      states = advanceCorners(states, relabelled(i % 2 === 0 ? 2 : 0), 125);
    const points = states.map((state) => cornerDrawPoint(state, SHEET[0]));
    const width = Math.hypot(
      points[1].x - points[0].x,
      points[1].y - points[0].y,
    );
    const height = Math.hypot(
      points[3].x - points[0].x,
      points[3].y - points[0].y,
    );
    expect(width).toBeCloseTo(332, 3);
    expect(height).toBeCloseTo(474, 3);
  });
});

describe("computeMaxCornerMovement and isSteady across a relabel", () => {
  const quad = (points: Four<Point>): Quad => ({
    topLeft: points[0],
    topRight: points[1],
    bottomRight: points[2],
    bottomLeft: points[3],
  });

  it.each([1, 2, 3])(
    "the same paper relabelled by %i is not movement: 0, not a corner-to-corner jump",
    (shift) => {
      expect(
        computeMaxCornerMovement(quad(SHEET), quad(relabelled(shift))),
      ).toBeCloseTo(0, 9);
    },
  );

  it("so a flip of the labels is not an unsteady sample", () => {
    const diagonal = 1000;
    expect(isSteady(quad(SHEET), quad(relabelled(2)), diagonal)).toBe(true);
  });

  it("real movement still counts, through a relabel", () => {
    const moved = relabelled(2).map((p) => ({
      x: p.x + 20,
      y: p.y,
    })) as unknown as Four<Point>;
    expect(computeMaxCornerMovement(quad(SHEET), quad(moved))).toBeCloseTo(
      20,
      6,
    );
    expect(isSteady(quad(SHEET), quad(moved), 1000)).toBe(false);
  });
});
