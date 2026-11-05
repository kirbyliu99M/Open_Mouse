/**
 * Synthetic renderer for the Scan Lab card tests (L3a, 2026-10-29): a
 * pinhole camera with a known rotation, focal length and height looks at a
 * table with an A4 sheet and an ID-1 card with rounded corners on it, and
 * this draws the RGBA frame (anti-aliased edges, optional low-frequency
 * wood grain, Gaussian blur and Gaussian noise).
 *
 * Written separately from `src/client/lab/card/**` so the tests do not
 * check the detector against its own maths: the camera here is built with
 * its own Rodrigues rotation and look-at, and ground truth comes straight
 * from projecting known table points.
 *
 * Table frame: mm, x right, y DOWN (the same handedness as sheet mm and
 * image px). World frame (camera-pose.ts): Xw = x, Yw = -y, Zw up toward
 * the camera.
 *
 * Camera tilt convention (what `cardMeasure.ts` documents): `tiltDeg` is
 * the angle between the optical axis and straight down; `azimuthDeg` is
 * the direction, in the image (x right, y down, measured from +x toward
 * +y), in which the nadir (the table point straight below the camera)
 * appears from the principal point. A test checks that projecting the
 * nadir lands at principal point + f*tan(tilt)*(cos az, sin az).
 */

export type Mat3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];
export interface Pt {
  x: number;
  y: number;
}

/**
 * L7: `maze`, red lines on black (Kirby's 2026-11-01 mouse mat).
 * L11: `darkMaze`, the same mat's dark brown-grey part (about (74, 68, 67))
 * with slightly lighter chevron lines, where Kirby put a black card
 * (2026-11-03).
 */
export type Background = "grey" | "wood" | "dark" | "maze" | "darkMaze";

export interface LabCardScene {
  readonly width: number;
  readonly height: number;
  readonly fPx: number;
  readonly tiltDeg: number;
  readonly azimuthDeg: number;
  /** Rotation of the camera about the vertical, degrees (in-image rotation of the whole scene). */
  readonly yawDeg?: number;
  /** Camera height above the table, mm. */
  readonly heightMm: number;
  /** Table point (mm) the optical axis hits. */
  readonly aimMm: Pt;
  /** Paper top-left corner on the table, mm; paper is axis-aligned, `paperMm` wide (x) and tall (y). */
  readonly paperOriginMm?: Pt | null;
  readonly paperMm?: { readonly width: number; readonly height: number };
  /** Card centre on the table, mm; null = no card. */
  readonly cardCentreMm?: Pt | null;
  /** Card rotation on the table, degrees; at 0 the long side runs along table x. */
  readonly cardAngleDeg?: number;
  /** Corner radius, mm (ISO/IEC 7810: about 3.18). 0 = sharp corners. */
  readonly cardRadiusMm?: number;
  /** Card RGB. */
  readonly cardRgb?: readonly [number, number, number];
  /** Draw a dark magnetic stripe along one long side (5.5 mm in, 12.7 mm wide). */
  readonly cardStripe?: boolean;
  /** Draw a white ring and bar logo in the card's middle (L4: Kirby's real card has one). */
  readonly cardLogo?: boolean;
  /** Light grey grid lines on the sheet every this many mm (L4: loose-leaf grid paper); 0/undefined = plain. */
  readonly paperGridMm?: number;
  /** Punched holes (6 mm, background showing through) down the sheet's left edge, every 9.5 mm (L4). */
  readonly paperHoles?: boolean;
  /**
   * L5: a second card (same size and corner radius, plain, no stripe or logo)
   * drawn under the first where they overlap. Kirby's 2026-10-30 photos hold
   * two cards, one on the sheet and one beside it.
   */
  readonly secondCard?: {
    readonly centreMm: Pt;
    readonly angleDeg: number;
    readonly rgb: readonly [number, number, number];
  } | null;
  readonly background?: Background;
  /**
   * L6: the sheet lies OVER the card where they overlap (Kirby's 2026-11-01
   * photos: the card pushed under the sheet's top edge). Default false: the
   * card is drawn over the sheet.
   */
  readonly paperOverCard?: boolean;
  /**
   * L6: glare on the card, grey levels added at its +u end (the end of its
   * long side in its own frame), falling linearly to 0 at its centre (Kirby's
   * 2026-11-01 card back: about 110 levels brighter at one end). Default 0.
   */
  readonly cardGlare?: number;
  /**
   * L7: a band of another colour across the card's -v long side (its top in
   * its own frame), `widthMm` wide (Kirby's red card front: a navy "District
   * 67" band about 5 mm wide, with a thin gold line between band and
   * body: `line`). Default none.
   */
  readonly cardBand?: {
    readonly widthMm: number;
    readonly rgb: readonly [number, number, number];
    readonly line?: {
      readonly widthMm: number;
      readonly rgb: readonly [number, number, number];
    };
  } | null;
  /**
   * L11: a lighter rim `widthMm` wide just inside the card's outline (the
   * bevelled edge of Kirby's black card catches light). Default none.
   */
  readonly cardRim?: {
    readonly widthMm: number;
    readonly rgb: readonly [number, number, number];
  } | null;
  /** L11: `darkMaze` has no chevrons inside this table rectangle (mm): a plain dark patch, behind a 2 mm lighter seam. */
  readonly darkMazePlain?: {
    readonly x0: number;
    readonly x1: number;
    readonly y0: number;
    readonly y1: number;
  };
  /** Gaussian blur sigma in px, applied after rendering (0 = none). */
  readonly blurSigmaPx?: number;
  /** Gaussian noise sigma in grey levels, applied last (0 = none). */
  readonly noiseSigma?: number;
  readonly seed?: number;
}

export interface RenderedLabCardScene {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  /** Table mm -> image px. */
  readonly tableToImage: Mat3;
  /** World -> camera rotation (camera-pose.ts convention). */
  readonly R: Mat3;
  readonly cx: number;
  readonly cy: number;
  /** The card's sharp-rectangle corners (intersections of its straight edges), image px, in table order: (-a,-b), (a,-b), (a,b), (-a,b) of the card's own frame. */
  readonly cardCornersPx: readonly Pt[] | null;
  /** `secondCard`'s sharp-rectangle corners, image px, same order as `cardCornersPx`; null without one. */
  readonly secondCardCornersPx: readonly Pt[] | null;
  /** Paper corners in image px, table order TL, TR, BR, BL (table frame). */
  readonly paperCornersPx: readonly Pt[] | null;
}

export const ID1 = { long: 85.6, short: 53.98 } as const;

function mul(a: Mat3, b: Mat3): Mat3 {
  const r: Mat3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
  return r;
}

function mulVec(m: Mat3, v: readonly number[]): [number, number, number] {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

function transpose(m: Mat3): Mat3 {
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
  ];
}

function inv(m: Mat3): Mat3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const k = 1 / det;
  return [
    [(e * i - f * h) * k, (c * h - b * i) * k, (b * f - c * e) * k],
    [(f * g - d * i) * k, (a * i - c * g) * k, (c * d - a * f) * k],
    [(d * h - e * g) * k, (b * g - a * h) * k, (a * e - b * d) * k],
  ];
}

/** Rodrigues rotation about unit axis k by angle t (radians). */
function rodrigues(k: readonly number[], t: number): Mat3 {
  const [x, y, z] = k;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const C = 1 - c;
  return [
    [c + x * x * C, x * y * C - z * s, x * z * C + y * s],
    [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
    [z * x * C - y * s, z * y * C + x * s, c + z * z * C],
  ];
}

export function applyMat(h: Mat3, p: Pt): Pt {
  const w = h[2][0] * p.x + h[2][1] * p.y + h[2][2];
  return {
    x: (h[0][0] * p.x + h[0][1] * p.y + h[0][2]) / w,
    y: (h[1][0] * p.x + h[1][1] * p.y + h[1][2]) / w,
  };
}

export interface SceneCamera {
  readonly R: Mat3;
  readonly C: [number, number, number];
  readonly K: Mat3;
  readonly tableToImage: Mat3;
}

/** Build the camera of a scene (exported so a test can project arbitrary world points). */
export function sceneCamera(scene: LabCardScene): SceneCamera {
  const cx = scene.width / 2;
  const cy = scene.height / 2;
  const K: Mat3 = [
    [scene.fPx, 0, cx],
    [0, scene.fPx, cy],
    [0, 0, 1],
  ];
  // Straight down: camera X = world X, camera Y = -Yw (down the page), camera Z = -Zw.
  const R0: Mat3 = [
    [1, 0, 0],
    [0, -1, 0],
    [0, 0, -1],
  ];
  const yaw = ((scene.yawDeg ?? 0) * Math.PI) / 180;
  const Ryaw = rodrigues([0, 0, 1], yaw);
  const th = (scene.tiltDeg * Math.PI) / 180;
  const ph = (scene.azimuthDeg * Math.PI) / 180;
  // Rotating camera-frame +Z onto (sin th cos ph, sin th sin ph, cos th): the
  // nadir (world down) then sits in that camera direction.
  const Rt = rodrigues([-Math.sin(ph), Math.cos(ph), 0], th);
  const R = mul(Rt, mul(R0, Ryaw));
  // Optical axis in world coordinates.
  const axisW = mulVec(transpose(R), [0, 0, 1]);
  const lambda = scene.heightMm / -axisW[2];
  const aimW = [scene.aimMm.x, -scene.aimMm.y, 0];
  const C: [number, number, number] = [
    aimW[0] - lambda * axisW[0],
    aimW[1] - lambda * axisW[1],
    aimW[2] - lambda * axisW[2],
  ];
  const t = mulVec(R, C).map((v) => -v);
  // Table (x, y) -> world (x, -y, 0) -> camera = x*r1 - y*r2 + t.
  const P: Mat3 = [
    [R[0][0], -R[0][1], t[0]],
    [R[1][0], -R[1][1], t[1]],
    [R[2][0], -R[2][1], t[2]],
  ];
  return { R, C, K, tableToImage: mul(K, P) };
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

// Material ids.
const BG = 0;
const PAPER = 1;
const CARD = 2;
const STRIPE = 3;
const LOGO = 4;
const GRID = 5;
const CARD2 = 6;
const BAND = 7;
const BAND_LINE = 8;
const RIM = 9;

export function renderLabCardScene(scene: LabCardScene): RenderedLabCardScene {
  const { width: W, height: H } = scene;
  const cam = sceneCamera(scene);
  const toTable = inv(cam.tableToImage);

  const paperW = scene.paperMm?.width ?? 210;
  const paperH = scene.paperMm?.height ?? 297;
  const po =
    scene.paperOriginMm === undefined ? { x: 0, y: 0 } : scene.paperOriginMm;
  const cc = scene.cardCentreMm ?? null;
  const ang = ((scene.cardAngleDeg ?? 0) * Math.PI) / 180;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const a = ID1.long / 2;
  const b = ID1.short / 2;
  const r = scene.cardRadiusMm ?? 3.18;
  const cardRgb = scene.cardRgb ?? [60, 90, 150];
  const bgKind = scene.background ?? "grey";

  const second = scene.secondCard ?? null;
  const ang2 = second ? (second.angleDeg * Math.PI) / 180 : 0;
  const ca2 = Math.cos(ang2);
  const sa2 = Math.sin(ang2);
  /** Inside a rounded a x b card (half-sizes) at `c` rotated by (cos, sin)? */
  function inCard(
    x: number,
    y: number,
    c: Pt,
    cs: number,
    sn: number,
  ): { u: number; v: number } | null {
    const dx = x - c.x;
    const dy = y - c.y;
    const u = dx * cs + dy * sn;
    const v = -dx * sn + dy * cs;
    if (Math.abs(u) > a || Math.abs(v) > b) return null;
    const qx = Math.abs(u) - (a - r);
    const qy = Math.abs(v) - (b - r);
    return !(qx > 0 && qy > 0) || qx * qx + qy * qy <= r * r ? { u, v } : null;
  }

  const inPaperRect = (x: number, y: number) =>
    po !== null &&
    x >= po.x &&
    x <= po.x + paperW &&
    y >= po.y &&
    y <= po.y + paperH;

  function material(x: number, y: number): number {
    if (cc && !(scene.paperOverCard && inPaperRect(x, y))) {
      const dx = x - cc.x;
      const dy = y - cc.y;
      const u = dx * ca + dy * sa;
      const v = -dx * sa + dy * ca;
      if (Math.abs(u) <= a && Math.abs(v) <= b) {
        const qx = Math.abs(u) - (a - r);
        const qy = Math.abs(v) - (b - r);
        const inside = !(qx > 0 && qy > 0) || qx * qx + qy * qy <= r * r;
        if (inside) {
          if (scene.cardRim) {
            // Distance in from the rounded outline.
            const w = scene.cardRim.widthMm;
            const inner =
              Math.abs(u) <= a - w &&
              Math.abs(v) <= b - w &&
              (!(qx > -w && qy > -w) ||
                Math.hypot(Math.max(0, qx), Math.max(0, qy)) <= r - w);
            if (!inner) return RIM;
          }
          if (scene.cardBand && v <= -b + scene.cardBand.widthMm) return BAND;
          if (
            scene.cardBand?.line &&
            v <= -b + scene.cardBand.widthMm + scene.cardBand.line.widthMm
          ) {
            return BAND_LINE;
          }
          if (scene.cardStripe && v >= -b + 5.5 && v <= -b + 5.5 + 12.7) {
            return STRIPE;
          }
          if (scene.cardLogo) {
            const rr = Math.hypot(u, v);
            if (
              (rr >= 9 && rr <= 12) ||
              (Math.abs(v) <= 2.5 && Math.abs(u) <= 16)
            ) {
              return LOGO;
            }
          }
          return CARD;
        }
      }
    }
    if (second && inCard(x, y, second.centreMm, ca2, sa2)) return CARD2;
    if (
      po &&
      x >= po.x &&
      x <= po.x + paperW &&
      y >= po.y &&
      y <= po.y + paperH
    ) {
      if (scene.paperHoles) {
        const hx = po.x + 7;
        const k = Math.round((y - po.y - 10) / 9.5);
        const hy = po.y + 10 + 9.5 * k;
        if (
          k >= 0 &&
          hy <= po.y + paperH - 10 &&
          Math.hypot(x - hx, y - hy) <= 3
        ) {
          return BG;
        }
      }
      const g = scene.paperGridMm ?? 0;
      if (g > 0) {
        const fx = (x - po.x) / g;
        const fy = (y - po.y) / g;
        const lw = 0.25 / g;
        if (
          Math.abs(fx - Math.round(fx)) < lw ||
          Math.abs(fy - Math.round(fy)) < lw
        ) {
          return GRID;
        }
      }
      return PAPER;
    }
    return BG;
  }

  function colour(m: number, x: number, y: number, out: number[]): void {
    if (m === CARD2 && second) {
      out[0] = second.rgb[0];
      out[1] = second.rgb[1];
      out[2] = second.rgb[2];
    } else if (m === CARD) {
      let glare = 0;
      if (scene.cardGlare && cc) {
        const u = (x - cc.x) * ca + (y - cc.y) * sa;
        glare = (scene.cardGlare * Math.max(0, u)) / a;
      }
      out[0] = Math.min(255, cardRgb[0] + glare);
      out[1] = Math.min(255, cardRgb[1] + glare);
      out[2] = Math.min(255, cardRgb[2] + glare);
    } else if (m === RIM && scene.cardRim) {
      out[0] = scene.cardRim.rgb[0];
      out[1] = scene.cardRim.rgb[1];
      out[2] = scene.cardRim.rgb[2];
    } else if (m === BAND && scene.cardBand) {
      out[0] = scene.cardBand.rgb[0];
      out[1] = scene.cardBand.rgb[1];
      out[2] = scene.cardBand.rgb[2];
    } else if (m === BAND_LINE && scene.cardBand?.line) {
      out[0] = scene.cardBand.line.rgb[0];
      out[1] = scene.cardBand.line.rgb[1];
      out[2] = scene.cardBand.line.rgb[2];
    } else if (m === LOGO) {
      out[0] = 245;
      out[1] = 240;
      out[2] = 230;
    } else if (m === GRID) {
      out[0] = 200;
      out[1] = 203;
      out[2] = 206;
    } else if (m === STRIPE) {
      out[0] = 25;
      out[1] = 25;
      out[2] = 30;
    } else if (m === PAPER) {
      const shade = 238 - 0.03 * y;
      out[0] = shade;
      out[1] = shade;
      out[2] = shade - 3;
    } else if (bgKind === "wood") {
      // Low-frequency grain: stripes ~9 mm apart, gently wavy, plus a slow drift.
      const g =
        0.5 +
        0.5 *
          Math.sin((y + 6 * Math.sin(x / 37)) / 1.4) *
          Math.sin(x / 90 + 0.3);
      out[0] = 150 + 35 * g;
      out[1] = 100 + 25 * g;
      out[2] = 60 + 15 * g;
    } else if (bgKind === "maze") {
      // Red lines 1.2 mm wide every 5 mm, vertical in one 10 mm row and
      // diagonal in the next.
      const row = Math.floor(y / 10);
      const u = row % 2 === 0 ? x : x + y;
      const red = ((u % 5) + 5) % 5 < 1.2;
      out[0] = red ? 150 : 35;
      out[1] = red ? 30 : 30;
      out[2] = red ? 35 : 32;
    } else if (bgKind === "darkMaze") {
      // Chevrons 1.5 mm wide every 6 mm, the direction flipping every 8 mm.
      const row = Math.floor(y / 8);
      const u = row % 2 === 0 ? x - y : x + y;
      const plain = scene.darkMazePlain;
      const inPlain = (m: number) =>
        plain !== undefined &&
        x >= plain.x0 - m &&
        x <= plain.x1 + m &&
        y >= plain.y0 - m &&
        y <= plain.y1 + m;
      // A brighter 2 mm seam around the plain patch.
      if (inPlain(2) && !inPlain(0)) {
        out[0] = 125;
        out[1] = 108;
        out[2] = 102;
        return;
      }
      const line = ((u % 6) + 6) % 6 < 1.5 && !inPlain(0);
      out[0] = line ? 98 : 74;
      out[1] = line ? 88 : 68;
      out[2] = line ? 85 : 67;
    } else if (bgKind === "dark") {
      out[0] = 38;
      out[1] = 36;
      out[2] = 40;
    } else {
      out[0] = 120;
      out[1] = 120;
      out[2] = 124;
    }
  }

  // Material at every pixel corner; a pixel whose 4 corners agree is flat.
  const gw = W + 1;
  const corner = new Uint8Array(gw * (H + 1));
  for (let j = 0; j <= H; j++) {
    for (let i = 0; i <= W; i++) {
      const p = applyMat(toTable, { x: i, y: j });
      corner[j * gw + i] = material(p.x, p.y);
    }
  }

  const rgb = new Float32Array(W * H * 3);
  const c = [0, 0, 0];
  const SS = 6;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const m00 = corner[j * gw + i];
      const flat =
        m00 === corner[j * gw + i + 1] &&
        m00 === corner[(j + 1) * gw + i] &&
        m00 === corner[(j + 1) * gw + i + 1];
      const o = (j * W + i) * 3;
      if (flat) {
        const p = applyMat(toTable, { x: i + 0.5, y: j + 0.5 });
        colour(m00, p.x, p.y, c);
        rgb[o] = c[0];
        rgb[o + 1] = c[1];
        rgb[o + 2] = c[2];
      } else {
        let s0 = 0;
        let s1 = 0;
        let s2 = 0;
        for (let sj = 0; sj < SS; sj++) {
          for (let si = 0; si < SS; si++) {
            const p = applyMat(toTable, {
              x: i + (si + 0.5) / SS,
              y: j + (sj + 0.5) / SS,
            });
            colour(material(p.x, p.y), p.x, p.y, c);
            s0 += c[0];
            s1 += c[1];
            s2 += c[2];
          }
        }
        const n = SS * SS;
        rgb[o] = s0 / n;
        rgb[o + 1] = s1 / n;
        rgb[o + 2] = s2 / n;
      }
    }
  }

  const blurred = scene.blurSigmaPx
    ? gaussianBlur(rgb, W, H, scene.blurSigmaPx)
    : rgb;

  const data = new Uint8ClampedArray(W * H * 4);
  const rand = mulberry(scene.seed ?? 1);
  const noise = scene.noiseSigma ?? 0;
  for (let k = 0; k < W * H; k++) {
    for (let ch = 0; ch < 3; ch++) {
      let v = blurred[k * 3 + ch];
      if (noise > 0) {
        const u1 = Math.max(rand(), 1e-12);
        const u2 = rand();
        v += noise * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      }
      data[k * 4 + ch] = Math.round(v);
    }
    data[k * 4 + 3] = 255;
  }

  const cardCornersPx = cc
    ? (
        [
          [-a, -b],
          [a, -b],
          [a, b],
          [-a, b],
        ] as const
      ).map(([u, v]) =>
        applyMat(cam.tableToImage, {
          x: cc.x + u * ca - v * sa,
          y: cc.y + u * sa + v * ca,
        }),
      )
    : null;
  const secondCardCornersPx = second
    ? (
        [
          [-a, -b],
          [a, -b],
          [a, b],
          [-a, b],
        ] as const
      ).map(([u, v]) =>
        applyMat(cam.tableToImage, {
          x: second.centreMm.x + u * ca2 - v * sa2,
          y: second.centreMm.y + u * sa2 + v * ca2,
        }),
      )
    : null;
  const paperCornersPx = po
    ? [
        { x: po.x, y: po.y },
        { x: po.x + paperW, y: po.y },
        { x: po.x + paperW, y: po.y + paperH },
        { x: po.x, y: po.y + paperH },
      ].map((p) => applyMat(cam.tableToImage, p))
    : null;

  return {
    width: W,
    height: H,
    data,
    tableToImage: cam.tableToImage,
    R: cam.R,
    cx: W / 2,
    cy: H / 2,
    cardCornersPx,
    secondCardCornersPx,
    paperCornersPx,
  };
}

function gaussianBlur(
  src: Float32Array,
  W: number,
  H: number,
  sigma: number,
): Float32Array {
  const rad = Math.ceil(sigma * 3);
  const k: number[] = [];
  let sum = 0;
  for (let i = -rad; i <= rad; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k.push(v);
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (let ch = 0; ch < 3; ch++) {
        let s = 0;
        for (let i = -rad; i <= rad; i++) {
          const xx = Math.min(W - 1, Math.max(0, x + i));
          s += k[i + rad] * src[(y * W + xx) * 3 + ch];
        }
        tmp[(y * W + x) * 3 + ch] = s;
      }
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (let ch = 0; ch < 3; ch++) {
        let s = 0;
        for (let i = -rad; i <= rad; i++) {
          const yy = Math.min(H - 1, Math.max(0, y + i));
          s += k[i + rad] * tmp[(yy * W + x) * 3 + ch];
        }
        out[(y * W + x) * 3 + ch] = s;
      }
    }
  }
  return out;
}

/**
 * Smallest of the four cyclic matchings' worst corner distance between
 * `found` and `truth` (either may start at any corner; same winding).
 * Returns per-corner distances for the best matching.
 */
export function cornerErrorsPx(
  found: readonly Pt[],
  truth: readonly Pt[],
): { max: number; each: number[] } {
  let best: { max: number; each: number[] } | null = null;
  for (const dir of [1, -1]) {
    for (let s = 0; s < 4; s++) {
      const each = [0, 1, 2, 3].map((i) => {
        const t = truth[(((s + dir * i) % 4) + 4) % 4];
        return Math.hypot(found[i].x - t.x, found[i].y - t.y);
      });
      const max = Math.max(...each);
      if (!best || max < best.max) best = { max, each };
    }
  }
  return best as { max: number; each: number[] };
}
