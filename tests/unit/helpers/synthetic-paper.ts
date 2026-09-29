/**
 * Synthetic "photo of a blank sheet of paper" generator for
 * `paper-detect.test.ts`. NOT itself a test file (vitest.config.ts only
 * collects `*.test.ts`), mirroring `synthetic-camera.ts`'s role for the
 * homography/parallax tests.
 *
 * Renders a rectangular paper region under a random small perspective
 * jitter, with analytic (signed-distance) anti-aliasing at the true edge
 * position — so the generator itself knows the exact sub-pixel ground
 * truth corners `detectPaperQuad` is being scored against — plus uneven
 * lighting, per-pixel noise, an optional final blur pass, an optional
 * skin-tone occluder crossing the bottom edge, an optional bowed
 * ("curled") edge, and an optional shift that pushes the quad partly
 * outside the frame.
 *
 * Deliberately does NOT import `src/client/paper/quad-math.ts`'s PRNG —
 * fixture generation must never silently change if production's RNG
 * implementation ever does.
 */
import type { Point2 } from "../../../src/client/geometry/homography";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Row-major 3×3 matrix, flattened. Mirrors the reviewer's independent generator's `H3` convention (PR #59 review). */
type Mat3Flat = number[];

function mat3(
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
  g: number,
  h: number,
  i: number,
): Mat3Flat {
  return [a, b, c, d, e, f, g, h, i];
}

function mul3(a: Mat3Flat, b: Mat3Flat): Mat3Flat {
  const r = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
    }
  }
  return r;
}

function applyMat3(h: Mat3Flat, p: Point2): Point2 {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}

export interface SyntheticPaperOptions {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  /** Skin-tone blob crossing the bottom edge. */
  readonly occluder?: boolean;
  /** Bow one side outward by a few px (simulates a curled/lifted sheet). */
  readonly curledSideIndex?: 0 | 1 | 2 | 3;
  /** Peak bow amplitude in px (sinusoidal along the side), default 5. */
  readonly curlAmplitudePx?: number;
  /** Shift the quad so its left side sits outside the frame. */
  readonly clipLeftSide?: boolean;
  readonly noiseAmplitude?: number;
  /**
   * True paper HEIGHT/WIDTH ratio, default A4 portrait (297/210 ≈ 1.4143).
   * 2026-09-25 PR #59 review (M1): this used to be implied by two
   * INDEPENDENTLY randomised x/y margins, which rendered a "paper" of
   * whatever aspect ratio the random draw happened to produce (≈1.16 in
   * the reviewer's repro) — silently NOT actually A4-shaped, so every
   * corner-accuracy assertion against it was accuracy on the wrong
   * target. The rectangle is now built at exactly this ratio and then
   * rotated/jittered, never the other way around.
   */
  readonly paperAspectRatio?: number;
  /** In-plane rotation of the paper rectangle in degrees (0 = upright). */
  readonly rotationDeg?: number;
  /** Camera tilt off straight-down, about the world X axis, degrees. */
  readonly tiltXDeg?: number;
  /** Camera tilt off straight-down, about the world Y axis, degrees. */
  readonly tiltYDeg?: number;
  /** Override the background's base brightness (default 110) — e.g. a bright wall or a light desk close to the paper's own tone. */
  readonly backgroundLevel?: number;
}

export interface SyntheticPaperCase {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  /** Exact (sub-pixel) TL, TR, BR, BL corners used to render the paper. */
  readonly trueCorners: [Point2, Point2, Point2, Point2];
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Perpendicular signed distance from `p` to the line through `a`→`b`, positive on `insideSign`'s side. */
function edgeDistance(
  p: Point2,
  a: Point2,
  b: Point2,
  insideSign: number,
): number {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const len = Math.hypot(ex, ey);
  const nx = -ey / len;
  const ny = ex / len;
  return (nx * (p.x - a.x) + ny * (p.y - a.y)) * insideSign;
}

export function generateSyntheticPaper(
  options: SyntheticPaperOptions,
): SyntheticPaperCase {
  const { width, height, seed } = options;
  const noiseAmplitude = options.noiseAmplitude ?? 4;
  const rng = mulberry32(seed);

  // Genuine pinhole-camera projection (2026-09-25 PR #59 review, M1):
  // the paper is a real rectangle in its own plane, rotated in-plane then
  // tilted and placed at a distance chosen to fill `fillFrac` of the
  // frame, then projected through a pinhole camera — mirroring the
  // reviewer's own independent generator's model (gen.mts). Replaces the
  // previous "jitter each corner independently" approach: independent
  // per-corner jitter does NOT correspond to any real camera's
  // perspective of a rectangle (it doesn't preserve the orthogonality a
  // real rectangle's edges have in 3D), so it could — and did — produce
  // "true corners" that `detectPaperQuad`'s rectified-aspect sanity check
  // correctly refuses to call a valid A4/Letter sheet.
  const aspectRatio = options.paperAspectRatio ?? 297 / 210; // height/width
  const rotationRad = ((options.rotationDeg ?? 0) * Math.PI) / 180;
  const tiltXRad = ((options.tiltXDeg ?? 0) * Math.PI) / 180;
  const tiltYRad = ((options.tiltYDeg ?? 0) * Math.PI) / 180;

  const paperWidthMm = 210;
  const paperHeightMm = paperWidthMm * aspectRatio;
  const fillFrac = 0.5 + rng() * 0.12;
  const fPx = 0.85 * Math.max(width, height);
  const longSideMm = Math.max(paperWidthMm, paperHeightMm);
  const targetLongPx = fillFrac * Math.min(width, height);
  const distanceMm = (fPx * longSideMm) / targetLongPx;

  const T0 = mat3(1, 0, -paperWidthMm / 2, 0, 1, -paperHeightMm / 2, 0, 0, 1);
  const Rz = mat3(
    Math.cos(rotationRad),
    -Math.sin(rotationRad),
    0,
    Math.sin(rotationRad),
    Math.cos(rotationRad),
    0,
    0,
    0,
    1,
  );
  const cosX = Math.cos(tiltXRad);
  const sinX = Math.sin(tiltXRad);
  const cosY = Math.cos(tiltYRad);
  const sinY = Math.sin(tiltYRad);
  const Rx = mat3(1, 0, 0, 0, cosX, -sinX, 0, sinX, cosX);
  const Ry = mat3(cosY, 0, sinY, 0, 1, 0, -sinY, 0, cosY);
  const R = mul3(Ry, Rx);
  // [r1 r2 t] — the plane (Z=0) points map through R's first two columns
  // plus the translation to distance.
  const worldToImage = mat3(
    R[0],
    R[1],
    0,
    R[3],
    R[4],
    0,
    R[6],
    R[7],
    distanceMm,
  );
  const K = mat3(fPx, 0, width / 2, 0, fPx, height / 2, 0, 0, 1);
  const H = mul3(K, mul3(worldToImage, mul3(Rz, T0)));

  const base: [Point2, Point2, Point2, Point2] = [
    applyMat3(H, { x: 0, y: 0 }),
    applyMat3(H, { x: paperWidthMm, y: 0 }),
    applyMat3(H, { x: paperWidthMm, y: paperHeightMm }),
    applyMat3(H, { x: 0, y: paperHeightMm }),
  ];

  let corners: [Point2, Point2, Point2, Point2] = base;

  if (options.clipLeftSide) {
    // Force the left side (TL, BL — indices 0 and 3) unambiguously off-canvas,
    // regardless of how the perspective jitter above happened to land.
    corners = [
      { x: -20, y: corners[0].y },
      corners[1],
      corners[2],
      { x: -15, y: corners[3].y },
    ];
  }

  const centroid = {
    x: (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4,
    y: (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4,
  };
  const insideSigns = [0, 1, 2, 3].map((i) => {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const raw = edgeDistance(centroid, a, b, 1);
    return raw >= 0 ? 1 : -1;
  });

  const lightFx = 0.3 + rng() * 0.9;
  const lightFy = 0.3 + rng() * 0.9;
  const lightPhase = rng() * Math.PI * 2;

  // Sized relative to the RENDERED PAPER's own pixel dimensions, not the
  // frame's — the paper only fills part of the frame (`fillFrac` above),
  // so an occluder sized off frame width/height could end up covering
  // most or all of a small paper, unrealistically. (2026-09-25 PR #59
  // review: this mismatch, introduced together with the pinhole-camera
  // fix above, was blowing up otherwise-normal hand-occlusion cases.)
  const paperWidthPx = Math.hypot(
    corners[1].x - corners[0].x,
    corners[1].y - corners[0].y,
  );
  const paperHeightPx = Math.hypot(
    corners[3].x - corners[0].x,
    corners[3].y - corners[0].y,
  );
  const occluderCentre = {
    x: (corners[2].x + corners[3].x) / 2 + (rng() - 0.5) * paperWidthPx * 0.1,
    y: (corners[2].y + corners[3].y) / 2,
  };
  const occluderRx = paperWidthPx * (0.14 + rng() * 0.06);
  const occluderRy = paperHeightPx * (0.12 + rng() * 0.05);
  const skinR = 190 + rng() * 30;
  const skinG = 140 + rng() * 25;
  const skinB = 110 + rng() * 25;

  const n = width * height;
  const gray = new Float32Array(n);
  const isPaperTint = new Float32Array(n); // 1 = paper-neutral colour, blended toward skin below
  const occluderAlpha = new Float32Array(n);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const p: Point2 = { x: x + 0.5, y: y + 0.5 };
      let minDist = Infinity;
      for (let i = 0; i < 4; i++) {
        const a = corners[i];
        const b = corners[(i + 1) % 4];
        let d: number;
        if (i === options.curledSideIndex) {
          const ex = b.x - a.x;
          const ey = b.y - a.y;
          const segLenSq = ex * ex + ey * ey;
          const t = ((p.x - a.x) * ex + (p.y - a.y) * ey) / segLenSq;
          const bow =
            Math.sin(Math.PI * Math.min(1, Math.max(0, t))) *
            (options.curlAmplitudePx ?? 5);
          d = edgeDistance(p, a, b, insideSigns[i]) - bow;
        } else {
          d = edgeDistance(p, a, b, insideSigns[i]);
        }
        if (d < minDist) minDist = d;
      }
      const alpha = smoothstep(-0.6, 0.6, minDist);

      const light =
        1 +
        0.12 *
          Math.sin(
            2 * Math.PI * (lightFx * (x / width) + lightFy * (y / height)) +
              lightPhase,
          );
      const noise = (rng() - 0.5) * 2 * noiseAmplitude;
      const backgroundV = (options.backgroundLevel ?? 110) * light + noise;
      const paperV = 235 * light + noise;
      gray[idx] = backgroundV * (1 - alpha) + paperV * alpha;
      isPaperTint[idx] = alpha;

      if (options.occluder) {
        const dx = (x - occluderCentre.x) / occluderRx;
        const dy = (y - occluderCentre.y) / occluderRy;
        const r = Math.hypot(dx, dy);
        occluderAlpha[idx] = smoothstep(1.05, 0.85, r);
      }
    }
  }

  // Final slight blur pass (separable box blur, radius 1) — mimics real
  // lens/sensor softness on top of the analytic anti-aliasing above.
  const blurred = boxBlur(gray, width, height, 1);

  const data = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const v = blurred[i];
    const occ = occluderAlpha[i];
    const r = v * (1 - occ) + skinR * occ;
    const g = v * (1 - occ) + skinG * occ;
    const b = v * (1 - occ) + skinB * occ;
    data[o] = clampByte(r);
    data[o + 1] = clampByte(g);
    data[o + 2] = clampByte(b);
    data[o + 3] = 255;
  }

  return { data, width, height, trueCorners: corners };
}

function boxBlur(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const clamp = (v: number, lo: number, hi: number) =>
    v < lo ? lo : v > hi ? hi : v;
  const tmp = new Float32Array(width * height);
  const out = new Float32Array(width * height);
  const norm = 1 / (2 * radius + 1);
  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    let sum = 0;
    for (let x = -radius; x <= radius; x++)
      sum += src[rowOff + clamp(x, 0, width - 1)];
    for (let x = 0; x < width; x++) {
      tmp[rowOff + x] = sum * norm;
      sum +=
        src[rowOff + clamp(x + radius + 1, 0, width - 1)] -
        src[rowOff + clamp(x - radius, 0, width - 1)];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++)
      sum += tmp[clamp(y, 0, height - 1) * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum * norm;
      sum +=
        tmp[clamp(y + radius + 1, 0, height - 1) * width + x] -
        tmp[clamp(y - radius, 0, height - 1) * width + x];
    }
  }
  return out;
}
