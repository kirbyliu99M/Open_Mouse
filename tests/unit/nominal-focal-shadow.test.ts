import { afterEach, describe, expect, it, vi } from "vitest";
import * as measurementsModule from "../../src/client/geometry/measurements";

// A pass-through of `correctLandmarksByHandLength` that a test can override, to
// reach the two failures a real scene does not produce (a correction that
// does not settle, one that throws).
const override = vi.hoisted(() => ({
  mode: "real" as "real" | "notConverged" | "throws",
}));
vi.mock("../../src/client/geometry/measurements", async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import("../../src/client/geometry/measurements")
    >();
  return {
    ...real,
    correctLandmarksByHandLength: (
      ...args: Parameters<typeof real.correctLandmarksByHandLength>
    ) => {
      if (override.mode === "throws") throw new Error("boom");
      const out = real.correctLandmarksByHandLength(...args);
      return override.mode === "notConverged"
        ? { ...out, converged: false }
        : out;
    },
  };
});

import {
  FULL_FRAME_DIAGONAL_MM,
  NOMINAL_FOCAL_EQUIV_MM,
  computeNominalFocalShadow,
  nominalFocalPx,
} from "../../src/client/geometry/nominalFocalShadow";
import { evaluatePaperEdgeCalibration } from "../../src/client/paper/calibration";
import { buildShadowScene } from "./helpers/shadow-scene";

const { computeCorrectedHandMeasurements, computeHandMeasurements } =
  measurementsModule;

const FRAME = { width: 1080, height: 1440 };

function homographyOf(scene: ReturnType<typeof buildShadowScene>) {
  const corners = scene.corners;
  const { geometry } = evaluatePaperEdgeCalibration(
    {
      corners,
      cornersSeen: 4,
      cornersFound: [true, true, true, true],
      partialCorners: corners,
      minSideCoverage: 1,
      edgeFitResidualPx: 0.2,
      worstSideIndex: 0,
      paperRegionFound: true,
    },
    "a4",
    false,
  );
  if (!geometry) throw new Error("scene has no geometry");
  return geometry.homography;
}

afterEach(() => {
  override.mode = "real";
});

describe("nominalFocalPx", () => {
  it("is the 26 mm equivalent over the 43.27 mm full-frame diagonal, on the photo's diagonal", () => {
    expect(NOMINAL_FOCAL_EQUIV_MM).toBe(26);
    expect(FULL_FRAME_DIAGONAL_MM).toBe(43.27);
    // The audit's budget rig: 1080 x 1440, diagonal 1800 px.
    expect(nominalFocalPx(FRAME)).toBeCloseTo((26 / 43.27) * 1800, 9);
    expect(nominalFocalPx(FRAME)).toBeCloseTo(1081.58, 1);
  });
  it("is not the detector's 70 degree assumption (771 px on a 1080 px wide frame)", () => {
    expect(nominalFocalPx(FRAME)).toBeGreaterThan(1000);
  });
  it.each([
    [0, 100],
    [100, 0],
    [-1, 100],
    [Number.NaN, 100],
    [100, Infinity],
  ])("%s x %s -> null", (width, height) => {
    expect(nominalFocalPx({ width, height })).toBeNull();
  });
});

describe("computeNominalFocalShadow", () => {
  // The camera's true focal length is the prior's, so the shadow is the
  // correction done with the right lens.
  const f = nominalFocalPx(FRAME)!;
  const scene = buildShadowScene({
    width: FRAME.width,
    height: FRAME.height,
    fPx: f,
    tiltDeg: 8,
    cameraHeightMm: 420,
    offsetMm: { x: 10, y: -20 },
  });
  const homography = homographyOf(scene);
  const flat = computeHandMeasurements(
    scene.landmarksPx,
    homography,
  ).handLengthMm;

  it("works out the hand length with the prior and its difference from the reported one", () => {
    const shadow = computeNominalFocalShadow({
      landmarksPx: scene.landmarksPx,
      homography,
      focalFrame: FRAME,
      principalFrame: FRAME,
      reportedHandLengthMm: flat,
    });
    expect(shadow).not.toBeNull();
    // An independent route to the same number: the product's own corrected
    // measurement with the prior as an EXIF focal length.
    const viaExif = computeCorrectedHandMeasurements(
      scene.landmarksPx,
      homography,
      { exifFocalPx: f, widthPx: FRAME.width, heightPx: FRAME.height },
    ).measurements.handLengthMm;
    expect(shadow!.shadowHandLengthMm).toBeCloseTo(viaExif, 2);
    expect(shadow!.handLengthDeltaMm).toBeCloseTo(viaExif - flat, 2);
    // The hand stands above the sheet, so the flat reading is long and the
    // corrected one is shorter, close to the truth.
    expect(flat).toBeGreaterThan(scene.trueHandLengthMm + 2);
    expect(shadow!.handLengthDeltaMm).toBeLessThan(-2);
    expect(
      Math.abs(shadow!.shadowHandLengthMm - scene.trueHandLengthMm),
    ).toBeLessThan(0.6);
  });

  it("is a pure function: the same input twice gives the same answer and the input is untouched", () => {
    const input = {
      landmarksPx: scene.landmarksPx,
      homography,
      focalFrame: FRAME,
      principalFrame: FRAME,
      reportedHandLengthMm: flat,
    };
    const before = JSON.stringify(input);
    const a = computeNominalFocalShadow(input);
    const b = computeNominalFocalShadow(input);
    expect(a).toEqual(b);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("the focal frame sets the prior, the principal frame only the centre", () => {
    const base = {
      landmarksPx: scene.landmarksPx,
      homography,
      reportedHandLengthMm: flat,
    };
    const whole = computeNominalFocalShadow({
      ...base,
      focalFrame: FRAME,
      principalFrame: FRAME,
    });
    const cropped = computeNominalFocalShadow({
      ...base,
      focalFrame: FRAME,
      principalFrame: { width: 900, height: 1440 },
    });
    const wider = computeNominalFocalShadow({
      ...base,
      focalFrame: { width: 2160, height: 2880 },
      principalFrame: FRAME,
    });
    expect(whole).not.toBeNull();
    expect(cropped).not.toBeNull();
    expect(wider).not.toBeNull();
    expect(wider!.shadowHandLengthMm).not.toBeCloseTo(
      whole!.shadowHandLengthMm,
      1,
    );
  });

  describe("any failure is null, never a throw", () => {
    const ok = {
      landmarksPx: scene.landmarksPx,
      homography,
      focalFrame: FRAME,
      principalFrame: FRAME,
      reportedHandLengthMm: flat,
    };
    it("a size that is not a size", () => {
      expect(
        computeNominalFocalShadow({
          ...ok,
          focalFrame: { width: 0, height: 100 },
        }),
      ).toBeNull();
      expect(
        computeNominalFocalShadow({
          ...ok,
          focalFrame: { width: Number.NaN, height: 100 },
        }),
      ).toBeNull();
    });
    it("a reported length that is not a number", () => {
      expect(
        computeNominalFocalShadow({ ...ok, reportedHandLengthMm: Number.NaN }),
      ).toBeNull();
      expect(
        computeNominalFocalShadow({ ...ok, reportedHandLengthMm: Infinity }),
      ).toBeNull();
    });
    it("the wrong number of landmarks", () => {
      expect(
        computeNominalFocalShadow({
          ...ok,
          landmarksPx: scene.landmarksPx.slice(0, 20),
        }),
      ).toBeNull();
    });
    it("landmarks that are not finite", () => {
      const bad = scene.landmarksPx.map((p, i) =>
        i === 12 ? { x: Number.NaN, y: p.y } : p,
      );
      expect(computeNominalFocalShadow({ ...ok, landmarksPx: bad })).toBeNull();
    });
    it("a homography that is not usable", () => {
      expect(
        computeNominalFocalShadow({
          ...ok,
          homography: [0, 0, 0, 0, 0, 0, 0, 0, 0] as never,
        }),
      ).toBeNull();
    });
    it("a correction that did not settle", () => {
      override.mode = "notConverged";
      expect(computeNominalFocalShadow(ok)).toBeNull();
    });
    it("a correction that throws", () => {
      override.mode = "throws";
      expect(() => computeNominalFocalShadow(ok)).not.toThrow();
      expect(computeNominalFocalShadow(ok)).toBeNull();
    });
  });

  it("costs well under a frame on a phone-sized scene (measured, not a gate)", () => {
    const input = {
      landmarksPx: scene.landmarksPx,
      homography,
      focalFrame: FRAME,
      principalFrame: FRAME,
      reportedHandLengthMm: flat,
    };
    for (let i = 0; i < 50; i++) computeNominalFocalShadow(input); // warm up
    const runs = 500;
    const started = performance.now();
    for (let i = 0; i < runs; i++) computeNominalFocalShadow(input);
    const perCallMs = (performance.now() - started) / runs;
    console.log(
      `shadow: ${perCallMs.toFixed(4)} ms per call (Node, ${runs} runs)`,
    );
    // A loose bound so a slow CI machine does not flake; the printed number is the evidence.
    expect(perCallMs).toBeLessThan(5);
  });
});
