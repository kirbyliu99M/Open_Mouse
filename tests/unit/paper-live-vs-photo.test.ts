/**
 * S1 (2026-10-19): the same synthetic scene seen by the live loop (about
 * 342x640) and by the photo analysis (about 1024x1920).
 *
 * SIMULATED, not a phone: a crude capsule hand, a pinhole camera, sensor
 * noise (tests/unit/helpers/live-photo-scene.ts, ported from the R1 research
 * harness). What it pins:
 * - each resolution's detection gives the same paper-gate verdict from the
 *   live function as from the photo's `evaluatePaperEdgeCalibration`;
 * - the two resolutions agree on pass / covered edge (and which side) /
 *   curled for these scenes;
 * - the residual, in mm, is NOT systematically higher at the live resolution
 *   (a flat sheet reads ~0.01 mm live), so the hard residual gate does not
 *   hold a flat sheet back. (The measured table is in the PR description.)
 */
import { describe, expect, it } from "vitest";
import { evaluatePaperEdgeCalibration } from "../../src/client/paper/calibration";
import { detectPaperQuad } from "../../src/client/paper/detect";
import { assumedFocalPxFromFov } from "../../src/client/paper/orientation";
import {
  evaluateLivePaperGate,
  type LivePaperGate,
} from "../../src/client/camera/paperGate";
import {
  distanceForWidthFraction,
  downscale,
  makeCam,
  render,
  type HandSpec,
  type Img,
} from "./helpers/live-photo-scene";

const PHOTO = { w: 1024, h: 1920 } as const;
const LIVE = { w: 342, h: 640 } as const;
const FOCAL_PX = 1280;
const STREAM_FOV_WIDTH = 1080;
const SKIN = [222, 170, 140] as const;
const BASE_HAND: HandSpec = { hx: 0, hy: 8, forearmWidth: 60, skin: SKIN };

interface Reading {
  readonly gate: LivePaperGate;
  readonly photoOk: boolean;
  readonly residualMm: number | null;
  readonly coverage: number;
}

function read(img: Img, focalPx: number): Reading {
  const det = detectPaperQuad(img as unknown as ImageData, "a4", {
    focalPxHint: focalPx,
  });
  const photo = evaluatePaperEdgeCalibration(det, "a4", false);
  return {
    gate: evaluateLivePaperGate(det, "a4"),
    photoOk: photo.ok,
    residualMm: photo.geometry?.edgeFitResidualMm ?? null,
    coverage: det.minSideCoverage,
  };
}

/** The scene at both resolutions: [live, photo]. */
function bothResolutions(options: {
  hand?: HandSpec | null;
  bowMm?: number;
}): [Reading, Reading] {
  const cam = makeCam({
    f: FOCAL_PX,
    w: PHOTO.w,
    h: PHOTO.h,
    d: distanceForWidthFraction(FOCAL_PX, STREAM_FOV_WIDTH, 0.72),
  });
  const full = render({
    cam,
    table: [60, 48, 40],
    hand: options.hand ?? null,
    bowMm: options.bowMm,
    noise: 1.5,
    seed: 7,
  });
  const small = downscale(full, LIVE.w, LIVE.h);
  const hint = assumedFocalPxFromFov(STREAM_FOV_WIDTH);
  return [read(small, hint * (LIVE.w / PHOTO.w)), read(full, hint)];
}

describe("the same scene at the live and the photo resolution (simulated)", () => {
  it("a flat sheet with the hand centred: both pass, and the live residual is not held high", () => {
    const [live, photo] = bothResolutions({ hand: BASE_HAND });
    expect(live.gate).toEqual({ kind: "pass" });
    expect(photo.gate).toEqual({ kind: "pass" });
    expect(live.photoOk).toBe(true);
    expect(photo.photoOk).toBe(true);
    // Far below the 1.5 mm gate at either resolution (measured ~0.02 / ~0.002).
    expect(live.residualMm).toBeLessThan(0.1);
    expect(photo.residualMm).toBeLessThan(0.1);
  }, 120_000);

  it("a hand covering the left side: both resolutions say a covered edge, and name the same side", () => {
    const [live, photo] = bothResolutions({
      hand: { ...BASE_HAND, hx: -45 },
    });
    expect(live.gate).toEqual({ kind: "edge-covered", side: "left" });
    expect(photo.gate).toEqual({ kind: "edge-covered", side: "left" });
    expect(live.photoOk).toBe(false);
    expect(photo.photoOk).toBe(false);
    // Coverage is the same fraction at both (measured 0.35 / 0.35).
    expect(Math.abs(live.coverage - photo.coverage)).toBeLessThan(0.05);
  }, 120_000);

  it("a sheet bowed 6 mm (a stand-in for a curl): both resolutions say not flat, at about the same millimetres", () => {
    const [live, photo] = bothResolutions({ bowMm: 6 });
    expect(live.gate).toEqual({ kind: "curled" });
    expect(photo.gate).toEqual({ kind: "curled" });
    expect(live.residualMm).toBeGreaterThan(1.5);
    expect(photo.residualMm).toBeGreaterThan(1.5);
    // Measured 2.05 mm live vs 2.04 mm photo: same physical number to
    // within the scatter near the clip of the detector's inlier band.
    expect(
      Math.abs((live.residualMm ?? 0) - (photo.residualMm ?? 0)),
    ).toBeLessThan(0.5);
  }, 120_000);
});
