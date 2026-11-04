/**
 * Scan Lab L7 (2026-11-02): the two no-sheet shape checks on their own —
 * a quad's rectangle shape from the focal length alone
 * (`planeCheck.ts#rectangleFromFocal`) and a card's rounded corners
 * (`cornerCheck.ts`).
 */
import { describe, expect, it } from "vitest";
import { cornerShapes } from "../../src/client/card/detect/cornerCheck";
import type { Quad } from "../../src/client/card/detect/detectCard";
import { rectangleFromFocal } from "../../src/client/card/detect/planeCheck";
import { orderQuadCorners } from "../../src/client/paper/quad-math";
import {
  applyMat,
  renderLabCardScene,
  sceneCamera,
  type LabCardScene,
  type Pt,
} from "./helpers/card-scene";

function view(tiltDeg: number, azimuthDeg: number): LabCardScene {
  return {
    width: 1080,
    height: 1920,
    fPx: 1000,
    tiltDeg,
    azimuthDeg,
    yawDeg: 13,
    heightMm: 400,
    aimMm: { x: 105, y: 150 },
  };
}

function project(scene: LabCardScene, pts: readonly Pt[]): Quad {
  const cam = sceneCamera(scene);
  return orderQuadCorners(
    pts.map((p) => applyMat(cam.tableToImage, p)) as unknown as Quad,
  );
}

describe("L7: rectangleFromFocal", () => {
  it("reads an A4 sheet and an ID-1 card at their true ratios, square, at any tilt", () => {
    for (const tilt of [0, 15, 35]) {
      for (const az of [0, 70, 200]) {
        const s = view(tilt, az);
        const a4 = rectangleFromFocal(
          project(s, [
            { x: 0, y: 0 },
            { x: 210, y: 0 },
            { x: 210, y: 297 },
            { x: 0, y: 297 },
          ]),
          1000,
          540,
          960,
        );
        const card = rectangleFromFocal(
          project(s, [
            { x: 50, y: 50 },
            { x: 135.6, y: 50 },
            { x: 135.6, y: 103.98 },
            { x: 50, y: 103.98 },
          ]),
          1000,
          540,
          960,
        );
        expect(a4?.aspect).toBeCloseTo(297 / 210, 6);
        expect(a4?.angleErrorDeg).toBeLessThan(1e-6);
        expect(card?.aspect).toBeCloseTo(85.6 / 53.98, 6);
        expect(card?.angleErrorDeg).toBeLessThan(1e-6);
      }
    }
  });

  it("a 6 % wrong focal moves a card's ratio by under 3 % at 35 deg of tilt", () => {
    const card = rectangleFromFocal(
      project(view(35, 200), [
        { x: 50, y: 50 },
        { x: 135.6, y: 50 },
        { x: 135.6, y: 103.98 },
        { x: 50, y: 103.98 },
      ]),
      1060,
      540,
      960,
    );
    expect(Math.abs((card?.aspect ?? 0) / (85.6 / 53.98) - 1)).toBeLessThan(
      0.03,
    );
  });
});

describe("L7: cornerShapes", () => {
  const scene = (radiusMm: number): LabCardScene => ({
    width: 900,
    height: 1200,
    fPx: 1000,
    tiltDeg: 5,
    azimuthDeg: 70,
    heightMm: 300,
    aimMm: { x: 100, y: 60 },
    paperOriginMm: null,
    cardCentreMm: { x: 100, y: 60 },
    cardRgb: [61, 95, 159],
    cardRadiusMm: radiusMm,
    background: "grey",
    blurSigmaPx: 0.8,
    noiseSigma: 2,
  });

  it("an ID-1 card's corners read rounded", () => {
    const r = renderLabCardScene(scene(3.18));
    const q = orderQuadCorners(r.cardCornersPx as unknown as Quad);
    expect(cornerShapes(r, q)).toEqual([
      "rounded",
      "rounded",
      "rounded",
      "rounded",
    ]);
  });

  it("the same rectangle with square corners reads sharp", () => {
    const r = renderLabCardScene(scene(0));
    const q = orderQuadCorners(r.cardCornersPx as unknown as Quad);
    expect(cornerShapes(r, q)).toEqual(["sharp", "sharp", "sharp", "sharp"]);
  });
});
