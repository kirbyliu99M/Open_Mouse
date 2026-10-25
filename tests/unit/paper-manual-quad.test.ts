/**
 * V3.2 F2 (candidate): the pure geometry of a paper frame placed by hand
 * (src/client/paper/manualQuad.ts) and its calibration
 * (`evaluateManualPaperCalibration`). Every scene here is SIMULATED (模擬).
 */
import { describe, expect, it } from "vitest";
import {
  paperShortSidePx,
  MANUAL_QUAD_LIMITS,
  centredPaperFrame,
  checkManualQuad,
  cornerDistancesPx,
  defaultAdjustFrame,
  neighbourCorners,
  orientManualQuad,
  shiftQuad,
  solveHiddenCorner,
  type Quad4,
} from "../../src/client/paper/manualQuad";
import {
  evaluateManualPaperCalibration,
  evaluatePaperEdgeCalibration,
} from "../../src/client/paper/calibration";
import { buildPaperHomography } from "../../src/client/paper/homography";
import { applyHomography } from "../../src/client/geometry/homography";
import { assumedFocalPxFromFov } from "../../src/client/paper/orientation";
import { paperEdgeEvidenceSchema } from "../../src/lib/contracts/measurement";
import {
  R5_E1_HAND_LENGTH_RMS_MM,
  R5_H,
  R5_W,
  buildR5Scene,
  gauss,
  mulberry,
} from "./helpers/r5-corner-scene";

const IMAGE = { width: R5_W, height: R5_H };
const RECT: Quad4 = [
  { x: 200, y: 300 },
  { x: 800, y: 300 },
  { x: 800, y: 1150 },
  { x: 200, y: 1150 },
];

const near = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

describe("centredPaperFrame", () => {
  it("is a portrait A4 72 % of the photo's width, centred", () => {
    const q = centredPaperFrame(IMAGE, "a4");
    const w = q[1].x - q[0].x;
    const h = q[3].y - q[0].y;
    expect(w / IMAGE.width).toBeCloseTo(0.72, 6);
    expect(h / w).toBeCloseTo(297 / 210, 6);
    expect((q[0].x + q[1].x) / 2).toBeCloseTo(IMAGE.width / 2, 6);
    expect((q[0].y + q[3].y) / 2).toBeCloseTo(IMAGE.height / 2, 6);
  });

  it("shrinks to 90 % of the height in a photo too short for that width", () => {
    const wide = { width: 1920, height: 1080 };
    const q = centredPaperFrame(wide, "letter");
    const h = q[3].y - q[0].y;
    expect(h / wide.height).toBeCloseTo(0.9, 6);
    expect(h / (q[1].x - q[0].x)).toBeCloseTo(279.4 / 215.9, 6);
  });

  it("refuses a photo with no size", () => {
    expect(() => centredPaperFrame({ width: 0, height: 10 }, "a4")).toThrow(
      RangeError,
    );
  });
});

describe("defaultAdjustFrame", () => {
  it("starts from the detector's four corners when there are four", () => {
    const f = defaultAdjustFrame({
      corners: RECT,
      image: IMAGE,
      paperSize: "a4",
    });
    expect(f.from).toBe("detected");
    expect(f.detected).toEqual([true, true, true, true]);
    expect(f.corners).toEqual(RECT);
    expect(f.corners).not.toBe(RECT);
  });

  it("starts a missing fourth corner inside the sheet, never on the parallelogram's corner", () => {
    const f = defaultAdjustFrame({
      corners: null,
      partialCorners: [RECT[0], RECT[1], null, RECT[3]],
      image: IMAGE,
      paperSize: "a4",
    });
    expect(f.from).toBe("partial");
    expect(f.detected).toEqual([true, true, false, true]);
    // The parallelogram's corner here is RECT[2] (RECT is a rectangle): the
    // start is pulled guessInsetFraction of the diagonal back toward RECT[0].
    expect(MANUAL_QUAD_LIMITS.guessInsetFraction).toBe(0.25);
    const t = 1 - MANUAL_QUAD_LIMITS.guessInsetFraction;
    expect(
      near(f.corners[2], {
        x: RECT[0].x + (RECT[2].x - RECT[0].x) * t,
        y: RECT[0].y + (RECT[2].y - RECT[0].y) * t,
      }),
    ).toBeLessThan(1e-9);
    expect(near(f.corners[2], RECT[2])).toBeGreaterThan(
      0.2 * near(RECT[0], RECT[2]),
    );
    expect(checkManualQuad(f.corners, IMAGE)).toEqual({ ok: true });
  });

  it("falls back to the centred sheet with two corners or fewer, or a start that would fail the checks", () => {
    for (const partialCorners of [
      [RECT[0], null, null, RECT[3]],
      [null, null, null, null],
      null,
    ]) {
      const f = defaultAdjustFrame({
        partialCorners,
        image: IMAGE,
        paperSize: "a4",
      });
      expect(f.from).toBe("centred");
      expect(f.detected).toEqual([false, false, false, false]);
    }
    const crossed: Quad4 = [RECT[0], RECT[2], RECT[1], RECT[3]];
    expect(
      defaultAdjustFrame({ corners: crossed, image: IMAGE, paperSize: "a4" })
        .from,
    ).toBe("centred");
  });
});

describe("checkManualQuad: obvious mistakes only", () => {
  it("passes a plain sheet, either way round", () => {
    expect(checkManualQuad(RECT, IMAGE)).toEqual({ ok: true });
    expect(
      checkManualQuad([RECT[0], RECT[3], RECT[2], RECT[1]], IMAGE),
    ).toEqual({ ok: true });
  });

  it("refuses a crossed (bow-tie) frame", () => {
    expect(
      checkManualQuad([RECT[0], RECT[2], RECT[1], RECT[3]], IMAGE),
    ).toEqual({ ok: false, problem: "self_intersecting" });
  });

  it("refuses a concave frame", () => {
    const dented: Quad4 = [RECT[0], RECT[1], { x: 350, y: 450 }, RECT[3]];
    expect(checkManualQuad(dented, IMAGE)).toEqual({
      ok: false,
      problem: "not_convex",
    });
  });

  it("refuses two corners on one point (dragged together onto the photo's corner)", () => {
    // The review's case: TR and BR both clamped onto (W, 0). Before the
    // degenerate check this passed and the homography threw.
    const doubled: Quad4 = [
      { x: 150, y: 300 },
      { x: IMAGE.width, y: 0 },
      { x: IMAGE.width, y: 0 },
      { x: 150, y: 1500 },
    ];
    expect(checkManualQuad(doubled, IMAGE)).toEqual({
      ok: false,
      problem: "degenerate",
    });
    // Nearly on one point: still one corner.
    const spacing =
      Math.hypot(IMAGE.width, IMAGE.height) *
      MANUAL_QUAD_LIMITS.minCornerSpacingFraction;
    const close: Quad4 = [
      { x: 150, y: 300 },
      { x: 900, y: 200 },
      { x: 900, y: 200 + spacing * 0.9 },
      { x: 150, y: 1500 },
    ];
    expect(checkManualQuad(close, IMAGE)).toEqual({
      ok: false,
      problem: "degenerate",
    });
    expect(MANUAL_QUAD_LIMITS.minCornerSpacingFraction).toBe(0.02);
  });

  it("refuses three corners in a line, and passes a strongly tilted sheet", () => {
    const inLine: Quad4 = [
      { x: 100, y: 100 },
      { x: IMAGE.width, y: 100 },
      { x: IMAGE.width, y: 1000 },
      { x: IMAGE.width, y: 1800 },
    ];
    expect(checkManualQuad(inLine, IMAGE)).toEqual({
      ok: false,
      problem: "degenerate",
    });
    // A corner whose two edges meet at just under minCornerAngleDeg of a
    // straight line, and one just over it.
    const bend = (deg: number): Quad4 => {
      const r = (deg * Math.PI) / 180;
      // TR -> BR runs straight down; BR -> BL turns back by (180 - deg).
      const br = { x: 900, y: 1000 };
      const len = 800;
      return [
        { x: 100, y: 200 },
        { x: 900, y: 200 },
        br,
        { x: br.x - len * Math.sin(r), y: br.y + len * Math.cos(r) },
      ];
    };
    expect(MANUAL_QUAD_LIMITS.minCornerAngleDeg).toBe(10);
    expect(checkManualQuad(bend(9), IMAGE)).toEqual({
      ok: false,
      problem: "degenerate",
    });
    expect(checkManualQuad(bend(11), IMAGE)).toEqual({ ok: true });
    // A trapezoid such as a sheet seen at a steep tilt (simulated) is fine.
    const tilted: Quad4 = [
      { x: 300, y: 300 },
      { x: 724, y: 300 },
      { x: 950, y: 1600 },
      { x: 74, y: 1600 },
    ];
    expect(checkManualQuad(tilted, IMAGE)).toEqual({ ok: true });
  });

  it("refuses a corner well off the photo, and lets one just beyond it pass", () => {
    const margin = IMAGE.width * MANUAL_QUAD_LIMITS.maxOutsideFraction;
    const justOut: Quad4 = [
      { x: -margin + 1, y: 300 },
      RECT[1],
      RECT[2],
      RECT[3],
    ];
    expect(checkManualQuad(justOut, IMAGE).ok).toBe(true);
    const farOut: Quad4 = [
      { x: -margin - 1, y: 300 },
      RECT[1],
      RECT[2],
      RECT[3],
    ];
    expect(checkManualQuad(farOut, IMAGE)).toEqual({
      ok: false,
      problem: "outside_image",
    });
  });

  it("V3.2 F17 (floor 1.2 px/mm since 2026-10-24): refuses a frame whose short side is under 1.2 px per mm of the paper's (252 px for A4, 259.08 px for Letter), not by area", () => {
    expect(MANUAL_QUAD_LIMITS.minPxPerMm).toBe(1.2);
    const sheet = (short: number, long = short * Math.SQRT2): Quad4 => [
      { x: 100, y: 100 },
      { x: 100 + short, y: 100 },
      { x: 100 + short, y: 100 + long },
      { x: 100, y: 100 + long },
    ];
    const image = { width: 1024, height: 1920 };
    expect(checkManualQuad(sheet(251.9), image)).toEqual({
      ok: false,
      problem: "too_small",
    });
    expect(checkManualQuad(sheet(252), image).ok).toBe(true);
    expect(checkManualQuad(sheet(255), image, "letter")).toEqual({
      ok: false,
      problem: "too_small",
    });
    expect(checkManualQuad(sheet(259.5), image, "letter").ok).toBe(true);
    // Kirby's preview-7 photo (scenario): a sheet 0.4 of a 1024 px wide
    // frame, about 410 px, 11 % of the frame, passes.
    expect(checkManualQuad(sheet(0.4 * 1024), image).ok).toBe(true);
    // A sheet turned landscape: its short side is the vertical one.
    expect(checkManualQuad(sheet(320, 230), image)).toEqual({
      ok: false,
      problem: "too_small",
    });
    // Area no longer decides: 6 % of a 3000 x 4000 photo, 600 px short side.
    const big = { width: 3000, height: 4000 };
    expect(checkManualQuad(sheet(600), big).ok).toBe(true);
  });

  it("paperShortSidePx: the shorter of the two opposite-edge averages", () => {
    const trapezoid: Quad4 = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 380, y: 600 },
      { x: 20, y: 600 },
    ];
    // top 400, bottom 360: 380; sides about 600.3 each.
    expect(paperShortSidePx(trapezoid)).toBeCloseTo(380, 9);
  });

  it("refuses points that are not numbers", () => {
    expect(
      checkManualQuad([{ x: NaN, y: 0 }, RECT[1], RECT[2], RECT[3]], IMAGE),
    ).toEqual({ ok: false, problem: "not_finite" });
  });

  it("has no aspect-ratio gate: a sheet far from A4's shape still passes (R5 E3)", () => {
    const squat: Quad4 = [
      { x: 100, y: 600 },
      { x: 924, y: 600 },
      { x: 924, y: 1100 },
      { x: 100, y: 1100 },
    ];
    expect(checkManualQuad(squat, IMAGE).ok).toBe(true);
    expect(Object.keys(MANUAL_QUAD_LIMITS).join(" ")).not.toMatch(/aspect/i);
  });
});

describe("solveHiddenCorner: edge extension", () => {
  // A tilted scene (simulated): the true corner the hand hides, and points on
  // its two edges that are still visible.
  const scene = buildR5Scene({ pitchDeg: 8 });
  const c = scene.corners;
  const lerp = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    t: number,
  ) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });

  it("puts a hidden corner where its two edges meet, under perspective, for each corner", () => {
    for (const hidden of [0, 1, 2, 3] as const) {
      const [prev, next] = neighbourCorners(hidden);
      const r = solveHiddenCorner({
        edgeA: { from: c[prev], points: [lerp(c[prev], c[hidden], 0.5)] },
        edgeB: { from: c[next], points: [lerp(c[next], c[hidden], 0.5)] },
        image: IMAGE,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(near(r.corner, c[hidden])).toBeLessThan(0.05);
      expect(r.visibleFraction).toBeCloseTo(0.5, 6);
    }
  });

  it("uses several marked points on one edge", () => {
    const r = solveHiddenCorner({
      edgeA: {
        from: c[3],
        points: [lerp(c[3], c[2], 0.3), lerp(c[3], c[2], 0.6)],
      },
      edgeB: { from: c[1], points: [lerp(c[1], c[2], 0.55)] },
      image: IMAGE,
    });
    expect(r.ok && near(r.corner, c[2])).toBeLessThan(0.05);
  });

  it("refuses two edges that are (near) parallel", () => {
    // Both "edges" run left to right: they never meet at a trustworthy point.
    const r = solveHiddenCorner({
      edgeA: { from: { x: 100, y: 500 }, points: [{ x: 500, y: 500 }] },
      edgeB: { from: { x: 100, y: 700 }, points: [{ x: 500, y: 690 }] },
      image: IMAGE,
    });
    expect(r).toEqual({ ok: false, problem: "parallel" });
    const exact = solveHiddenCorner({
      edgeA: { from: { x: 100, y: 500 }, points: [{ x: 500, y: 500 }] },
      edgeB: { from: { x: 100, y: 700 }, points: [{ x: 500, y: 700 }] },
      image: IMAGE,
    });
    expect(exact).toEqual({ ok: false, problem: "parallel" });
  });

  it("refuses edges meeting under minEdgeAngleDeg, and accepts them just over it", () => {
    // Corner (800, 500); edge A along +x, edge B coming in at `deg` to it.
    // Both edges are 700 px to the corner with a point marked 60 % along, so
    // only the angle differs (simulated).
    const corner = { x: 800, y: 500 };
    const at = (deg: number) => {
      const r = (deg * Math.PI) / 180;
      const fromB = {
        x: corner.x - 700 * Math.cos(r),
        y: corner.y - 700 * Math.sin(r),
      };
      return solveHiddenCorner({
        edgeA: { from: { x: 100, y: 500 }, points: [{ x: 520, y: 500 }] },
        edgeB: { from: fromB, points: [lerp(fromB, corner, 0.6)] },
        image: IMAGE,
      });
    };
    expect(MANUAL_QUAD_LIMITS.minEdgeAngleDeg).toBe(20);
    expect(at(19)).toEqual({ ok: false, problem: "parallel" });
    const ok = at(21);
    expect(ok.ok).toBe(true);
    expect(ok.ok && near(ok.corner, corner)).toBeLessThan(1e-6);
    expect(ok.ok && ok.angleDeg).toBeCloseTo(21, 6);
  });

  it("refuses edges that meet far outside the photo", () => {
    const r = solveHiddenCorner({
      edgeA: { from: { x: 200, y: 300 }, points: [{ x: 600, y: 300 }] },
      edgeB: { from: { x: 900, y: 1500 }, points: [{ x: 1000, y: 1100 }] },
      image: IMAGE,
    });
    expect(r).toEqual({ ok: false, problem: "outside_image" });
  });

  it("refuses an edge that is mostly hidden (R5 E2c: past 70 %)", () => {
    const ok = solveHiddenCorner({
      edgeA: { from: c[3], points: [lerp(c[3], c[2], 0.31)] },
      edgeB: { from: c[1], points: [lerp(c[1], c[2], 0.5)] },
      image: IMAGE,
    });
    expect(ok.ok).toBe(true);
    const r = solveHiddenCorner({
      edgeA: { from: c[3], points: [lerp(c[3], c[2], 0.1)] },
      edgeB: { from: c[1], points: [lerp(c[1], c[2], 0.5)] },
      image: IMAGE,
    });
    expect(r).toEqual({ ok: false, problem: "too_hidden" });
    expect(MANUAL_QUAD_LIMITS.minVisibleEdgeFraction).toBe(0.3);
  });

  it("refuses a marked point past the corner, and an edge with no usable point", () => {
    const past = solveHiddenCorner({
      edgeA: { from: c[3], points: [lerp(c[3], c[2], 1.2)] },
      edgeB: { from: c[1], points: [lerp(c[1], c[2], 0.5)] },
      image: IMAGE,
    });
    expect(past).toEqual({ ok: false, problem: "wrong_side" });
    const none = solveHiddenCorner({
      edgeA: { from: c[3], points: [] },
      edgeB: { from: c[1], points: [lerp(c[1], c[2], 0.5)] },
      image: IMAGE,
    });
    expect(none).toEqual({ ok: false, problem: "need_points" });
    const onTheCorner = solveHiddenCorner({
      edgeA: { from: c[3], points: [{ x: c[3].x + 2, y: c[3].y }] },
      edgeB: { from: c[1], points: [lerp(c[1], c[2], 0.5)] },
      image: IMAGE,
    });
    expect(onTheCorner).toEqual({ ok: false, problem: "need_points" });
  });
});

describe("orientManualQuad: the detector's labelling", () => {
  const f = assumedFocalPxFromFov(IMAGE.width);
  it("leaves a portrait frame as TL, TR, BR, BL", () => {
    expect(orientManualQuad(RECT, "a4", IMAGE, f)).toEqual(RECT);
  });

  it("puts any start and either winding into that order", () => {
    const shuffled: Quad4 = [RECT[2], RECT[1], RECT[0], RECT[3]];
    expect(orientManualQuad(shuffled, "a4", IMAGE, f)).toEqual(RECT);
  });

  it("makes TL->TR the short side of a landscape sheet", () => {
    const landscape: Quad4 = [
      { x: 100, y: 500 },
      { x: 950, y: 500 },
      { x: 950, y: 1100 },
      { x: 100, y: 1100 },
    ];
    const q = orientManualQuad(landscape, "a4", IMAGE, f);
    const top = near(q[0], q[1]);
    const side = near(q[1], q[2]);
    expect(top).toBeLessThan(side);
  });
});

describe("evaluateManualPaperCalibration", () => {
  const scene = buildR5Scene({});
  it("uses the same homography as the detector's corners, and an exact frame measures the hand exactly", () => {
    const manual = evaluateManualPaperCalibration({
      corners: scene.corners,
      cornersSource: "adjusted",
      paperSize: "a4",
      image: IMAGE,
      parallaxCorrected: false,
    });
    expect(manual.ok).toBe(true);
    expect(manual.geometry!.homography).toEqual(
      buildPaperHomography(scene.corners, "a4"),
    );
    const auto = evaluatePaperEdgeCalibration(
      {
        corners: scene.corners,
        cornersSeen: 4,
        cornersFound: [true, true, true, true],
        partialCorners: scene.corners,
        minSideCoverage: 1,
        edgeFitResidualPx: 0.2,
        worstSideIndex: 0,
        paperRegionFound: true,
      },
      "a4",
      false,
    );
    expect(manual.geometry!.homography).toEqual(auto.geometry!.homography);
    const mm = scene.flatPx.map((p) =>
      applyHomography(manual.geometry!.homography, p),
    );
    expect(near(mm[0], mm[12])).toBeCloseTo(190, 6);
  });

  it("carries cornersSource and no edge numbers, valid under the contract", () => {
    for (const cornersSource of ["adjusted", "manual"] as const) {
      const { calibration } = evaluateManualPaperCalibration({
        corners: scene.corners,
        cornersSource,
        paperSize: "a4",
        image: IMAGE,
        parallaxCorrected: true,
      });
      expect(calibration).toEqual({
        method: "paper-edge",
        paperSize: "a4",
        cornersSource,
        parallaxCorrected: true,
      });
      expect(paperEdgeEvidenceSchema.safeParse(calibration).success).toBe(true);
    }
  });

  it("refuses a frame that fails the checks, as a hidden corner (which offers the adjustment again)", () => {
    const r = evaluateManualPaperCalibration({
      corners: [
        scene.corners[0],
        scene.corners[2],
        scene.corners[1],
        scene.corners[3],
      ],
      cornersSource: "manual",
      paperSize: "a4",
      image: IMAGE,
      parallaxCorrected: false,
    });
    expect(r.ok).toBe(false);
    expect(r.geometry).toBeNull();
    expect(r.calibration).toBeNull();
    expect(r.errors.map((e) => e.code)).toEqual(["PAPER_CORNER_HIDDEN"]);
  });

  it("turns a doubled or in-line frame back as a hidden corner instead of throwing in the homography", () => {
    // The two frames the review ran through the pipeline's own steps
    // (orientManualQuad, then this): both used to throw.
    const focal = assumedFocalPxFromFov(IMAGE.width);
    const frames: Quad4[] = [
      [
        { x: 150, y: 300 },
        { x: IMAGE.width, y: 0 },
        { x: IMAGE.width, y: 0 },
        { x: 150, y: 1500 },
      ],
      [
        { x: 100, y: 100 },
        { x: IMAGE.width, y: 100 },
        { x: IMAGE.width, y: 1000 },
        { x: IMAGE.width, y: 1800 },
      ],
    ];
    for (const frame of frames) {
      const r = evaluateManualPaperCalibration({
        corners: orientManualQuad(frame, "a4", IMAGE, focal),
        cornersSource: "manual",
        paperSize: "a4",
        image: IMAGE,
        parallaxCorrected: false,
      });
      expect(r.ok).toBe(false);
      expect(r.geometry).toBeNull();
      expect(r.errors.map((e) => e.code)).toEqual(["PAPER_CORNER_HIDDEN"]);
    }
  });
});

describe("corner noise through the placed-frame path matches R5 (simulated)", () => {
  // R5 E1: four independent errors of sigma px per axis on each corner,
  // 4000 draws, the error being the noisy measurement minus the noise-free one.
  // Through the same path the pipeline takes for a placed frame: label the four
  // points (orientManualQuad), then evaluateManualPaperCalibration.
  const scene = buildR5Scene({});
  const focal = assumedFocalPxFromFov(IMAGE.width);
  const measure = (corners: Quad4) => {
    const labelled = orientManualQuad(corners, "a4", IMAGE, focal);
    const r = evaluateManualPaperCalibration({
      corners: labelled,
      cornersSource: "manual",
      paperSize: "a4",
      image: IMAGE,
      parallaxCorrected: false,
    });
    const h = r.geometry!.homography;
    const a = applyHomography(h, scene.flatPx[0]);
    const b = applyHomography(h, scene.flatPx[12]);
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const base = measure(scene.corners);

  it("the noise-free frame gives the 190 mm hand", () => {
    expect(base).toBeCloseTo(190, 6);
  });

  for (const sigma of [2, 4, 8]) {
    it(`sigma ${sigma} px: hand-length RMS within 10 % of R5's ${R5_E1_HAND_LENGTH_RMS_MM[sigma]} mm`, () => {
      const r = mulberry(1234 + Math.round(sigma * 10));
      let sum = 0;
      const n = 4000;
      for (let i = 0; i < n; i++) {
        const noisy = scene.corners.map((p) => ({
          x: p.x + sigma * gauss(r),
          y: p.y + sigma * gauss(r),
        })) as unknown as Quad4;
        const e = measure(noisy) - base;
        sum += e * e;
      }
      const rms = Math.sqrt(sum / n);
      const expected = R5_E1_HAND_LENGTH_RMS_MM[sigma];
      expect(Math.abs(rms - expected) / expected).toBeLessThanOrEqual(0.1);
    });
  }
});

describe("small helpers", () => {
  it("shiftQuad moves every corner, cornerDistancesPx measures each pair", () => {
    const moved = shiftQuad(RECT, 3, -4);
    expect(cornerDistancesPx(RECT, moved)).toEqual([5, 5, 5, 5]);
    expect(neighbourCorners(0)).toEqual([3, 1]);
    expect(neighbourCorners(2)).toEqual([1, 3]);
  });
});
