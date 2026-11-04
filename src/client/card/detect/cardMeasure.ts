/**
 * Scan Lab (L3a, 2026-10-29): three ways to put the card's scale on the
 * sheet, each read against the sheet's true size (A4 = 210 x 297 mm), which
 * is the lab's ground truth (`scan-lab-2026-10-29/PROGRAM.md` §3). Lab only;
 * nothing in the real scan flow calls these.
 *
 * (1) `measurePaperWithCardHomography` — card only: the card's 4 corners
 *     give an image -> card-mm homography; the sheet's corners go through it.
 *     Lengths, not positions, are compared, so the card's own position and
 *     rotation on the table do not matter.
 * (2) `measurePaperWithCardAndTilt` — card + phone tilt: the tilt sensor's
 *     camera rotation un-tilts the image (a pure-rotation homography, so the
 *     table becomes fronto-parallel), then a SIMILARITY (scale + rotation +
 *     translation, 4 dof) is fitted from the card's 4 corners to card mm. The
 *     card no longer has to pin down perspective, which is what makes (1)
 *     noisy (research report §3: 4 corners on an 86 mm card extrapolated to
 *     a 297 mm sheet).
 * (3) `cardScaleRatioAgainstPaper` — the reverse check: the sheet's
 *     homography measures the card (`geometry/card-scale.ts`).
 *
 * Coordinates: image px (x right, y down, pixel centres at +0.5); mm on the
 * table plane. Corner quads are TL, TR, BR, BL in the image (any start works
 * for lengths as long as the order goes round the quad).
 */
import { ID1_CARD_MM } from "../../../lib/contracts/measurement";
import {
  computeCardScaleRatio,
  type CardCorners,
} from "../../geometry/card-scale";
import {
  applyHomography,
  estimateHomography,
  invert3x3,
  multiply3x3,
  type Homography,
  type Point2,
} from "../../geometry/homography";
import type { Intrinsics, Mat3, Vec3 } from "../../geometry/camera-pose";
import { resolveOrientation } from "../../paper/orientation";
import type { Quad } from "./coarse";

/** A sheet's true size, mm (e.g. `PAPER_DIMENSIONS_MM.a4` in `paper/detect.ts`). */
export interface PaperTrueSizeMm {
  readonly shortMm: number;
  readonly longMm: number;
}

/** Measured sheet size and its error against the true size. Errors are measured - true. */
export interface PaperMeasurement {
  /** Mean of the two long sides, mm. */
  readonly longMm: number;
  /** Mean of the two short sides, mm. */
  readonly shortMm: number;
  /** Mean of the two diagonals, mm. */
  readonly diagonalMm: number;
  readonly longErrorMm: number;
  readonly shortErrorMm: number;
  readonly diagonalErrorMm: number;
  /** Error as a percentage of the true length. */
  readonly longErrorPct: number;
  readonly shortErrorPct: number;
  readonly diagonalErrorPct: number;
}

function dist(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Lengths of a quad already in mm (TL, TR, BR, BL), compared with `truth`.
 * The longer opposite pair is taken as the long side. Pure.
 */
export function paperMeasurementFromMmQuad(
  mm: Quad,
  truth: PaperTrueSizeMm,
): PaperMeasurement {
  const a = (dist(mm[0], mm[1]) + dist(mm[2], mm[3])) / 2;
  const b = (dist(mm[1], mm[2]) + dist(mm[3], mm[0])) / 2;
  const longMm = Math.max(a, b);
  const shortMm = Math.min(a, b);
  const diagonalMm = (dist(mm[0], mm[2]) + dist(mm[1], mm[3])) / 2;
  const trueDiag = Math.hypot(truth.longMm, truth.shortMm);
  return {
    longMm,
    shortMm,
    diagonalMm,
    longErrorMm: longMm - truth.longMm,
    shortErrorMm: shortMm - truth.shortMm,
    diagonalErrorMm: diagonalMm - trueDiag,
    longErrorPct: ((longMm - truth.longMm) / truth.longMm) * 100,
    shortErrorPct: ((shortMm - truth.shortMm) / truth.shortMm) * 100,
    diagonalErrorPct: ((diagonalMm - trueDiag) / trueDiag) * 100,
  };
}

/** Whether the image's TL->TR pair is the longer one in PIXELS (see `rectangleMmFor`). */
export function pixelLongSideFirst(imageQuad: Quad): boolean {
  const a = dist(imageQuad[0], imageQuad[1]) + dist(imageQuad[2], imageQuad[3]);
  const b = dist(imageQuad[1], imageQuad[2]) + dist(imageQuad[3], imageQuad[0]);
  return a >= b;
}

/**
 * The rectangle's mm corners matching an image quad (TL, TR, BR, BL). (0,0)
 * at TL, x along TL->TR, y along TL->BL.
 *
 * `longSideFirst` says whether TL->TR is the rectangle's LONG side. Omitted,
 * the image's longer opposite pair in pixels is taken (portrait and landscape
 * both work), which is only safe near a straight-down view: foreshortening
 * flips the pixel order above about 46 degrees of tilt for A4 and about 51
 * for an ID-1 card (L3b review, 2026-10-29). Callers with a focal length pass
 * the focal-aware answer (`resolveRectangleOrientation`).
 */
export function rectangleMmFor(
  imageQuad: Quad,
  longMm: number,
  shortMm: number,
  longSideFirst: boolean = pixelLongSideFirst(imageQuad),
): Quad {
  const w = longSideFirst ? longMm : shortMm;
  const h = longSideFirst ? shortMm : longMm;
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}

const CARD_LONG_MM = Math.max(ID1_CARD_MM.width, ID1_CARD_MM.height);
const CARD_SHORT_MM = Math.min(ID1_CARD_MM.width, ID1_CARD_MM.height);

/** A card's real size, mm. */
export interface CardSizeMm {
  readonly longMm: number;
  readonly shortMm: number;
}

/** ISO/IEC 7810 ID-1 (85.6 x 53.98 mm), the default card. */
export const ID1_CARD_SIZE_MM: CardSizeMm = {
  longMm: CARD_LONG_MM,
  shortMm: CARD_SHORT_MM,
};

/**
 * Options the three measures share (L3b, 2026-10-29; all optional, so a call
 * without them is exactly what it was).
 * - `card`: the card's real size (a store or transit card need not be
 *   exactly ID-1); default ID-1.
 * - `cardLongSideFirst` / `paperLongSideFirst`: whether the quad's TL->TR
 *   side is that rectangle's LONG side; default the pixel order
 *   (`rectangleMmFor`), which is wrong at steep tilts.
 */
export interface MeasureOptions {
  readonly card?: CardSizeMm;
  readonly cardLongSideFirst?: boolean;
  readonly paperLongSideFirst?: boolean;
}

export interface RectangleOrientation {
  /** TL->TR is the long side, judged with the focal length (orientation.ts). */
  readonly longSideFirst: boolean;
  /** The same judged by pixel lengths only (`pixelLongSideFirst`). */
  readonly pixelLongSideFirst: boolean;
  /** How rectangle-like the quad is at that focal (0 perfect; orientation.ts). */
  readonly residual: number;
}

/**
 * Which of a quad's two axes is the rectangle's long side, using the focal
 * length (orientation.ts `resolveOrientation`: the hypothesis whose 3D
 * edges come out perpendicular and equally scaled wins). Unlike the pixel
 * order, this does not flip under steep foreshortening. `null` for
 * degenerate corners. Pure.
 */
export function resolveRectangleOrientation(
  imageQuad: Quad,
  size: { readonly longMm: number; readonly shortMm: number },
  intrinsics: Intrinsics,
): RectangleOrientation | null {
  const r = resolveOrientation(
    imageQuad,
    size.shortMm,
    size.longMm,
    { x: intrinsics.cx, y: intrinsics.cy },
    intrinsics.fPx,
  );
  if (!r) return null;
  return {
    // rotateBy1: TL->TR (as given) is the paper's LONG side.
    longSideFirst: r.rotateBy1,
    pixelLongSideFirst: pixelLongSideFirst(imageQuad),
    residual: r.residual,
  };
}

/** Image px -> card mm homography from the card's 4 corners. Pure. */
export function cardHomography(
  cardCorners: Quad,
  options: MeasureOptions = {},
): Homography {
  const card = options.card ?? ID1_CARD_SIZE_MM;
  const mm = rectangleMmFor(
    cardCorners,
    card.longMm,
    card.shortMm,
    options.cardLongSideFirst,
  );
  return estimateHomography(cardCorners.map((src, i) => ({ src, dst: mm[i] })));
}

/**
 * Method (1), card only. `cardCorners` and `paperCorners` are image px;
 * `paperTrue` the sheet's real size. Throws RangeError for degenerate corners.
 */
export function measurePaperWithCardHomography(
  cardCorners: Quad,
  paperCorners: Quad,
  paperTrue: PaperTrueSizeMm,
  options: MeasureOptions = {},
): PaperMeasurement {
  const h = cardHomography(cardCorners, options);
  const mm = paperCorners.map((p) => applyHomography(h, p));
  return paperMeasurementFromMmQuad([mm[0], mm[1], mm[2], mm[3]], paperTrue);
}

// ── Method (2): card + tilt ──────────────────────────────────────────────

/**
 * The camera's rotation relative to the table, from the phone's sensors.
 * All three forms reduce to one thing: the direction of straight DOWN
 * (gravity, the table's normal into the table) in the camera frame, where
 * the camera frame is camera-pose.ts's: X right, Y down (both as in the
 * image), Z forward along the optical axis.
 *
 * - `tilt-azimuth`: `tiltDeg` is the angle between the optical axis and
 *   straight down (0 = looking straight down). `azimuthDeg` says which way
 *   the camera leans, as the direction in the IMAGE (x right, y down; 0 = +x,
 *   90 = +y, i.e. measured from +x toward +y) in which the nadir — the table
 *   point straight below the camera — appears, seen from the principal point.
 *   The nadir is at principal point + f*tan(tilt)*(cos az, sin az) px. So a
 *   phone whose top edge leans away from the table, looking a little ahead,
 *   sees the nadir toward the bottom of the image: azimuth 90.
 * - `down-vector`: that down direction directly, camera frame, any length.
 * - `rotation`: a world -> camera rotation in camera-pose.ts's convention
 *   (world Zw points UP from the table), e.g. `recoverCameraPose(...).R`;
 *   down is then -(third column of R).
 *
 * Converting the browser's DeviceMotion gravity / DeviceOrientation angles
 * (device axes: x right, y up the screen, z out of the screen) into this
 * frame is the tilt module's job (L1), not this one's; for the rear camera
 * in portrait it is camera = (x_dev, -y_dev, -z_dev).
 */
export type CameraTilt =
  | {
      readonly kind: "tilt-azimuth";
      readonly tiltDeg: number;
      readonly azimuthDeg: number;
    }
  | { readonly kind: "down-vector"; readonly down: Vec3 }
  | { readonly kind: "rotation"; readonly R: Mat3 };

/** Unit "straight down" in the camera frame for any `CameraTilt` form. Throws RangeError for a zero vector. */
export function downInCamera(tilt: CameraTilt): Vec3 {
  let v: Vec3;
  if (tilt.kind === "tilt-azimuth") {
    const t = (tilt.tiltDeg * Math.PI) / 180;
    const a = (tilt.azimuthDeg * Math.PI) / 180;
    v = [Math.sin(t) * Math.cos(a), Math.sin(t) * Math.sin(a), Math.cos(t)];
  } else if (tilt.kind === "down-vector") {
    v = tilt.down;
  } else {
    v = [-tilt.R[0][2], -tilt.R[1][2], -tilt.R[2][2]];
  }
  const n = Math.hypot(v[0], v[1], v[2]);
  if (!(n > 1e-12)) {
    throw new RangeError("downInCamera: zero-length down vector.");
  }
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** Tilt (deg from straight down) and azimuth (deg, image x toward y) of a down vector; the inverse of the `tilt-azimuth` form. */
export function tiltAzimuthOf(down: Vec3): {
  readonly tiltDeg: number;
  readonly azimuthDeg: number;
} {
  const n = Math.hypot(down[0], down[1], down[2]);
  const tiltDeg =
    (Math.acos(Math.max(-1, Math.min(1, down[2] / n))) * 180) / Math.PI;
  const azimuthDeg = (Math.atan2(down[1], down[0]) * 180) / Math.PI;
  return { tiltDeg, azimuthDeg };
}

/**
 * Image px -> "virtual straight-down camera" px: K * Q * K^-1, where Q is the
 * smallest rotation taking `down` onto the optical axis (0, 0, 1). Same K for
 * both cameras, so at zero tilt this is the identity. After it, the table is
 * fronto-parallel: image -> table is a similarity. Pure.
 */
export function rectifyingHomography(
  down: Vec3,
  intrinsics: Intrinsics,
): Homography {
  const [x, y, z] = down;
  // axis = down x (0,0,1) = (y, -x, 0); sin = |axis|, cos = z.
  const s = Math.hypot(x, y);
  let Q: Mat3;
  if (s < 1e-12) {
    Q = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
  } else {
    const kx = y / s;
    const ky = -x / s;
    const c = z;
    const C = 1 - c;
    Q = [
      [c + kx * kx * C, kx * ky * C, ky * s],
      [ky * kx * C, c + ky * ky * C, -kx * s],
      [-ky * s, kx * s, c],
    ];
  }
  const { fPx, cx, cy } = intrinsics;
  const K: Mat3 = [
    [fPx, 0, cx],
    [0, fPx, cy],
    [0, 0, 1],
  ];
  return multiply3x3(multiply3x3(K, Q), invert3x3(K));
}

/** Least-squares 2D similarity `dst ~ s*Rot*src + t` (Umeyama, no reflection). */
export interface Similarity2 {
  /** Scale (dst units per src unit). */
  readonly scale: number;
  /** Rotation, radians. */
  readonly angle: number;
  readonly tx: number;
  readonly ty: number;
  /** RMS of the fitted residuals, dst units. */
  readonly rms: number;
}

/** Fit a similarity from ≥2 point pairs. Pure; throws RangeError for coincident `src`. */
export function fitSimilarity(
  src: readonly Point2[],
  dst: readonly Point2[],
): Similarity2 {
  const n = src.length;
  let sx = 0;
  let sy = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    sx += src[i].x;
    sy += src[i].y;
    dx += dst[i].x;
    dy += dst[i].y;
  }
  sx /= n;
  sy /= n;
  dx /= n;
  dy /= n;
  let a = 0;
  let b = 0;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const px = src[i].x - sx;
    const py = src[i].y - sy;
    const qx = dst[i].x - dx;
    const qy = dst[i].y - dy;
    a += px * qx + py * qy;
    b += px * qy - py * qx;
    ss += px * px + py * py;
  }
  if (!(ss > 1e-12)) {
    throw new RangeError("fitSimilarity: source points coincide.");
  }
  const scale = Math.hypot(a, b) / ss;
  const angle = Math.atan2(b, a);
  const cs = Math.cos(angle) * scale;
  const sn = Math.sin(angle) * scale;
  const tx = dx - (cs * sx - sn * sy);
  const ty = dy - (sn * sx + cs * sy);
  let err = 0;
  for (let i = 0; i < n; i++) {
    const ex = cs * src[i].x - sn * src[i].y + tx - dst[i].x;
    const ey = sn * src[i].x + cs * src[i].y + ty - dst[i].y;
    err += ex * ex + ey * ey;
  }
  return { scale, angle, tx, ty, rms: Math.sqrt(err / n) };
}

function applySimilarity(t: Similarity2, p: Point2): Point2 {
  const cs = Math.cos(t.angle) * t.scale;
  const sn = Math.sin(t.angle) * t.scale;
  return { x: cs * p.x - sn * p.y + t.tx, y: sn * p.x + cs * p.y + t.ty };
}

/** Method (2)'s result: the sheet's size and error, plus the card fit's self-check. */
export interface TiltMeasurement extends PaperMeasurement {
  /**
   * RMS distance, mm, between the card's 4 corners and the true card
   * rectangle after the similarity fit. Near 0 when the tilt is right and the
   * corners are clean; grows when the tilt is wrong (the un-tilted card is no
   * longer a rectangle) — a free self-check for the lab log.
   */
  readonly cardFitRmsMm: number;
  /** mm per un-tilted px at the card. */
  readonly mmPerPx: number;
}

/**
 * Method (2), card + tilt. `intrinsics.fPx` is the focal length in px of
 * THIS image (e.g. `nominalFocalShadow.ts`'s figure, or EXIF), `cx, cy` the
 * principal point (image centre if unknown: `centrePrincipalPoint`). Pure;
 * throws RangeError for degenerate input.
 */
export function measurePaperWithCardAndTilt(
  cardCorners: Quad,
  paperCorners: Quad,
  paperTrue: PaperTrueSizeMm,
  tilt: CameraTilt,
  intrinsics: Intrinsics,
  options: MeasureOptions = {},
): TiltMeasurement {
  const rect = rectifyingHomography(downInCamera(tilt), intrinsics);
  const card = cardCorners.map((p) => applyHomography(rect, p));
  const cardQuad: Quad = [card[0], card[1], card[2], card[3]];
  // After un-tilting the card is (nearly) fronto-parallel, so its pixel
  // order is its true order: no orientation option is needed here.
  const size = options.card ?? ID1_CARD_SIZE_MM;
  const mm = rectangleMmFor(cardQuad, size.longMm, size.shortMm);
  const sim = fitSimilarity(cardQuad, mm);
  const paperMm = paperCorners.map((p) =>
    applySimilarity(sim, applyHomography(rect, p)),
  );
  return {
    ...paperMeasurementFromMmQuad(
      [paperMm[0], paperMm[1], paperMm[2], paperMm[3]],
      paperTrue,
    ),
    cardFitRmsMm: sim.rms,
    mmPerPx: sim.scale,
  };
}

// ── Method (3): the sheet measures the card ──────────────────────────────

/** Method (3)'s result: the card measured through the sheet (mm, and the ratio to ID-1). */
export interface CardScaleCheck {
  /** `computeCardScaleRatio`: measured card size / true card size through the sheet's homography; 1 = agreement. */
  readonly cardScaleRatio: number;
  /** The card's long and short sides as the sheet's homography measures them (mean of each pair), mm. */
  readonly cardLongMm: number;
  readonly cardShortMm: number;
}

/**
 * Method (3): build the sheet's homography from its 4 corners and true size
 * (orientation from the image, like `rectangleMmFor`; `paper/homography.ts`'s
 * `buildPaperHomography` assumes portrait), and measure the card through it.
 */
export function cardScaleRatioAgainstPaper(
  cardCorners: Quad,
  paperCorners: Quad,
  paperTrue: PaperTrueSizeMm,
  options: MeasureOptions = {},
): CardScaleCheck {
  const mm = rectangleMmFor(
    paperCorners,
    paperTrue.longMm,
    paperTrue.shortMm,
    options.paperLongSideFirst,
  );
  const h = estimateHomography(
    paperCorners.map((src, i) => ({ src, dst: mm[i] })),
  );
  const card = cardCorners.map((p) => applyHomography(h, p));
  const a = (dist(card[0], card[1]) + dist(card[2], card[3])) / 2;
  const b = (dist(card[1], card[2]) + dist(card[3], card[0])) / 2;
  const size = options.card;
  return {
    // ID-1 keeps `computeCardScaleRatio` itself; another card's size uses
    // the same formula (the two shortest edges are the short side) on it.
    cardScaleRatio: size
      ? cardRatioFor(card, size)
      : computeCardScaleRatio(cardCorners as CardCorners, h),
    cardLongMm: Math.max(a, b),
    cardShortMm: Math.min(a, b),
  };
}

/** `computeCardScaleRatio`'s formula on already-mapped corners, for any card size. */
function cardRatioFor(mappedCard: readonly Point2[], size: CardSizeMm): number {
  const edges = [0, 1, 2, 3]
    .map((i) => dist(mappedCard[i], mappedCard[(i + 1) % 4]))
    .sort((x, y) => x - y);
  const measuredShort = (edges[0] + edges[1]) / 2;
  const measuredLong = (edges[2] + edges[3]) / 2;
  return (measuredLong / size.longMm + measuredShort / size.shortMm) / 2;
}
