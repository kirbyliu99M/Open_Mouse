/**
 * R5's synthetic scene (research, 2026-10-21, `v3-scan-program-2026-10-19/
 * research/R5/lib.ts` and `../R1/common.ts`), ported here so a unit test can
 * check that the placed-frame path (V3.2 F2) passes corner errors on to the
 * hand length as R5 measured, and no worse. NOT a test file. Everything it
 * produces is SIMULATED (模擬): a pinhole camera, a synthetic flat hand, no
 * photo.
 *
 * World: X right, Y down (the paper's "v"), Z from the camera toward the table
 * (table at Z = 0); camera looks along +Z when R = I; image x right, y down,
 * principal point at the centre. Same as R1's `common.ts`, line for line.
 */
import type { Point2 } from "../../../src/client/geometry/homography";
import { syntheticHand } from "./synthetic-hand";

export const R5_W = 1024;
export const R5_H = 1920;
const A4 = { w: 210, h: 297 };

type M3 = number[];
const deg = (d: number) => (d * Math.PI) / 180;
function mul(a: M3, b: M3): M3 {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
}
const Rx = (a: number): M3 => [
  1,
  0,
  0,
  0,
  Math.cos(a),
  -Math.sin(a),
  0,
  Math.sin(a),
  Math.cos(a),
];
const Ry = (a: number): M3 => [
  Math.cos(a),
  0,
  Math.sin(a),
  0,
  1,
  0,
  -Math.sin(a),
  0,
  Math.cos(a),
];
function apply(m: M3, v: number[]): number[] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

interface Cam {
  f: number;
  w: number;
  h: number;
  R: M3;
  C: number[];
}

function makeCam(o: {
  f: number;
  w: number;
  h: number;
  d: number;
  pitchDeg: number;
}): Cam {
  const R = mul(Rx(deg(o.pitchDeg)), Ry(0));
  const ax = apply(R, [0, 0, 1]);
  return {
    f: o.f,
    w: o.w,
    h: o.h,
    R,
    C: [-o.d * ax[0], -o.d * ax[1], -o.d * ax[2]],
  };
}

function project(cam: Cam, X: number, Y: number, Z = 0): Point2 {
  const d = [X - cam.C[0], Y - cam.C[1], Z - cam.C[2]];
  const RT: M3 = [
    cam.R[0],
    cam.R[3],
    cam.R[6],
    cam.R[1],
    cam.R[4],
    cam.R[7],
    cam.R[2],
    cam.R[5],
    cam.R[8],
  ];
  const pc = apply(RT, d);
  return {
    x: cam.w / 2 + (cam.f * pc[0]) / pc[2],
    y: cam.h / 2 + (cam.f * pc[1]) / pc[2],
  };
}

/** R1's seeded generator, so the draws are R5's own. */
export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function gauss(r: () => number) {
  return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
}

export interface R5Scene {
  readonly f: number;
  /** The paper's corners TL, TR, BR, BL in image px, noise free. */
  readonly corners: readonly [Point2, Point2, Point2, Point2];
  /** The hand's 21 landmarks projected flat (Z = 0). */
  readonly flatPx: readonly Point2[];
}

/** R5's `buildScene`: f 1280 px, 1024x1920, A4 portrait at `widthFrac` of the width, a 190 mm hand. */
export function buildR5Scene(
  o: { pitchDeg?: number; widthFrac?: number } = {},
): R5Scene {
  const f = 1280;
  const frac = o.widthFrac ?? 0.72;
  const d = (f * A4.w) / (frac * R5_W);
  const cam = makeCam({ f, w: R5_W, h: R5_H, d, pitchDeg: o.pitchDeg ?? 0 });
  const raw = syntheticHand({ spread: false }, {});
  const k = 190 / Math.hypot(raw[0].x - raw[12].x, raw[0].y - raw[12].y);
  const handMm = raw.map((p) => ({ x: p.x * k, y: p.y * k + 60 }));
  const pts = [
    [-A4.w / 2, -A4.h / 2],
    [A4.w / 2, -A4.h / 2],
    [A4.w / 2, A4.h / 2],
    [-A4.w / 2, A4.h / 2],
  ];
  const corners = pts.map(([x, y]) => project(cam, x, y)) as unknown as [
    Point2,
    Point2,
    Point2,
    Point2,
  ];
  return { f, corners, flatPx: handMm.map((p) => project(cam, p.x, p.y, 0)) };
}

/** R5's E1 table (simulated, 4000 draws, pitch 0, paper at 72 % of the width): hand-length RMS in mm. */
export const R5_E1_HAND_LENGTH_RMS_MM: Readonly<Record<number, number>> = {
  2: 0.44,
  4: 0.87,
  8: 1.73,
};
