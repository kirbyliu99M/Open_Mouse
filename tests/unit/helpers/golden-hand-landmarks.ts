/**
 * V3.2 F19 review (2026-10-25): 21 MediaPipe-ordered landmarks for the three
 * S2 golden scenes that draw a hand (`independent hand normal /
 * coveringCorner / overTopEdge`, `independent-scene.ts`), placed on the
 * renderer's own capsule model (palm, forearm, four fingers, thumb) in paper
 * mm and projected with the scene's camera at height 0. SIMULATED (模擬): a
 * test fixture so the golden set can be run WITH the hand, not a hand model.
 */
import type { Point2 } from "../../../src/client/geometry/homography";
import {
  independentSceneCamera,
  type IndependentScene,
} from "./independent-scene";

export function goldenHandLandmarks(scene: IndependentScene): Point2[] | null {
  if (!scene.hand || scene.hand === "none") return null;
  let originX = scene.paperWidthMm * 0.5;
  let originY = scene.paperHeightMm * 0.64;
  let fingerScale = 1;
  if (scene.hand === "coveringCorner") {
    originX = scene.paperWidthMm * 0.83;
    originY = scene.paperHeightMm * 0.84;
  }
  if (scene.hand === "overTopEdge") {
    originY = scene.paperHeightMm * 0.37;
    fingerScale = 1.4;
  }
  const { project } = independentSceneCamera(scene);
  const at = (x: number, y: number) => project(x, y, 0);
  const mm: [number, number][] = [];
  // 0 wrist: where the palm meets the forearm.
  mm.push([originX, originY + 30]);
  // 1-4 thumb, along the renderer's thumb capsule.
  for (let k = 0; k < 4; k++) {
    const t = k / 3;
    mm.push([originX - 30 - 45 * t, originY + 20 - 45 * t]);
  }
  // 5-20 index (next to the thumb) to pinky: MCP at the finger's base, then
  // three joints out to the tip.
  const offsets = [-27, -9, 9, 27];
  const lengths = [70, 80, 75, 60].map((l) => l * fingerScale);
  for (let f = 0; f < 4; f++) {
    const bx = originX + offsets[f]!;
    const by = originY - 30;
    const tx = originX + offsets[f]! * 1.1;
    const ty = originY - 30 - lengths[f]!;
    for (let k = 0; k < 4; k++) {
      const t = k / 3;
      mm.push([bx + (tx - bx) * t, by + (ty - by) * t]);
    }
  }
  return mm.map(([x, y]) => at(x, y));
}
