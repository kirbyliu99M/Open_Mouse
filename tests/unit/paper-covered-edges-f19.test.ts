/**
 * V3.2 F19 (candidate): the paper detector with the hand's landmarks leaves
 * out what the hand and arm cover. Every scene here is SIMULATED (模擬,
 * `helpers/f19-hand-scenes.ts`): a straight-down A4 sheet, 540 × 960 px.
 *
 * The measured cases this stands for (實測, 2026-10-23/24): with the arm over
 * the bottom edge the worst side's residual read 8.343 mm and 3.805 mm (flat:
 * 0.42-0.74 mm), and a sheet cut by the arm was not found. The simulated arm
 * over the bottom edge reproduces the mechanism (a pale arm in bright light
 * joins the sheet's bright region, and its edge and shadow are taken for the
 * sheet's bottom edge), not those exact numbers.
 */
import { describe, expect, it } from "vitest";
import {
  detectPaperQuad,
  type SheetQuadDetection,
} from "../../src/client/paper/detect";
import { evaluatePaperEdgeCalibration } from "../../src/client/paper/calibration";
import { PAPER_EDGE_LIMITS } from "../../src/lib/contracts/measurement";
import {
  renderHandScene,
  type HandScene,
  type HandSceneOptions,
} from "./helpers/f19-hand-scenes";

/** A pale forearm (low saturation in bright light) over the bottom edge at a shallow angle, its shadow cast up the sheet. */
const ARM_OVER_BOTTOM: HandSceneOptions = {
  wristMm: { x: 80, y: 280 },
  handDeg: 30,
  armDeg: 85,
  skinRgb: [236, 218, 204],
  shadowMm: 20,
  shadowDarkest: 0.5,
  shadowOffsetMm: { x: 0, y: -20 },
};

/** The forearm lying across the whole sheet, the hand on its right part: the sheet's bright region is in two pieces. */
const ARM_ACROSS: HandSceneOptions = {
  wristMm: { x: 120, y: 150 },
  handDeg: 90,
};

function frameOf(scene: HandScene): ImageData {
  return {
    width: scene.width,
    height: scene.height,
    data: scene.data,
  } as unknown as ImageData;
}

function run(scene: HandScene, withHand: boolean) {
  const detection = detectPaperQuad(
    frameOf(scene),
    "a4",
    withHand ? { handLandmarksPx: scene.landmarksPx } : {},
  );
  const evaluation = evaluatePaperEdgeCalibration(detection, "a4", false);
  return {
    detection,
    evaluation,
    codes: evaluation.errors.map((e) => e.code),
    residualMm: evaluation.geometry?.edgeFitResidualMm ?? null,
    cornerErrorPx: cornerError(detection, scene),
  };
}

function cornerError(d: SheetQuadDetection, scene: HandScene): number | null {
  if (!d.corners) return null;
  return Math.max(
    ...d.corners.map((c, i) =>
      Math.hypot(c.x - scene.corners[i]!.x, c.y - scene.corners[i]!.y),
    ),
  );
}

describe("F19 — an arm over the bottom edge (模擬)", () => {
  const scene = renderHandScene(ARM_OVER_BOTTOM);

  it("without the hand: the arm's edge is fitted as the sheet's, and the sheet reads curled", () => {
    const r = run(scene, false);
    expect(r.codes).toContain("PAPER_CURLED");
    expect(r.residualMm!).toBeGreaterThan(
      PAPER_EDGE_LIMITS.maxEdgeFitResidualMm,
    );
    // The bottom side (index 2) is the worst, and its corners are off.
    expect(r.detection.worstSideIndex).toBe(2);
    expect(r.cornerErrorPx!).toBeGreaterThan(20);
  });

  it("with the hand: flat-sheet residual, the true corners, points left out", () => {
    const r = run(scene, true);
    expect(r.codes).toStrictEqual([]);
    expect(r.evaluation.ok).toBe(true);
    // Flat sheets read 0.42-0.74 mm on phones (實測); this clean simulated
    // sheet reads far less, and the bound only asks for flat-sheet level.
    expect(r.residualMm!).toBeLessThan(0.3);
    expect(r.cornerErrorPx!).toBeLessThan(1);
    expect(r.detection.edgeFit?.handMask).toBe(true);
    expect(r.detection.edgeFit?.excludedPoints).toBeGreaterThan(0);
    expect(r.detection.edgeFit?.piecesJoined).toBe(1);
  });

  it("with the hand: a genuinely curled side the hand does not cover still reads curled", () => {
    const curled = renderHandScene({
      ...ARM_OVER_BOTTOM,
      curl: { side: 1, amplitudeMm: 6 },
    });
    const r = run(curled, true);
    expect(r.codes).toContain("PAPER_CURLED");
    expect(r.residualMm!).toBeGreaterThan(
      PAPER_EDGE_LIMITS.maxEdgeFitResidualMm,
    );
    expect(r.detection.worstSideIndex).toBe(1);
  });

  // F19 review (2026-10-25, 模擬): a curl on a side the arm covers or
  // touches. The line is fitted without the covered points; the residual is
  // read from every point near that line, so the bow seen beside the arm
  // still counts.
  it("F19 review: the bottom side (the one the arm covers) curled 6 mm still reads curled with the hand", () => {
    const curled = renderHandScene({
      ...ARM_OVER_BOTTOM,
      curl: { side: 2, amplitudeMm: 6 },
    });
    const r = run(curled, true);
    expect(r.codes).toContain("PAPER_CURLED");
    expect(r.detection.worstSideIndex).toBe(2);
    expect(r.detection.edgeFit?.excludedPoints).toBeGreaterThan(0);
  });

  it("F19 review: the mask leaves the left side's evidence alone when the arm only touches its lower end (curled 4-8 mm: the same side residual, within 0.05 px, with and without the hand)", () => {
    for (const amplitudeMm of [4, 6, 8]) {
      const curled = renderHandScene({
        ...ARM_OVER_BOTTOM,
        curl: { side: 3, amplitudeMm },
      });
      const without = run(curled, false);
      const withHand = run(curled, true);
      expect(withHand.detection.edgeFit!.sideResidualsPx[3]).toBeCloseTo(
        without.detection.edgeFit!.sideResidualsPx[3]!,
        1,
      );
      // 8 mm is still caught with the hand.
      if (amplitudeMm === 8) expect(withHand.codes).toContain("PAPER_CURLED");
    }
  }, 60_000);

  // Known limits (模擬), kept as failing expectations so a fix shows up:
  // the arm hides the part of the side that bows most, so what is left in
  // sight is nearly straight. The same scene WITHOUT the hand's landmarks
  // reads curled only because the arm's own edge is fitted as the sheet's
  // (bottom side 4.3 px even with no curl), not because the bow is seen.
  it.fails(
    "known limit: the bottom side curled 4 mm next to the arm reads curled with the hand",
    () => {
      const r = run(
        renderHandScene({
          ...ARM_OVER_BOTTOM,
          curl: { side: 2, amplitudeMm: 4 },
        }),
        true,
      );
      expect(r.codes).toContain("PAPER_CURLED");
    },
  );
  it.fails(
    "known limit: the bottom side curled 8 mm next to the arm reads curled with the hand",
    () => {
      const r = run(
        renderHandScene({
          ...ARM_OVER_BOTTOM,
          curl: { side: 2, amplitudeMm: 8 },
        }),
        true,
      );
      expect(r.codes).toContain("PAPER_CURLED");
    },
  );
  it.fails(
    "known limit: the left side curled 4-6 mm, its lower end under the arm, reads curled with the hand",
    () => {
      for (const amplitudeMm of [4, 6]) {
        const r = run(
          renderHandScene({
            ...ARM_OVER_BOTTOM,
            curl: { side: 3, amplitudeMm },
          }),
          true,
        );
        expect(r.codes).toContain("PAPER_CURLED");
      }
    },
  );

  it("with the hand known but nowhere near the sheet's edges, a curled sheet still reads curled", () => {
    const curled = renderHandScene({
      wristMm: { x: 105, y: 230 },
      curl: { side: 3, amplitudeMm: 6 },
    });
    const without = run(curled, false);
    const withHand = run(curled, true);
    expect(without.codes).toContain("PAPER_CURLED");
    expect(withHand.codes).toContain("PAPER_CURLED");
  });
});

describe("F19 — the arm across the sheet (region split, 模擬)", () => {
  const scene = renderHandScene(ARM_ACROSS);

  it("without the hand: no sheet", () => {
    const r = run(scene, false);
    expect(r.detection.paperRegionFound).toBe(false);
    expect(r.codes).toStrictEqual(["PAPER_NOT_FOUND"]);
  });

  it("with the hand: the two pieces taken together give the whole sheet, corners within 1 px", () => {
    const r = run(scene, true);
    expect(r.detection.paperRegionFound).toBe(true);
    expect(r.detection.corners).not.toBeNull();
    expect(r.cornerErrorPx!).toBeLessThan(1);
    expect(r.detection.edgeFit?.piecesJoined).toBe(2);
    expect(r.codes).toStrictEqual([]);
  });

  // F19 review (2026-10-25, 模擬): with the arm at some heights the larger
  // piece alone is close to A4 turned sideways, so it is fitted on its own;
  // with the hand's points left out, the side along the arm has too few
  // points: a region, two corners, no failure stage. That case is looked at
  // again with the pieces joined too.
  it.each([90, 100, 110, 120, 130, 140, 150, 170, 190])(
    "F19 review: the arm across at y = %i mm: the whole sheet, corners within 1 px",
    (y) => {
      const r = run(
        renderHandScene({ wristMm: { x: 120, y }, handDeg: 90 }),
        true,
      );
      expect(r.detection.corners).not.toBeNull();
      expect(r.cornerErrorPx!).toBeLessThan(1);
      expect(r.detection.edgeFit?.piecesJoined).toBe(2);
      expect(r.codes).toStrictEqual([]);
    },
  );

  it("F19 review: the case that had stopped at two corners (y = 110): without the hand the larger piece is taken for the whole sheet", () => {
    const scene = renderHandScene({ wristMm: { x: 120, y: 110 }, handDeg: 90 });
    const without = run(scene, false);
    expect(without.cornerErrorPx!).toBeGreaterThan(100);
    expect(without.detection.edgeFit?.piecesJoined).toBe(1);
  });

  it("a lower, slanted arm: without the hand a wrong sheet (one piece), with it the whole sheet", () => {
    const low = renderHandScene({
      wristMm: { x: 110, y: 200 },
      handDeg: 90,
      armDeg: 80,
    });
    const without = run(low, false);
    const withHand = run(low, true);
    expect(without.cornerErrorPx ?? Infinity).toBeGreaterThan(100);
    expect(withHand.cornerErrorPx!).toBeLessThan(1);
    expect(withHand.codes).toStrictEqual([]);
  });
});

/** Paints a sheet-white strip `widthPx` wide, `gapPx` left of the sheet's left edge, over the background only (the arm stays on top). */
function withStrip(scene: HandScene, gapPx: number, widthPx = 22): HandScene {
  const data = new Uint8ClampedArray(scene.data);
  const x1 = Math.round(scene.corners[0].x) - gapPx;
  const x0 = Math.max(0, x1 - widthPx);
  for (let y = 0; y < scene.height; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * scene.width + x) * 4;
      const background =
        data[i]! < 130 && Math.abs(data[i]! - data[i + 2]!) < 10;
      if (background) data[i] = data[i + 1] = data[i + 2] = 236;
    }
  return { ...scene, data };
}

/** Keeps only two mismatched bright blocks of the sheet, one above the arm and one below: no sheet in the picture. */
function twoBlobs(scene: HandScene, armYmm: number): HandScene {
  const data = new Uint8ClampedArray(scene.data);
  const [tl, tr] = scene.corners;
  const sheetW = tr.x - tl.x;
  const armY = tl.y + armYmm * scene.pxPerMm;
  for (let y = 0; y < scene.height; y++)
    for (let x = 0; x < scene.width; x++) {
      const i = (y * scene.width + x) * 4;
      const paper = data[i]! > 150 && Math.abs(data[i]! - data[i + 2]!) < 12;
      if (!paper) continue;
      const inA = y < armY && x < tl.x + 0.45 * sheetW;
      const inB =
        y > armY && x > tl.x + 0.3 * sheetW && y < armY + 0.25 * scene.height;
      if (!inA && !inB) {
        data[i] = data[i + 1] = 95;
        data[i + 2] = 98;
      }
    }
  return { ...scene, data };
}

// F19 review (2026-10-25, 模擬): the pieces the arm touches are joined, so a
// bright region that is NOT the sheet and touches the arm (a white strip of
// desk or a sleeve beside the sheet) could be joined too. Before the fix the
// strip was taken in: corners 26-30 px (about 12-13 mm) off and every paper
// gate passed. With three or more pieces the smallest is now left out while
// the rest still give four corners.
describe("F19 review — joined pieces that are not all the sheet (模擬)", () => {
  it.each([
    [110, 90, 4],
    [110, 90, 8],
    [90, 100, 8],
    [190, 80, 4],
  ])(
    "arm across at y = %i mm (arm %i°), a white strip %i px left of the sheet: the strip is not joined, the corners within 1 px",
    (y, armDeg, gap) => {
      const scene = withStrip(
        renderHandScene({ wristMm: { x: 120, y }, handDeg: 90, armDeg }),
        gap,
      );
      const r = run(scene, true);
      expect(r.detection.corners).not.toBeNull();
      expect(r.cornerErrorPx!).toBeLessThan(1);
      expect(r.detection.edgeFit?.piecesJoined).toBe(2);
      expect(r.codes).toStrictEqual([]);
    },
    60_000,
  );

  it.each([110, 150, 190])(
    "no sheet, two mismatched bright blocks the arm touches (y = %i mm): no four corners",
    (y) => {
      const scene = twoBlobs(
        renderHandScene({ wristMm: { x: 120, y }, handDeg: 90 }),
        y,
      );
      const r = run(scene, true);
      expect(r.detection.corners).toBeNull();
      expect(r.evaluation.ok).toBe(false);
    },
    60_000,
  );
});

describe("F19 — what does not change", () => {
  const plain = renderHandScene({ wristMm: { x: 105, y: 250 }, noHand: true });

  it("without landmarks: an edge-fit record with no mask, no points left out, one piece", () => {
    const d = detectPaperQuad(frameOf(plain), "a4");
    expect(d.edgeFit).toBeDefined();
    expect(d.edgeFit!.handMask).toBe(false);
    expect(d.edgeFit!.excludedPoints).toBe(0);
    expect(d.edgeFit!.piecesJoined).toBe(1);
    expect(d.edgeFit!.sideEndsSeen).toStrictEqual([true, true, true, true]);
    // The worst side's residual is the largest of the four.
    const finite = d.edgeFit!.sideResidualsPx.filter(
      (v): v is number => v !== null,
    );
    expect(Math.max(...finite)).toBe(d.edgeFitResidualPx);
  });

  it("landmarks of a hand that is not in the picture leave the corners where they were and the coverage as it was", () => {
    const without = detectPaperQuad(frameOf(plain), "a4");
    const withHand = detectPaperQuad(frameOf(plain), "a4", {
      handLandmarksPx: plain.landmarksPx,
    });
    expect(withHand.sideCoverages).toStrictEqual(without.sideCoverages);
    for (let i = 0; i < 4; i++) {
      expect(
        Math.hypot(
          withHand.corners![i]!.x - without.corners![i]!.x,
          withHand.corners![i]!.y - without.corners![i]!.y,
        ),
      ).toBeLessThan(0.1);
    }
  });

  it("fewer than 21 landmarks: no mask, the same detection as without", () => {
    const scene = renderHandScene(ARM_OVER_BOTTOM);
    const without = detectPaperQuad(frameOf(scene), "a4");
    const partial = detectPaperQuad(frameOf(scene), "a4", {
      handLandmarksPx: scene.landmarksPx.slice(0, 20),
    });
    expect(partial).toStrictEqual(without);
  });

  it("a scene with no sheet, hand given, stays no sheet and never throws", () => {
    const W = 200;
    const H = 300;
    const data = new Uint8ClampedArray(W * H * 4).fill(90);
    const d = detectPaperQuad(
      { width: W, height: H, data } as unknown as ImageData,
      "a4",
      { handLandmarksPx: renderHandScene(ARM_ACROSS).landmarksPx },
    );
    expect(d.paperRegionFound).toBe(false);
    expect(d.edgeFit).toBeUndefined();
  });
});
