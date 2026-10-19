/**
 * A small 3D articulated hand seen by a pinhole camera, for the hand-flatness
 * tests (scan S3). NOT a test file; no photo, no MediaPipe.
 *
 * It is the finger-curl part of the R3 simulation (2026-10-19, the plan
 * folder's research/R3/lib.ts), ported so that "curl c = 0.5 / 1.0" in the
 * tests means what it meant there: the same flat hand (190 mm, palm 0.553 of
 * its length), the same joint flexion (50, 70 and 40 degrees per segment at
 * c = 1), the hand rested on the table afterwards, and a camera 350 mm
 * straight above it. With them the four-finger reach over the palm reads 0.713
 * flat, 0.564 at c = 0.5, 0.410 at c = 0.75 and 0.182 at c = 1.0 (R3's table).
 * Simulation only: how real hands and real MediaPipe landmarks behave is not
 * known from it.
 */
import { LANDMARK_HEIGHT_RATIOS } from "../../../src/client/geometry/parallax";
import type { Point2 } from "../../../src/client/geometry/homography";

type V3 = [number, number, number];
const DEG = Math.PI / 180;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: V3): V3 => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));

function rotVec(v: V3, k: V3, ang: number): V3 {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c)));
}
function rotPoint(p: V3, pivot: V3, k: V3, ang: number): V3 {
  return add(pivot, rotVec(sub(p, pivot), k, ang));
}

const L = 190; // flat wrist to middle tip, mm
const W_OVER_L = 0.344;
const PALM_FRAC = 0.553;
const FINGER_K = [0.95, 1, 0.95, 0.78];
const SEG = [40 / 81, 23 / 81, 18 / 81];
const FING_TOG = [-3, 0, 3, 7];
const MCP_X = [-28, 0, 26, 50];
const MCP_Y = [96, 100, 95, 84];
// Thumb, a little spread (thumbSpread 0.3 in R3).
const THUMB_SPR = [
  [-30, 22],
  [-55, 44],
  [-72, 62],
  [-84, 78],
];
const THUMB_TOG = [
  [-24, 20],
  [-40, 42],
  [-46, 62],
  [-48, 78],
];

/** The flat hand, 21 landmarks in mm (x toward the little finger, y toward the fingertips, z up from the table). */
function buildFlat(): V3[] {
  const u = (PALM_FRAC * L) / 100;
  const wL = W_OVER_L * L;
  const sx = Math.sqrt(Math.max(0, wL * wL - (12 * u) ** 2)) / 78;
  const M = L - 100 * u;
  const z = (i: number) => LANDMARK_HEIGHT_RATIOS[i] * L;
  const pts: V3[] = new Array(21);
  pts[0] = [0, 0, z(0)];
  for (let i = 0; i < 4; i++) {
    const t = 0.3;
    const x = THUMB_TOG[i][0] + (THUMB_SPR[i][0] - THUMB_TOG[i][0]) * t;
    const y = THUMB_TOG[i][1] + (THUMB_SPR[i][1] - THUMB_TOG[i][1]) * t;
    pts[1 + i] = [x * sx, y * u, z(1 + i)];
  }
  for (let f = 0; f < 4; f++) {
    const th = FING_TOG[f] * DEG;
    const dir: V3 = [Math.sin(th), Math.cos(th), 0];
    let at: V3 = [MCP_X[f] * sx, MCP_Y[f] * u, z(5 + 4 * f)];
    pts[5 + 4 * f] = at;
    const len = M * FINGER_K[f];
    for (let s = 0; s < 3; s++) {
      at = add(at, mul(dir, len * SEG[s]));
      at = [at[0], at[1], z(6 + 4 * f + s)];
      pts[6 + 4 * f + s] = at;
    }
  }
  return pts;
}

/** All four fingers flexed down by `c` (0 flat, 1 fist) about their own lateral axes. */
function curlFingers(flat: V3[], c: number): V3[] {
  const pts = flat.map((q) => [...q] as V3);
  for (let f = 0; f < 4; f++) {
    const a = flat[5 + 4 * f];
    const b = flat[8 + 4 * f];
    const fwd = unit([b[0] - a[0], b[1] - a[1], 0]);
    const k: V3 = [fwd[1], -fwd[0], 0];
    const psi = [-50 * c * DEG, -70 * c * DEG, -40 * c * DEG];
    const idx = [5 + 4 * f, 6 + 4 * f, 7 + 4 * f, 8 + 4 * f];
    let cum = 0;
    let at = pts[idx[0]];
    for (let s = 0; s < 3; s++) {
      cum += psi[s];
      const e = sub(flat[idx[s + 1]], flat[idx[s]]);
      at = add(at, rotVec(e, k, cum));
      pts[idx[s + 1]] = at;
    }
  }
  return pts;
}

/** Rests the posed hand on the table: pitched about the wrist (front end up), then lifted, just enough that nothing is below `zMin`. */
function settle(pts: V3[], zMin = 3): V3[] {
  const low = Math.min(...pts.map((q) => q[2]));
  if (low >= zMin) return pts;
  const pivot: V3 = [0, 0, pts[0][2]];
  let lo = 0;
  let hi = 60;
  const test = (a: number) =>
    Math.min(...pts.map((q) => rotPoint(q, pivot, [1, 0, 0], a * DEG)[2]));
  if (test(hi) < zMin) {
    const lift = zMin - test(hi);
    return pts.map((q) => {
      const r = rotPoint(q, pivot, [1, 0, 0], hi * DEG);
      return [r[0], r[1], r[2] + lift] as V3;
    });
  }
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (test(m) < zMin) lo = m;
    else hi = m;
  }
  return pts.map((q) => rotPoint(q, pivot, [1, 0, 0], hi * DEG));
}

/** The 21 landmarks in image pixels of the hand with its fingers curled by `c`, from a camera 350 mm straight above, 1100 px focal length. */
export function curledHandPx(c: number): Point2[] {
  const posed = settle(curlFingers(buildFlat(), c));
  // Camera straight above (15, 95), looking down: image x is table x, image y is table -y.
  const cam: V3 = [15, 95, 350];
  const W = 1024;
  const H = 1920;
  const f = 1100;
  return posed.map((P) => {
    const d = sub(P, cam);
    const zc = -d[2];
    return { x: W / 2 + (f * d[0]) / zc, y: H / 2 - (f * d[1]) / zc };
  });
}
