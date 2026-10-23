/**
 * F17 review (D.2, candidate 未拍板): the contract's engine scale
 * (`FIT_SCALE_FROM_CORRECTED`) is the ratio uncorrected / corrected of a
 * frame of the video at the paper fill the contract names, and that ratio
 * depends on the focal length the frame is taken with (the camera distance
 * for a given fill). R7 worked it out at 1442 px (26 mm); F17 moved the video
 * frame's prior to 998 px (18 mm). This recomputes the ratios on R6's pinhole
 * scene (deterministic tilts, no noise) from the prior itself, so a change of
 * the prior fails here, and pins today's known gap: the contract still holds
 * R7's 1442 px values. Out-of-repo source of the same numbers (R7's method
 * and seeds): v32-program-2026-10-21/review/F17/c_scale_factors_f17.ts and
 * its .out.txt. Only Claude changes the contract; when it is rebased, the
 * "gap" test below is replaced by "within tolerance". All SIMULATED (模擬).
 */
import { describe, expect, it } from "vitest";
import { buildPaperHomography } from "../../src/client/paper/homography";
import {
  computeCorrectedHandMeasurements,
  computeHandMeasurements,
} from "../../src/client/geometry/measurements";
import { nominalFocalPxFromLongEdge } from "../../src/client/geometry/nominalFocalShadow";
import { FIT_SCALE_FROM_CORRECTED } from "../../src/lib/contracts/measurement";
import { buildR6Scene } from "./helpers/r6-scene";

const W = 1024;
const H = 1920;

/** Mean uncorrected / corrected (true f) over a fixed grid of tilts and wrist positions. */
function engineScaleAt(fPx: number, fill: number, handLenMm = 190) {
  let n = 0;
  let kL = 0;
  let kP = 0;
  let kW = 0;
  for (const tilt of [0, 2, 4, 6, 8])
    for (let a = 0; a < 8; a++)
      for (const wristV of [30, 60, 90]) {
        const az = (a * Math.PI) / 4;
        const s = buildR6Scene({
          w: W,
          h: H,
          f: fPx,
          fill,
          pitchDeg: tilt * Math.cos(az),
          rollDeg: tilt * Math.sin(az),
          handLenMm,
          widthScale: 0.8,
          wristV,
        });
        const homography = buildPaperHomography(s.corners, "a4");
        const u = computeHandMeasurements(s.raisedPx, homography);
        const c = computeCorrectedHandMeasurements(s.raisedPx, homography, {
          exifFocalPx: fPx,
          widthPx: W,
          heightPx: H,
        }).measurements;
        kL += u.handLengthMm / c.handLengthMm;
        kP += u.palmLengthMm / c.palmLengthMm;
        kW += u.palmWidthMm / c.palmWidthMm;
        n++;
      }
  return { kL: kL / n, kP: kP / n, kW: kW / n };
}

describe("F17 review: the engine scale and the video frame's focal prior (模擬)", () => {
  const fill = FIT_SCALE_FROM_CORRECTED.referenceFill;

  it("the method reproduces the contract at R7's basis, 1442 px (26 mm on 1920)", () => {
    const k = engineScaleAt(1442, fill);
    expect(k.kL).toBeCloseTo(FIT_SCALE_FROM_CORRECTED.handLength, 2);
    expect(k.kP).toBeCloseTo(FIT_SCALE_FROM_CORRECTED.palmLength, 2);
    expect(k.kW).toBeCloseTo(FIT_SCALE_FROM_CORRECTED.palmWidth, 2);
  });

  it("KNOWN GAP (未拍板, Claude decides the contract): at today's prior the ratios are about 1 % above the contract's; this fails when the prior or the contract changes", () => {
    const prior = nominalFocalPxFromLongEdge(H)!;
    expect(prior).toBeCloseTo(998.4, 0);
    const k = engineScaleAt(prior, fill);
    // R7's script at 998 px, fill 0.65, hand 190: 1.0348 / 1.0607 / 1.0509.
    expect(k.kL).toBeCloseTo(1.035, 2);
    expect(k.kP).toBeCloseTo(1.061, 2);
    expect(k.kW).toBeCloseTo(1.051, 2);
    expect(FIT_SCALE_FROM_CORRECTED.handLength).toBe(1.024);
    expect(FIT_SCALE_FROM_CORRECTED.palmLength).toBe(1.041);
    expect(FIT_SCALE_FROM_CORRECTED.palmWidth).toBe(1.035);
    expect(k.kL - FIT_SCALE_FROM_CORRECTED.handLength).toBeGreaterThan(0.005);
  });
});
