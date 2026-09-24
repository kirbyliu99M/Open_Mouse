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
function edgeDistance(p: Point2, a: Point2, b: Point2, insideSign: number): number {
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

  const marginXFrac = 0.12 + rng() * 0.06;
  const marginYFrac = 0.12 + rng() * 0.06;
  const mx = width * marginXFrac;
  const my = height * marginYFrac;
  const base: [Point2, Point2, Point2, Point2] = [
    { x: mx, y: my },
    { x: width - mx, y: my },
    { x: width - mx, y: height - my },
    { x: mx, y: height - my },
  ];

  const jitterFrac = 0.04;
  let corners: [Point2, Point2, Point2, Point2] = base;
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = base.map((c) => ({
      x: c.x + (rng() - 0.5) * 2 * width * jitterFrac,
      y: c.y + (rng() - 0.5) * 2 * height * jitterFrac,
    })) as [Point2, Point2, Point2, Point2];
    if (isConvex(candidate)) {
      corners = candidate;
      break;
    }
  }

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

  const occluderCentre = {
    x: (corners[2].x + corners[3].x) / 2 + (rng() - 0.5) * width * 0.1,
    y: (corners[2].y + corners[3].y) / 2,
  };
  const occluderRx = width * (0.14 + rng() * 0.06);
  const occluderRy = height * (0.12 + rng() * 0.05);
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
          Math.sin(2 * Math.PI * (lightFx * (x / width) + lightFy * (y / height)) + lightPhase);
      const noise = (rng() - 0.5) * 2 * noiseAmplitude;
      const backgroundV = 110 * light + noise;
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

function isConvex(quad: readonly [Point2, Point2, Point2, Point2]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const c = quad[(i + 2) % 4];
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cr) < 1e-9) continue;
    const s = cr > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
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
    for (let x = -radius; x <= radius; x++) sum += src[rowOff + clamp(x, 0, width - 1)];
    for (let x = 0; x < width; x++) {
      tmp[rowOff + x] = sum * norm;
      sum +=
        src[rowOff + clamp(x + radius + 1, 0, width - 1)] -
        src[rowOff + clamp(x - radius, 0, width - 1)];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[clamp(y, 0, height - 1) * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum * norm;
      sum +=
        tmp[clamp(y + radius + 1, 0, height - 1) * width + x] -
        tmp[clamp(y - radius, 0, height - 1) * width + x];
    }
  }
  return out;
}
