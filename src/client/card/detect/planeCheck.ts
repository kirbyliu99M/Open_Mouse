/**
 * Scan Lab (L6, 2026-11-01): does a card-shaped quad measure as the card
 * when the SHEET's homography reads it? Lab only; every threshold here is
 * candidate (未拍板).
 *
 * Why (Kirby's third round, 2026-11-01): on 13-09-10 the detector took a
 * small quad at the table's edge for the card. It was card-shaped in the
 * image, but through the sheet's homography it measured 40.1 x 25.3 mm
 * (`cardScaleRatio` 0.47), its corners were nowhere near right angles on the
 * table, and its pixel long side was the table's short side (the record's
 * `orientation.disagrees`). The sheet knows the table plane's scale, so a
 * card that is not about the card's size on that plane is not the card.
 *
 * The sheet's orientation (which image side is its long side) is the pixel
 * order unless the caller knows better (`paperLongSideFirst`), as in
 * `cardMeasure.ts#cardScaleRatioAgainstPaper`.
 *
 * Coordinates: image px in, mm on the table plane out.
 */
import {
  applyHomography,
  estimateHomography,
  type Point2,
} from "../../geometry/homography";
import { pixelLongSideFirst, rectangleMmFor } from "./cardMeasure";
import type { Quad } from "./coarse";

/** What the sheet's homography says about a card quad. */
export interface CardPlaneCheck {
  /** Mean of each opposite pair of the card's sides on the table, mm: the longer and the shorter. */
  readonly longMm: number;
  readonly shortMm: number;
  /** Per side of the card quad (TL-TR, TR-BR, BR-BL, BL-TL), its length on the table, mm. */
  readonly sideMm: readonly [number, number, number, number];
  /** Largest |corner angle - 90 deg| of the card on the table. */
  readonly maxAngleErrorDeg: number;
  /** `true` when the card's TL-TR pair is its long side in image px. */
  readonly pixelLongSideFirst: boolean;
  /** The same on the table (mm). */
  readonly planeLongSideFirst: boolean;
}

function dist(a: Point2, b: Point2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Measure `card` (image px, TL, TR, BR, BL) on the table plane through the
 * sheet's homography (`paper`, any start corner as long as it goes round;
 * `paperLongMm` x `paperShortMm`). `null` for degenerate corners. Pure.
 */
export function cardOnPaperPlane(
  card: Quad,
  paper: Quad,
  paperLongMm: number,
  paperShortMm: number,
  paperLongSideFirst?: boolean,
): CardPlaneCheck | null {
  let mm: Point2[];
  try {
    const rect = rectangleMmFor(
      paper,
      paperLongMm,
      paperShortMm,
      paperLongSideFirst,
    );
    const h = estimateHomography(
      paper.map((src, i) => ({ src, dst: rect[i] })),
    );
    mm = card.map((p) => applyHomography(h, p));
  } catch {
    return null;
  }
  if (mm.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    return null;
  }
  const side = [0, 1, 2, 3].map((i) => dist(mm[i], mm[(i + 1) % 4]));
  const a = (side[0] + side[2]) / 2;
  const b = (side[1] + side[3]) / 2;
  let maxAngleErrorDeg = 0;
  for (let i = 0; i < 4; i++) {
    const p = mm[i];
    const prev = mm[(i + 3) % 4];
    const next = mm[(i + 1) % 4];
    const ux = prev.x - p.x;
    const uy = prev.y - p.y;
    const vx = next.x - p.x;
    const vy = next.y - p.y;
    const nu = Math.hypot(ux, uy);
    const nv = Math.hypot(vx, vy);
    if (nu < 1e-9 || nv < 1e-9) return null;
    const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (nu * nv)));
    const deg = (Math.acos(cos) * 180) / Math.PI;
    maxAngleErrorDeg = Math.max(maxAngleErrorDeg, Math.abs(deg - 90));
  }
  return {
    longMm: Math.max(a, b),
    shortMm: Math.min(a, b),
    sideMm: [side[0], side[1], side[2], side[3]],
    maxAngleErrorDeg,
    pixelLongSideFirst: pixelLongSideFirst(card),
    planeLongSideFirst: a >= b,
  };
}

/** What a focal length alone says about a quad seen as a flat rectangle. */
export interface RectangleFromFocal {
  /** Long side / short side of the rectangle on its own plane. */
  readonly aspect: number;
  /** |corner angle - 90 deg| of the parallelogram the quad is the image of, on its plane. */
  readonly angleErrorDeg: number;
  /** `true` when the quad's TL-TR side is the long side on the plane. */
  readonly longSideFirst: boolean;
}

/**
 * L7 (2026-11-02), for a card with no sheet in view: the shape of the flat
 * object a quad (TL, TR, BR, BL, image px) is the image of, given only the
 * camera's focal length and principal point (Zhang & He 2006, "Whiteboard
 * scanning and image enhancement": the 4 corners' relative depths follow
 * from the quad, so the plane's tilt comes from the photo itself and no
 * tilt sensor is needed). Every quad is the image of SOME parallelogram;
 * a card is a rectangle, so its corner angle must be 90 deg and its sides
 * in the card's ratio. `null` when the depths come out non-positive
 * (not a view of a flat object in front of the camera). Pure.
 */
export function rectangleFromFocal(
  quad: Quad,
  fPx: number,
  cx: number,
  cy: number,
): RectangleFromFocal | null {
  if (!(fPx > 0)) return null;
  const v = (p: Point2): [number, number, number] => [
    (p.x - cx) / fPx,
    (p.y - cy) / fPx,
    1,
  ];
  // m1 = (0,0), m2 = (w,0), m3 = (0,h), m4 = (w,h) on the plane.
  const m1 = v(quad[0]);
  const m2 = v(quad[1]);
  const m4 = v(quad[2]);
  const m3 = v(quad[3]);
  const cross = (a: number[], b: number[]) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const dot = (a: number[], b: number[]) =>
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const c14 = cross(m1, m4);
  const d2 = dot(cross(m2, m4), m3);
  const d3 = dot(cross(m3, m4), m2);
  if (Math.abs(d2) < 1e-12 || Math.abs(d3) < 1e-12) return null;
  const k2 = dot(c14, m3) / d2;
  const k3 = dot(c14, m2) / d3;
  if (!(k2 > 0) || !(k3 > 0)) return null;
  const n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 * m2[2] - m1[2]];
  const n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 * m3[2] - m1[2]];
  const l2 = Math.hypot(n2[0], n2[1], n2[2]);
  const l3 = Math.hypot(n3[0], n3[1], n3[2]);
  if (!(l2 > 0) || !(l3 > 0)) return null;
  const cos = Math.max(-1, Math.min(1, dot(n2, n3) / (l2 * l3)));
  return {
    aspect: Math.max(l2, l3) / Math.min(l2, l3),
    angleErrorDeg: Math.abs((Math.acos(cos) * 180) / Math.PI - 90),
    longSideFirst: l2 >= l3,
  };
}
