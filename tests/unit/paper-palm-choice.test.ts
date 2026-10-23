/**
 * V3.2 F17 (candidate, 未拍板; Kirby's preview 7: "it went to my window"):
 * with the hand known, the detector takes the bright region that holds the
 * palm for the sheet, not simply the largest. The pure choice
 * (palmChoice.ts), the detector on a drawn scene (a window larger than the
 * sheet), and the S2 golden scenes (no hand: exactly as they were). All
 * scenes SIMULATED (模擬).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Point2 } from "../../src/client/geometry/homography";
import { CAMERA_CONSTANTS } from "../../src/client/camera/constants";
import { livePalmHint } from "../../src/client/camera/noSheetCapture";
import { detectPaperQuad } from "../../src/client/paper/detect";
import {
  PALM_CHOICE,
  PALM_LANDMARK_INDICES,
  choosePaperCandidate,
  palmPointsOf,
  pointInConvexQuad,
  pointsInside,
  type PaperCandidate,
} from "../../src/client/paper/palmChoice";
import {
  goldenFrames,
  goldenRecord,
  type GoldenRecord,
} from "./helpers/s2-golden-scenes";

type Q = readonly [Point2, Point2, Point2, Point2];
const rect = (x0: number, y0: number, x1: number, y1: number): Q => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

describe("the pure choice (palmChoice.ts)", () => {
  it("the palm is the wrist and the four knuckles; four of five must be inside", () => {
    expect(PALM_LANDMARK_INDICES).toEqual([0, 5, 9, 13, 17]);
    expect(PALM_CHOICE.minPointsInside).toBe(4);
  });

  it("palmPointsOf: the five points of a 21-landmark hand, or null", () => {
    const hand = Array.from({ length: 21 }, (_, i) => ({ x: i, y: 2 * i }));
    expect(palmPointsOf(hand)).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 10 },
      { x: 9, y: 18 },
      { x: 13, y: 26 },
      { x: 17, y: 34 },
    ]);
    expect(palmPointsOf(null)).toBeNull();
    expect(palmPointsOf(hand.slice(0, 20))).toBeNull();
    const broken = hand.map((p, i) => (i === 9 ? { x: NaN, y: 1 } : p));
    expect(palmPointsOf(broken)).toBeNull();
  });

  it("pointInConvexQuad: inside, on an edge, outside, either winding", () => {
    const q = rect(0, 0, 10, 20);
    const reversed: Q = [q[3], q[2], q[1], q[0]];
    for (const quad of [q, reversed]) {
      expect(pointInConvexQuad({ x: 5, y: 5 }, quad)).toBe(true);
      expect(pointInConvexQuad({ x: 0, y: 5 }, quad)).toBe(true);
      expect(pointInConvexQuad({ x: 11, y: 5 }, quad)).toBe(false);
      expect(pointInConvexQuad({ x: 5, y: -0.1 }, quad)).toBe(false);
    }
    expect(pointInConvexQuad({ x: NaN, y: 1 }, q)).toBe(false);
    expect(pointsInside(null, [{ x: 1, y: 1 }])).toBe(0);
  });

  const WINDOW: PaperCandidate = {
    label: 0,
    area: 160000,
    quad: rect(40, 20, 560, 340),
  };
  const SHEET: PaperCandidate = {
    label: 1,
    area: 60000,
    quad: rect(190, 420, 410, 731),
  };
  const PALM_ON_SHEET = [
    { x: 300, y: 720 },
    { x: 250, y: 600 },
    { x: 280, y: 590 },
    { x: 310, y: 592 },
    { x: 340, y: 600 },
  ];

  it("a window larger than the sheet, the palm on the sheet: the sheet, reason palm", () => {
    expect(choosePaperCandidate([WINDOW, SHEET], PALM_ON_SHEET)).toEqual({
      label: 1,
      reason: "palm",
      candidates: 2,
      palmInside: 5,
      largestPalmInside: 0,
    });
  });

  it("the wrist off the sheet's edge: four of five still choose it", () => {
    const wristOff = [{ x: 300, y: 760 }, ...PALM_ON_SHEET.slice(1)];
    expect(choosePaperCandidate([WINDOW, SHEET], wristOff)).toMatchObject({
      label: 1,
      reason: "palm",
      palmInside: 4,
    });
    // Three of five is not enough: the largest, as before.
    const two = [
      { x: 300, y: 760 },
      { x: 250, y: 800 },
      ...PALM_ON_SHEET.slice(2),
    ];
    expect(choosePaperCandidate([WINDOW, SHEET], two)).toMatchObject({
      label: 0,
      reason: "no_candidate_holds_palm",
    });
  });

  it("the largest holds the palm, or there is only one region: the largest, as before", () => {
    const palmInWindow = PALM_ON_SHEET.map((p) => ({ x: p.x, y: p.y - 400 }));
    expect(choosePaperCandidate([SHEET, WINDOW], palmInWindow)).toMatchObject({
      label: 0,
      reason: "largest_holds_palm",
      palmInside: 5,
    });
    expect(choosePaperCandidate([WINDOW], PALM_ON_SHEET)).toMatchObject({
      label: 0,
      reason: "only_candidate",
      palmInside: 0,
    });
    expect(choosePaperCandidate([], PALM_ON_SHEET)).toBeNull();
  });

  it("two smaller regions hold the palm: the larger of them; equal areas go to the lower label", () => {
    const a = { ...SHEET, label: 2, area: 50000 };
    const b = { ...SHEET, label: 3, area: 55000 };
    expect(choosePaperCandidate([WINDOW, a, b], PALM_ON_SHEET)?.label).toBe(3);
    // Two regions of the window's size, neither holding the palm: the tie
    // goes to label 0, wherever it is in the list.
    const c = { ...SHEET, label: 4, area: 160000, quad: WINDOW.quad };
    expect(choosePaperCandidate([c, WINDOW], PALM_ON_SHEET)?.label).toBe(0);
  });
});

// ── The detector on a drawn scene ─────────────────────────────────────────

const W = 600;
const H = 800;

/** A dark desk, a bright window (top), an A4 sheet (bottom) and a skin-tone hand on the sheet. */
function windowScene(): ImageData {
  const data = new Uint8ClampedArray(W * H * 4);
  const put = (x: number, y: number, r: number, g: number, b: number) => {
    const i = (y * W + x) * 4;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const inWindow = x >= 40 && x < 560 && y >= 20 && y < 340;
      const inSheet = x >= 190 && x < 410 && y >= 420 && y < 731;
      const inHand = x >= 260 && x < 340 && y >= 560 && y < 800;
      if (inHand) put(x, y, 205, 140, 110);
      else if (inWindow) put(x, y, 250, 250, 252);
      else if (inSheet) put(x, y, 238, 238, 236);
      else put(x, y, 55, 50, 48);
    }
  return { width: W, height: H, data } as unknown as ImageData;
}

const PALM: Point2[] = [
  { x: 300, y: 725 },
  { x: 268, y: 600 },
  { x: 290, y: 592 },
  { x: 312, y: 594 },
  { x: 332, y: 602 },
];

describe("the detector, a window larger than the sheet (模擬)", () => {
  const frame = windowScene();

  it("without the hand: the largest bright region (the window) is taken, as before, and no choice is recorded", () => {
    const d = detectPaperQuad(frame, "a4", { failureGuess: true });
    expect(d.paperChoice).toBeUndefined();
    // The window is not A4-shaped: no sheet.
    expect(d.corners).toBeNull();
    // Its rough quad (where the adjustment screen would open) is the window's.
    if (d.guessCorners) {
      const cy =
        d.guessCorners.reduce((sum, p) => sum + p.y, 0) / d.guessCorners.length;
      expect(cy).toBeLessThan(400);
    }
  });

  it("with the palm: the sheet is found, its corners within 2 px of the drawn ones, and the choice says why", () => {
    const d = detectPaperQuad(frame, "a4", {
      failureGuess: true,
      palmPointsPx: PALM,
    });
    expect(d.paperChoice).toEqual({
      reason: "palm",
      candidates: 2,
      palmInside: 5,
      largestPalmInside: 0,
    });
    expect(d.corners).not.toBeNull();
    const want = rect(190, 420, 410, 731);
    const xs = d.corners!.map((p) => p.x);
    const ys = d.corners!.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(want[0].x, -0.5);
    expect(Math.max(...xs)).toBeCloseTo(want[1].x, -0.5);
    expect(Math.min(...ys)).toBeCloseTo(want[0].y, -0.5);
    expect(Math.max(...ys)).toBeCloseTo(want[2].y, -0.5);
  });

  it("the same frame, the palm in the window: the window, recorded as largest_holds_palm", () => {
    const d = detectPaperQuad(frame, "a4", {
      palmPointsPx: PALM.map((p) => ({ x: p.x, y: p.y - 450 })),
    });
    expect(d.paperChoice?.reason).toBe("largest_holds_palm");
    expect(d.corners).toBeNull();
  });
});

/**
 * F17 review (模擬): a 9 : 16 frame (512 x 960, the shape of 1024 x 1920), a
 * large window at the top and an A4 sheet held high (0.4 of the frame's
 * width, 205 x 290 px, 0.121 of the frame), a skin-tone hand covering 25 %
 * of it from its bottom edge: the sheet shows about 0.091 of the frame, under
 * the detector's 0.1 area floor.
 */
const HW = 512;
const HH = 960;
const HIGH_SHEET = { x0: 154, y0: 560, x1: 359, y1: 850 };
const HIGH_HAND = { x0: 211, y0: 685, x1: 301, y1: 910 };
function highSheetScene(): ImageData {
  const data = new Uint8ClampedArray(HW * HH * 4);
  const inR = (
    x: number,
    y: number,
    r: { x0: number; y0: number; x1: number; y1: number },
  ) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
  for (let y = 0; y < HH; y++)
    for (let x = 0; x < HW; x++) {
      const i = (y * HW + x) * 4;
      let c = [55, 50, 48];
      if (inR(x, y, HIGH_HAND)) c = [205, 140, 110];
      else if (x >= 30 && x < 480 && y >= 20 && y < 330) c = [250, 250, 252];
      else if (inR(x, y, HIGH_SHEET)) c = [238, 238, 236];
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  return { width: HW, height: HH, data } as unknown as ImageData;
}
const HIGH_PALM: Point2[] = [
  { x: 256, y: 840 },
  { x: 225, y: 705 },
  { x: 245, y: 698 },
  { x: 266, y: 698 },
  { x: 286, y: 705 },
];

describe("F17 review: a sheet held high, a quarter under the hand, a larger window beside it (模擬)", () => {
  const frame = highSheetScene();
  const sheetArea =
    (HIGH_SHEET.x1 - HIGH_SHEET.x0) * (HIGH_SHEET.y1 - HIGH_SHEET.y0);
  const covered =
    (HIGH_HAND.x1 - HIGH_HAND.x0) * (HIGH_SHEET.y1 - HIGH_HAND.y0);
  const centreY = (q: readonly Point2[]) =>
    q.reduce((sum, p) => sum + p.y, 0) / q.length;

  it("the scene: 0.4 of the width, about 25 % covered, the visible sheet under 0.1 of the frame", () => {
    expect((HIGH_SHEET.x1 - HIGH_SHEET.x0) / HW).toBeCloseTo(0.4, 2);
    expect(covered / sheetArea).toBeCloseTo(0.25, 1);
    expect((sheetArea - covered) / (HW * HH)).toBeGreaterThan(0.085);
    expect((sheetArea - covered) / (HW * HH)).toBeLessThan(0.1);
  });

  it("with the palm the sheet is the candidate taken (reason palm), and the adjustment screen's rough frame is on the sheet, not the window", () => {
    const d = detectPaperQuad(frame, "a4", {
      failureGuess: true,
      palmPointsPx: HIGH_PALM,
    });
    expect(d.paperChoice?.reason).toBe("palm");
    expect(d.paperChoice?.palmInside).toBe(5);
    expect(d.paperChoice?.largestPalmInside).toBe(0);
    // Under the area floor (unchanged): not found...
    expect(d.corners).toBeNull();
    // ...but the rough frame is the sheet's own hull.
    expect(d.guessCorners).not.toBeNull();
    const g = d.guessCorners!;
    expect(centreY(g)).toBeGreaterThan(HIGH_SHEET.y0);
    expect(centreY(g)).toBeLessThan(HIGH_SHEET.y1);
    for (const p of g) {
      expect(p.x).toBeGreaterThan(HIGH_SHEET.x0 - 4);
      expect(p.x).toBeLessThan(HIGH_SHEET.x1 + 4);
      expect(p.y).toBeGreaterThan(HIGH_SHEET.y0 - 4);
      expect(p.y).toBeLessThan(HIGH_SHEET.y1 + 4);
    }
  });

  it("without the palm: as before, no choice is recorded and the largest region, the window, is what the detector works on (here its 450 x 310 px outline even passes as a sheet)", () => {
    const d = detectPaperQuad(frame, "a4", { failureGuess: true });
    expect(d.paperChoice).toBeUndefined();
    const q = d.corners ?? d.guessCorners;
    expect(q).not.toBeNull();
    expect(centreY(q!)).toBeLessThan(HIGH_SHEET.y0);
  });
});

// ── The S2 golden scenes ──────────────────────────────────────────────────

const golden = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures", "s2-paper-golden.json"), "utf8"),
) as GoldenRecord[];

describe("S2 golden scenes (91, 模擬) with the F17 change", () => {
  const frames = goldenFrames();

  it("there are 91, and with no hand every one is exactly as recorded (the no-palm path is the old path)", () => {
    expect(frames).toHaveLength(91);
    const after = frames.map(goldenRecord);
    for (let i = 0; i < golden.length; i++)
      expect(after[i], golden[i].name).toStrictEqual(golden[i]);
  }, 120_000);

  it("with a palm on each found sheet (its centre), no scene changes: every one has a single sizeable region or the largest holds the palm", () => {
    const changed: string[] = [];
    const reasons = new Map<string, number>();
    frames.forEach((frame, i) => {
      const corners = golden[i].detection.corners as Point2[] | null;
      if (!corners) return;
      const c = {
        x: corners.reduce((s, p) => s + p.x, 0) / 4,
        y: corners.reduce((s, p) => s + p.y, 0) / 4,
      };
      const palm = [-2, -1, 0, 1, 2].map((k) => ({ x: c.x + k, y: c.y + k }));
      const image = {
        width: frame.width,
        height: frame.height,
        data: frame.data,
      } as unknown as ImageData;
      const before = detectPaperQuad(image, "a4");
      const after = detectPaperQuad(image, "a4", { palmPointsPx: palm });
      const { paperChoice, ...rest } = after;
      reasons.set(
        paperChoice?.reason ?? "none",
        (reasons.get(paperChoice?.reason ?? "none") ?? 0) + 1,
      );
      if (JSON.stringify(rest) !== JSON.stringify(before))
        changed.push(frame.name);
    });
    expect(changed).toEqual([]);
    expect(reasons.get("palm") ?? 0).toBe(0);
  }, 120_000);
});

// ── The live preview (F14's hand sampling) ────────────────────────────────

describe("livePalmHint (the live detector's palm, F17)", () => {
  const hand = Array.from({ length: 21 }, (_, i) => ({
    x: 100 + i,
    y: 200 + i,
  }));
  const stale = CAMERA_CONSTANTS.noSheetCapture.handStaleMs;

  it("the newest reading's palm while it is fresh and on the sample; otherwise none", () => {
    const at = (atMs: number, points: typeof hand | null = hand) => ({
      latest: { atMs, points },
      nowMs: 10_000,
      width: 640,
      height: 480,
    });
    expect(livePalmHint(at(10_000 - stale))).toEqual(palmPointsOf(hand));
    expect(livePalmHint(at(10_000 - stale - 1))).toBeUndefined();
    expect(livePalmHint(at(10_001))).toBeUndefined();
    expect(livePalmHint(at(9_900, null))).toBeUndefined();
    expect(
      livePalmHint({ latest: null, nowMs: 1, width: 640, height: 480 }),
    ).toBeUndefined();
    // A reading made on a larger sample: not used.
    expect(
      livePalmHint({ ...at(9_900), width: 110, height: 480 }),
    ).toBeUndefined();
  });

  it("EasyScanCamera passes it to the live detector only when there is one", () => {
    const camera = readFileSync("src/client/camera/EasyScanCamera.tsx", "utf8");
    expect(camera).toMatch(
      /const palm = livePalmHint\(\{\s*latest: handReadingsRef\.current\.latest,\s*nowMs: now,\s*width,\s*height,\s*\}\);/,
    );
    expect(camera).toContain("...(palm ? { palmPointsPx: palm } : {}),");
  });
});
