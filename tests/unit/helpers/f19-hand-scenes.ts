/**
 * V3.2 F19: synthetic scenes of a blank A4 sheet seen straight down with a
 * hand lying on it and the forearm running off it, every one SIMULATED (模擬).
 * The renderer knows the true corners and the hand's 21 landmarks, so a test
 * can ask what the detector finds with and without the hand.
 *
 * Skin is drawn in a skin colour (saturated, so the detector's saturation
 * gate already leaves it out of the sheet, as in a real photo). A soft shadow
 * darkens the sheet next to the hand and arm: its darkest part falls under
 * the detector's brightness threshold and its edge is ragged, which is what
 * puts stray boundary points next to a covered edge.
 */
import type { Point2 } from "../../../src/client/geometry/homography";
import { mulberry32 } from "../../../src/client/paper/quad-math";

const SHEET_W_MM = 210;
const SHEET_H_MM = 297;

/**
 * A right hand's 21 MediaPipe landmarks in mm, wrist at the origin and the
 * fingers pointing to -y (up the sheet). Typical adult proportions (hand
 * length about 183 mm, palm width 5 to 17 about 59 mm); a test fixture, not a
 * measurement.
 */
const HAND_MM: readonly Point2[] = [
  { x: 0, y: 0 },
  { x: -25, y: -15 },
  { x: -40, y: -35 },
  { x: -52, y: -55 },
  { x: -60, y: -72 },
  { x: -28, y: -95 },
  { x: -30, y: -130 },
  { x: -31, y: -152 },
  { x: -32, y: -172 },
  { x: -8, y: -98 },
  { x: -8, y: -138 },
  { x: -8, y: -162 },
  { x: -8, y: -183 },
  { x: 12, y: -93 },
  { x: 14, y: -128 },
  { x: 15, y: -150 },
  { x: 16, y: -168 },
  { x: 30, y: -83 },
  { x: 33, y: -108 },
  { x: 35, y: -124 },
  { x: 36, y: -140 },
];

export interface HandSceneOptions {
  readonly width?: number;
  readonly height?: number;
  /** The sheet's long side as a fraction of the frame's height. */
  readonly fill?: number;
  /** Where the wrist lies, in sheet mm (x across the 210 mm side, y down the 297 mm side). */
  readonly wristMm: Point2;
  /** The hand's turn in degrees, clockwise on screen; 0 = fingers up the sheet, 90 = fingers to the right. */
  readonly handDeg?: number;
  /** The forearm's direction in degrees on screen, measured like `handDeg` (0 = the arm runs down from the wrist). Defaults to `handDeg`. */
  readonly armDeg?: number;
  /** The forearm's radius in mm. */
  readonly armRadiusMm?: number;
  /** How far the soft shadow reaches past the skin, in mm (0 for none). */
  readonly shadowMm?: number;
  /** The shadow's darkest factor at the skin's edge (paper brightness × this). */
  readonly shadowDarkest?: number;
  /** A bow of this many mm on one side (0 = top, 1 = right, 2 = bottom, 3 = left), outward. */
  readonly curl?: { readonly side: 0 | 1 | 2 | 3; readonly amplitudeMm: number };
  /** The skin's colour; the default is saturated enough for the detector's saturation gate to leave it out. A pale, low-saturation one (in bright light) is not. */
  readonly skinRgb?: readonly [number, number, number];
  /** The shadow drawn this many mm away from the skin along +x/+y (a hand or arm held above the sheet casts it off to one side). */
  readonly shadowOffsetMm?: Point2;
  /** No hand drawn at all (the same sheet, for a reference). */
  readonly noHand?: boolean;
  readonly seed?: number;
}

export interface HandScene {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  /** The sheet's true corners TL, TR, BR, BL in px (the flat sheet's; a bow bulges past them). */
  readonly corners: readonly [Point2, Point2, Point2, Point2];
  /** The hand's 21 landmarks in px. */
  readonly landmarksPx: readonly Point2[];
  /** px per sheet mm. */
  readonly pxPerMm: number;
}

function rotate(p: Point2, deg: number): Point2 {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: c * p.x - s * p.y, y: s * p.x + c * p.y };
}

/** Distance from `p` to the segment `a`-`b`. */
function segDist(p: Point2, a: Point2, b: Point2): number {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const l2 = ex * ex + ey * ey || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l2));
  return Math.hypot(p.x - (a.x + t * ex), p.y - (a.y + t * ey));
}

function smoothstep(lo: number, hi: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/** Renders one scene. Deterministic for a given `seed`. */
export function renderHandScene(o: HandSceneOptions): HandScene {
  const W = o.width ?? 540;
  const H = o.height ?? 960;
  const s = ((o.fill ?? 0.7) * H) / SHEET_H_MM;
  const ox = (W - SHEET_W_MM * s) / 2;
  const oy = (H - SHEET_H_MM * s) / 2;
  const toPx = (p: Point2): Point2 => ({ x: ox + p.x * s, y: oy + p.y * s });
  const handDeg = o.handDeg ?? 0;
  const armDeg = o.armDeg ?? handDeg;
  const handMm = HAND_MM.map((p) => {
    const r = rotate(p, handDeg);
    return { x: r.x + o.wristMm.x, y: r.y + o.wristMm.y };
  });
  const armDir = rotate({ x: 0, y: 1 }, armDeg);
  const armEnd = {
    x: o.wristMm.x + armDir.x * 2000,
    y: o.wristMm.y + armDir.y * 2000,
  };
  const armRadius = o.armRadiusMm ?? 32;
  // Skin as capsules (mm): palm web, fingers, thumb, forearm.
  const capsules: [Point2, Point2, number][] = [];
  if (!o.noHand) {
    const palmRing = [0, 1, 5, 9, 13, 17];
    for (let i = 0; i < palmRing.length; i++)
      for (let j = i + 1; j < palmRing.length; j++)
        capsules.push([handMm[palmRing[i]!]!, handMm[palmRing[j]!]!, 10]);
    for (const chain of [
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10, 11, 12],
      [13, 14, 15, 16],
      [17, 18, 19, 20],
    ])
      for (let k = 0; k + 1 < chain.length; k++)
        capsules.push([handMm[chain[k]!]!, handMm[chain[k + 1]!]!, 8.5]);
    capsules.push([handMm[0]!, armEnd, armRadius]);
  }
  const shadowMm = o.shadowMm ?? 6;
  const darkest = o.shadowDarkest ?? 0.55;
  const bow = (side: number, t: number) =>
    o.curl && o.curl.side === side
      ? o.curl.amplitudeMm * Math.sin(Math.PI * t)
      : 0;

  const rng = mulberry32(o.seed ?? 19);
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const mm = { x: (x + 0.5 - ox) / s, y: (y + 0.5 - oy) / s };
      // Signed distance inside the (possibly bowed) sheet, in px.
      const tX = Math.min(1, Math.max(0, mm.x / SHEET_W_MM));
      const tY = Math.min(1, Math.max(0, mm.y / SHEET_H_MM));
      const inside =
        Math.min(
          mm.y + bow(0, tX),
          SHEET_W_MM + bow(1, tY) - mm.x,
          SHEET_H_MM + bow(2, tX) - mm.y,
          mm.x + bow(3, tY),
        ) * s;
      const paperAlpha = smoothstep(-0.6, 0.6, inside);
      let r = 95;
      let g = 95;
      let b = 98;
      const light = 1 + 0.04 * Math.sin((x / W) * 3 + (y / H) * 2);
      let pr = 236 * light;
      let skinOut = Infinity;
      for (const [a, c, rad] of capsules)
        skinOut = Math.min(skinOut, segDist(mm, a, c) - rad);
      let shadowOut = skinOut;
      if (o.shadowOffsetMm) {
        const sm = { x: mm.x - o.shadowOffsetMm.x, y: mm.y - o.shadowOffsetMm.y };
        shadowOut = Infinity;
        for (const [a, c, rad] of capsules)
          shadowOut = Math.min(shadowOut, segDist(sm, a, c) - rad);
      }
      if (shadowMm > 0 && shadowOut < shadowMm) {
        const t = Math.max(0, shadowOut) / shadowMm;
        pr *= darkest + (1 - darkest) * t;
      }
      r = r * (1 - paperAlpha) + pr * paperAlpha;
      g = g * (1 - paperAlpha) + pr * paperAlpha;
      b = b * (1 - paperAlpha) + pr * paperAlpha;
      const skinAlpha = smoothstep(-0.6, 0.6, -skinOut * s);
      const skin = o.skinRgb ?? [205, 150, 125];
      r = r * (1 - skinAlpha) + skin[0] * skinAlpha;
      g = g * (1 - skinAlpha) + skin[1] * skinAlpha;
      b = b * (1 - skinAlpha) + skin[2] * skinAlpha;
      const n = (rng() - 0.5) * 6;
      const i = (y * W + x) * 4;
      data[i] = r + n;
      data[i + 1] = g + n;
      data[i + 2] = b + n;
      data[i + 3] = 255;
    }
  }
  const corners = [
    { x: 0, y: 0 },
    { x: SHEET_W_MM, y: 0 },
    { x: SHEET_W_MM, y: SHEET_H_MM },
    { x: 0, y: SHEET_H_MM },
  ].map(toPx) as unknown as [Point2, Point2, Point2, Point2];
  return {
    width: W,
    height: H,
    data,
    corners,
    landmarksPx: handMm.map(toPx),
    pxPerMm: s,
  };
}
