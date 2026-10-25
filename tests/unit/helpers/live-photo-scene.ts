/**
 * Synthetic top-down scene for the "live preview vs photo analysis" tests
 * (S1, 2026-10-19). NOT a test file (vitest only collects `*.test.ts`).
 *
 * Ported from the R1 research harness (`scene.ts` / `common.ts` /
 * `e2_live_vs_photo.ts`), synthetic data only: a blank A4 sheet on a darker
 * table, an optional crude hand (capsule union, NOT a real hand), a pinhole
 * camera, 2x2 supersampling, a 3x3 binomial blur and Gaussian sensor noise.
 * The same scene is rendered once at the photo's resolution and then
 * area-averaged down to the live loop's sample size, the way the browser
 * draws the video frame into the live sample canvas.
 *
 * Everything measured with it is SIMULATED, not a phone measurement.
 */

type Vec3 = readonly [number, number, number];

export interface Cam {
  /** Focal length in px of the rendered image. */
  readonly f: number;
  readonly w: number;
  readonly h: number;
  readonly R: readonly number[];
  readonly C: Vec3;
}

const deg = (d: number) => (d * Math.PI) / 180;

const Rx = (a: number) => [
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
function apply(m: readonly number[], v: readonly number[]): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/**
 * World: X right, Y down (paper "v"), Z from the camera toward the table
 * (table at Z = 0). The optical axis meets the table at the origin.
 */
export function makeCam(opts: {
  f: number;
  w: number;
  h: number;
  /** Camera-to-table distance in mm. */
  d: number;
  pitchDeg?: number;
}): Cam {
  const R = Rx(deg(opts.pitchDeg ?? 0));
  const ax = apply(R, [0, 0, 1]);
  return {
    f: opts.f,
    w: opts.w,
    h: opts.h,
    R,
    C: [-opts.d * ax[0], -opts.d * ax[1], -opts.d * ax[2]],
  };
}

function unproject(
  cam: Cam,
  x: number,
  y: number,
): { x: number; y: number } | null {
  const dir = apply(cam.R, [
    (x - cam.w / 2) / cam.f,
    (y - cam.h / 2) / cam.f,
    1,
  ]);
  if (dir[2] <= 1e-9) return null;
  const t = -cam.C[2] / dir[2];
  if (t <= 0) return null;
  return { x: cam.C[0] + t * dir[0], y: cam.C[1] + t * dir[1] };
}

/** Distance (mm) so the paper's mean top/bottom width is `frac` of `w` px at focal `f`. */
export function distanceForWidthFraction(
  f: number,
  w: number,
  frac: number,
  wMm = 210,
): number {
  return (f * wMm) / (frac * w);
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r: () => number): number {
  return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
}

export type Rgb = readonly [number, number, number];

export interface HandSpec {
  /** Palm centre in paper-centred mm (v down). */
  readonly hx: number;
  readonly hy: number;
  readonly forearmWidth: number;
  readonly skin: Rgb;
}

export interface SceneSpec {
  readonly cam: Cam;
  readonly table: Rgb;
  readonly hand?: HandSpec | null;
  /**
   * Peak outward bow (mm) of the two long edges, parabolic along each edge:
   * a stand-in for a curled sheet seen from above (the edge is no longer a
   * straight line, so the fitted line leaves a residual).
   */
  readonly bowMm?: number;
  readonly noise?: number;
  readonly seed?: number;
}

export interface Img {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

function capsuleDist(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby || 1),
    ),
  );
  return Math.hypot(px - (ax + t * abx), py - (ay + t * aby));
}

function inHand(u: number, v: number, h: HandSpec): boolean {
  const { hx, hy } = h;
  const px = Math.abs(u - hx) - (42.5 - 12);
  const py = Math.abs(v - hy) - (50 - 12);
  const palm =
    Math.hypot(Math.max(px, 0), Math.max(py, 0)) +
    Math.min(Math.max(px, py), 0) -
    12;
  if (palm <= 0) return true;
  const fingers: ReadonlyArray<readonly [number, number]> = [
    [-31.5, 58],
    [-10.5, 78],
    [10.5, 72],
    [31.5, 56],
  ];
  for (const [du, len] of fingers) {
    if (
      capsuleDist(u, v, hx + du, hy - 50, hx + du, hy - 50 - len + 9.5) <= 9.5
    )
      return true;
  }
  if (capsuleDist(u, v, hx - 38, hy + 15, hx - 78, hy - 22) <= 11) return true;
  return Math.abs(u - hx) <= h.forearmWidth / 2 && v >= hy + 45;
}

function blur3(data: Uint8ClampedArray, W: number, H: number): void {
  const tmp = new Float32Array(W * H * 3);
  const k = [0.25, 0.5, 0.25];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let d = -1; d <= 1; d++)
          s +=
            k[d + 1] *
            data[(y * W + Math.min(W - 1, Math.max(0, x + d))) * 4 + c];
        tmp[(y * W + x) * 3 + c] = s;
      }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let d = -1; d <= 1; d++)
          s +=
            k[d + 1] *
            tmp[(Math.min(H - 1, Math.max(0, y + d)) * W + x) * 3 + c];
        data[(y * W + x) * 4 + c] = s;
      }
}

export function render(spec: SceneSpec): Img {
  const { cam } = spec;
  const W = cam.w;
  const H = cam.h;
  const data = new Uint8ClampedArray(W * H * 4);
  const paper: Rgb = [208, 208, 202];
  const rnd = mulberry(spec.seed ?? 1);
  const bow = spec.bowMm ?? 0;
  const ss = [0.25, 0.75];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const sy of ss)
        for (const sx of ss) {
          const q = unproject(cam, x + sx, y + sy);
          let col: Rgb = spec.table;
          if (q) {
            const u = q.x;
            const v = q.y;
            const halfW = 105 + bow * (1 - (v / 148.5) ** 2);
            if (Math.abs(u) <= halfW && Math.abs(v) <= 148.5) {
              const k = 1 + 0.06 * (u / 105) * 0.7 + 0.06 * (v / 148.5) * 0.7;
              col = [paper[0] * k, paper[1] * k, paper[2] * k];
            }
            if (spec.hand && inHand(u, v, spec.hand)) col = spec.hand.skin;
          }
          r += col[0];
          g += col[1];
          b += col[2];
        }
      const o = (y * W + x) * 4;
      data[o] = r / 4;
      data[o + 1] = g / 4;
      data[o + 2] = b / 4;
      data[o + 3] = 255;
    }
  }
  blur3(data, W, H);
  const sigma = spec.noise ?? 1.5;
  if (sigma > 0)
    for (let i = 0; i < W * H; i++)
      for (let c = 0; c < 3; c++) data[i * 4 + c] += gauss(rnd) * sigma;
  return { width: W, height: H, data };
}

/** Area-average downscale: stands in for `drawImage` of the video frame into the live sample canvas. */
export function downscale(img: Img, w: number, h: number): Img {
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = img.width / w;
  const sy = img.height / h;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = x * sx;
      const x1 = (x + 1) * sx;
      const y0 = y * sy;
      const y1 = (y + 1) * sy;
      let r = 0;
      let g = 0;
      let b = 0;
      let wt = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++)
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          const w2 =
            (Math.min(xx + 1, x1) - Math.max(xx, x0)) *
            (Math.min(yy + 1, y1) - Math.max(yy, y0));
          if (w2 <= 0 || xx >= img.width || yy >= img.height) continue;
          const o = (yy * img.width + xx) * 4;
          r += w2 * img.data[o];
          g += w2 * img.data[o + 1];
          b += w2 * img.data[o + 2];
          wt += w2;
        }
      const o = (y * w + x) * 4;
      out[o] = r / wt;
      out[o + 1] = g / wt;
      out[o + 2] = b / wt;
      out[o + 3] = 255;
    }
  return { width: w, height: h, data: out };
}
