/**
 * SHADOW MODE (V3.3 WP1a, 2026-10-25, 未拍板 candidate): 3D hand-pose readings
 * from MediaPipe HandLandmarker's `worldLandmarks` (21 points, metres, origin
 * near the hand's geometric centre). Pure functions, recorded only; nothing
 * acts on them. Design: F20 DESIGN-placement-guidance §2.3 and §5.1. Whether
 * any of them separates a flat hand from a lifted one is exactly what WP2's
 * real scans have to show; until then they are numbers in the local log.
 *
 * ── Axis assumption (不確定 / uncertain) ──
 * MediaPipe documents the world landmarks as metres around the hand's centre
 * but does not, as far as this module's author could confirm, state the axis
 * directions. This module ASSUMES they follow the camera frame (x right, y
 * down, z away from the lens — the OpenCV convention `camera-pose.ts` uses for
 * its camera frame). Only `palmTiltDeg` depends on that assumption; the other
 * three are rotation-invariant (angles between the hand's own segments and
 * distances to its own plane). WP2's "phone tilted 10°, hand flat" scan is the
 * check (§2.3): if the assumption holds, `palmTiltDeg` stays small there.
 * The depth MediaPipe reports is the model's guess; its precision seen from
 * straight above the back of the hand is also 不確定.
 *
 * ── The maths ──
 * Palm plane: a least-squares plane through landmarks 0, 5, 9, 13, 17 (wrist
 * and the four finger MCPs). With centroid c and scatter matrix
 * S = Σ (pᵢ − c)(pᵢ − c)ᵀ, the plane's unit normal n is the eigenvector of S
 * with the smallest eigenvalue (found by cyclic Jacobi rotations; S is 3×3
 * symmetric). The normal's sign is arbitrary, so every angle against it below
 * is taken on |·| and is unsigned.
 *
 *   - `palmTiltDeg` = acos(|n · r₃|), degrees in [0, 90], where r₃ = R·(0,0,1)
 *     is the sheet normal (`camera-pose.ts`'s world Zw axis) expressed in the
 *     camera frame — the third column of the world→camera rotation R from
 *     `recoverCameraPose`. `null` without R.
 *   - `fingerFlexDeg[f]` = θ_PIP + θ_DIP for f = index, middle, ring, little,
 *     where θ at a joint is the angle between the incoming and outgoing bone
 *     vectors: θ_PIP = ∠(MCP→PIP, PIP→DIP), θ_DIP = ∠(PIP→DIP, DIP→TIP).
 *     0 = straight; it does not tell flexion from hyperextension or a sideways
 *     bend (all unsigned). The MCP joint is not included (§2.3).
 *   - `fingerElevDeg[f]` = asin(|MCP→TIP · n| / |MCP→TIP|), degrees in
 *     [0, 90]: how far the knuckle-to-tip line leaves the palm plane, either
 *     way (unsigned, since n's sign is arbitrary).
 *   - `planarityRmsMm` = √(mean dᵢ²) × 1000 over landmarks 0 and 5–20 (the
 *     wrist and the four fingers, 17 points; thumb 1–4 excluded), dᵢ = the
 *     signed distance (pᵢ − c)·n to the palm plane. The design says "20 點";
 *     21 minus the 4 thumb points is 17, read here as "the non-thumb points".
 *
 * Everything is `null` (and nothing throws) for anything that is not 21
 * points with finite x, y, z, or a palm whose 5 points are degenerate
 * (collinear or coincident). A rotation that is not 3×3 finite only nulls
 * `palmTiltDeg`.
 */

export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Row-major 3×3 (camera-pose.ts's `Mat3` shape). */
export type Rotation3 = readonly (readonly number[])[];

type Quad = readonly [number, number, number, number];

export interface HandWorldMetrics {
  readonly palmTiltDeg: number | null;
  readonly fingerFlexDeg: Quad | null;
  readonly fingerElevDeg: Quad | null;
  readonly planarityRmsMm: number | null;
}

export const EMPTY_HAND_WORLD: HandWorldMetrics = Object.freeze({
  palmTiltDeg: null,
  fingerFlexDeg: null,
  fingerElevDeg: null,
  planarityRmsMm: null,
});

type V3 = [number, number, number];

const PALM: readonly number[] = [0, 5, 9, 13, 17];
const NON_THUMB: readonly number[] = [
  0, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
];
const RAD_TO_DEG = 180 / Math.PI;
/** Below this (m) a bone counts as zero length. */
const MIN_BONE_M = 1e-9;
/**
 * The palm's in-plane spread must exceed this fraction of its largest
 * eigenvalue for the plane to be defined (rejects collinear palms).
 */
const MIN_PLANE_SPREAD = 1e-6;
const JACOBI_SWEEPS = 12;

function isFinite3(p: unknown): p is Point3 {
  if (!p || typeof p !== "object") return false;
  const q = p as { x?: unknown; y?: unknown; z?: unknown };
  return (
    typeof q.x === "number" &&
    typeof q.y === "number" &&
    typeof q.z === "number" &&
    Number.isFinite(q.x) &&
    Number.isFinite(q.y) &&
    Number.isFinite(q.z)
  );
}

const v = (p: Point3): V3 => [p.x, p.y, p.z];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): number => Math.sqrt(dot(a, a));

/** Unsigned angle between two vectors, degrees; null when either is ~zero. */
function angleDeg(a: V3, b: V3): number | null {
  const na = norm(a);
  const nb = norm(b);
  if (!(na > MIN_BONE_M) || !(nb > MIN_BONE_M)) return null;
  // atan2(|a×b|, a·b) instead of acos: stays accurate near 0° (straight joints).
  const cx = a[1] * b[2] - a[2] * b[1];
  const cy = a[2] * b[0] - a[0] * b[2];
  const cz = a[0] * b[1] - a[1] * b[0];
  return (
    Math.atan2(Math.sqrt(cx * cx + cy * cy + cz * cz), dot(a, b)) * RAD_TO_DEG
  );
}

/**
 * Eigen-decomposition of a symmetric 3×3 by cyclic Jacobi rotations. Returns
 * the eigenvalues and the eigenvectors as columns of `vectors` (row-major).
 */
function jacobiEigenSym3(m: number[][]): {
  values: V3;
  vectors: number[][];
} {
  const a = m.map((r) => r.slice());
  const e = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < JACOBI_SWEEPS; sweep++) {
    const off = a[0][1] ** 2 + a[0][2] ** 2 + a[1][2] ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t =
          Math.sign(theta || 1) /
          (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const ekp = e[k][p];
          const ekq = e[k][q];
          e[k][p] = c * ekp - s * ekq;
          e[k][q] = s * ekp + c * ekq;
        }
      }
    }
  }
  return { values: [a[0][0], a[1][1], a[2][2]], vectors: e };
}

/** Least-squares plane through `pts`: centroid and unit normal, or null if degenerate. */
export function fitPlane(
  pts: readonly Point3[],
): { centroid: V3; normal: V3 } | null {
  if (pts.length < 3) return null;
  const c: V3 = [0, 0, 0];
  for (const p of pts) {
    c[0] += p.x;
    c[1] += p.y;
    c[2] += p.z;
  }
  c[0] /= pts.length;
  c[1] /= pts.length;
  c[2] /= pts.length;
  const s = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const p of pts) {
    const d = sub(v(p), c);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) s[i][j] += d[i] * d[j];
  }
  const { values, vectors } = jacobiEigenSym3(s);
  const order = [0, 1, 2].sort((i, j) => values[i] - values[j]);
  const largest = values[order[2]];
  const middle = values[order[1]];
  if (!(largest > 0) || !(middle > MIN_PLANE_SPREAD * largest)) return null;
  const k = order[0];
  const n: V3 = [vectors[0][k], vectors[1][k], vectors[2][k]];
  const nn = norm(n);
  if (!(nn > 0)) return null;
  return { centroid: c, normal: [n[0] / nn, n[1] / nn, n[2] / nn] };
}

function isRotation3(r: unknown): r is Rotation3 {
  return (
    Array.isArray(r) &&
    r.length === 3 &&
    r.every(
      (row) =>
        Array.isArray(row) &&
        row.length === 3 &&
        row.every((x) => typeof x === "number" && Number.isFinite(x)),
    )
  );
}

/**
 * 3D readings of one hand. `worldLandmarks`: MediaPipe's 21 world landmarks
 * (metres). `rotation`: optional world→camera rotation R from
 * `recoverCameraPose` (sheet frame of `camera-pose.ts`); without it
 * `palmTiltDeg` is null.
 */
export function computeHandWorld(
  worldLandmarks: readonly Point3[] | null | undefined,
  rotation?: Rotation3 | null,
): HandWorldMetrics {
  if (
    !Array.isArray(worldLandmarks) ||
    worldLandmarks.length !== 21 ||
    !worldLandmarks.every(isFinite3)
  ) {
    return EMPTY_HAND_WORLD;
  }
  const w = worldLandmarks;
  const plane = fitPlane(PALM.map((i) => w[i]));
  if (!plane) return EMPTY_HAND_WORLD;
  const { centroid, normal } = plane;

  let palmTiltDeg: number | null = null;
  if (rotation != null && isRotation3(rotation)) {
    const r3: V3 = [rotation[0][2], rotation[1][2], rotation[2][2]];
    const nr = norm(r3);
    if (nr > 0) {
      const c = Math.min(1, Math.abs(dot(normal, r3)) / nr);
      palmTiltDeg = Math.acos(c) * RAD_TO_DEG;
    }
  }

  const flex: number[] = [];
  const elev: number[] = [];
  for (let f = 0; f < 4; f++) {
    const m = 5 + 4 * f;
    const mcp = v(w[m]);
    const pip = v(w[m + 1]);
    const dip = v(w[m + 2]);
    const tip = v(w[m + 3]);
    const aPip = angleDeg(sub(pip, mcp), sub(dip, pip));
    const aDip = angleDeg(sub(dip, pip), sub(tip, dip));
    const reach = sub(tip, mcp);
    const nReach = norm(reach);
    if (aPip === null || aDip === null || !(nReach > MIN_BONE_M)) {
      return { ...EMPTY_HAND_WORLD, palmTiltDeg };
    }
    flex.push(aPip + aDip);
    elev.push(
      Math.asin(Math.min(1, Math.abs(dot(reach, normal)) / nReach)) *
        RAD_TO_DEG,
    );
  }

  let sq = 0;
  for (const i of NON_THUMB) {
    const d = dot(sub(v(w[i]), centroid), normal);
    sq += d * d;
  }
  const planarityRmsMm = Math.sqrt(sq / NON_THUMB.length) * 1000;

  return {
    palmTiltDeg,
    fingerFlexDeg: [flex[0], flex[1], flex[2], flex[3]],
    fingerElevDeg: [elev[0], elev[1], elev[2], elev[3]],
    planarityRmsMm,
  };
}
