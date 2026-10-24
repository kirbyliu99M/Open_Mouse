/**
 * V3.2 F19 review (2026-10-25): the S2 golden set WITH the hand (brief: 有改變
 * 的場景逐一列出新舊結果與理由). Every scene is SIMULATED (模擬).
 *
 * Of the 91 golden scenes, three draw a hand (`independent hand normal /
 * coveringCorner / overTopEdge`); they get 21 landmarks placed on the
 * renderer's own hand model (`helpers/golden-hand-landmarks.ts`). The other
 * 88 have no hand: the synthetic `occluder` ones draw a skin-coloured
 * ellipse, not a hand, so no landmarks can be given, and with no landmarks
 * the detector is bit for bit what it was (`paper-detect-stage-golden`).
 *
 * The three, without -> with the hand (模擬, recorded 2026-10-25):
 * | scene          | corners moved | worst-side residual mm | min coverage | gates | points left out |
 * | normal         | 0.002 px      | 0.020 -> 0.020         | 0.750 same   | pass  | 80              |
 * | coveringCorner | 0.004 px      | 0.013 -> 0.013         | 0.500 same   | pass  | 268             |
 * | overTopEdge    | 0.014 px      | 0.383 -> 0.382         | 0.725 same   | pass  | 243             |
 * Why so little: these hands are drawn darker and warmer than the sheet and
 * cast no shadow, so their outline points were already off the side lines;
 * leaving them out changes the RANSAC fits by hundredths of a pixel. The
 * scenes where the mask matters (a pale arm, a shadow, a split sheet) are in
 * `paper-covered-edges-f19.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { detectPaperQuad } from "../../src/client/paper/detect";
import { evaluatePaperEdgeCalibration } from "../../src/client/paper/calibration";
import {
  renderIndependentScene,
  type IndependentScene,
} from "./helpers/independent-scene";
import { goldenHandLandmarks } from "./helpers/golden-hand-landmarks";
import { goldenFrames } from "./helpers/s2-golden-scenes";

/** The golden set's `BASE` (s2-golden-scenes.ts). */
const BASE: IndependentScene = {
  frameWidth: 750,
  frameHeight: 1000,
  paperWidthMm: 210,
  paperHeightMm: 297,
  background: "midGrey",
  seed: 7,
};

const HANDS = ["normal", "coveringCorner", "overTopEdge"] as const;

describe("F19 review — the golden scenes that draw a hand, run with the hand (模擬)", () => {
  const frames = goldenFrames();

  it("exactly three golden scenes draw a hand", () => {
    expect(
      frames.filter((f) => f.name.startsWith("independent hand")),
    ).toHaveLength(3);
  });

  it.each(HANDS)(
    "%s: the same frame as the golden one; with the hand the corners move under 0.05 px, coverage and gates as without",
    (hand) => {
      const scene: IndependentScene = { ...BASE, hand };
      const render = renderIndependentScene(scene);
      const golden = frames.find((f) => f.name === `independent hand ${hand}`)!;
      expect(Buffer.from(render.data).equals(Buffer.from(golden.data))).toBe(
        true,
      );
      const frame = {
        width: render.width,
        height: render.height,
        data: render.data,
      } as unknown as ImageData;
      const landmarks = goldenHandLandmarks(scene)!;
      const without = detectPaperQuad(frame, "a4");
      const withHand = detectPaperQuad(frame, "a4", {
        handLandmarksPx: landmarks,
      });
      const a = evaluatePaperEdgeCalibration(without, "a4", false);
      const b = evaluatePaperEdgeCalibration(withHand, "a4", false);
      expect(withHand.edgeFit?.handMask).toBe(true);
      expect(withHand.edgeFit!.excludedPoints).toBeGreaterThan(0);
      for (let i = 0; i < 4; i++)
        expect(
          Math.hypot(
            withHand.corners![i]!.x - without.corners![i]!.x,
            withHand.corners![i]!.y - without.corners![i]!.y,
          ),
        ).toBeLessThan(0.05);
      expect(withHand.sideCoverages).toStrictEqual(without.sideCoverages);
      expect(b.errors.map((e) => e.code)).toStrictEqual(
        a.errors.map((e) => e.code),
      );
      expect(b.geometry!.edgeFitResidualMm).toBeCloseTo(
        a.geometry!.edgeFitResidualMm,
        2,
      );
    },
    60_000,
  );
});
