/**
 * Scan lab L12 (2026-11-04, candidate 未拍板): where to look for the card
 * when the hand guide draws no card slot (G0, G-A4), from the hand itself.
 *
 * Every hand version asks for the card beside the hand on its little-finger
 * side, about level with the hand (G-M2 / G-LC draw the slot there; Kirby's
 * G0 photo of 2026-11-03 has it there too). So the box is the rectangle, in
 * the hand's own frame, that runs along the hand from just below the wrist
 * (landmark 0) to just past the middle fingertip, and across from the
 * little-finger edge of the hand outward: axis `a` = 0 → 9 (wrist to middle
 * knuckle), across `n` = 5 → 17 (index knuckle to little-finger knuckle),
 * hand length L = |0 → 12|. Along: `HAND_BOX_ALONG` x L from 0; across:
 * `HAND_BOX_ACROSS` x L past the outermost landmark on the little-finger
 * side. Its axis-aligned bounding box, clipped to the frame, is returned.
 *
 * The detector only uses it for the straight-edge search (`lineSearch.ts`)
 * after both outline searches of the whole frame failed
 * (`DetectCardOptions.linesRegion`), so a card the whole-frame search finds
 * keeps exactly its corners. Pure.
 */
import type { PixelRect } from "../detect/coarse";

/** Along the hand axis, fractions of the hand length from the wrist. Candidate 未拍板. */
export const HAND_BOX_ALONG: readonly [number, number] = [-0.1, 1.1];
/** Across, fractions of the hand length past the hand's little-finger edge. Candidate 未拍板. */
export const HAND_BOX_ACROSS: readonly [number, number] = [0.02, 0.8];
/** A box shorter than this on either side (px) is no box. */
const MIN_BOX_PX = 120;

interface Pt {
  readonly x: number;
  readonly y: number;
}

function finitePoint(p: unknown): p is Pt {
  if (typeof p !== "object" || p === null) return false;
  const q = p as Record<string, unknown>;
  return (
    typeof q.x === "number" &&
    Number.isFinite(q.x) &&
    typeof q.y === "number" &&
    Number.isFinite(q.y)
  );
}

/**
 * The search box (shot px) beside the hand on its little-finger side, or
 * `null` without 21 usable landmarks or when the box falls (almost) outside
 * the frame.
 */
export function handCardSearchRegion(
  landmarksPx: readonly Pt[] | null | undefined,
  shot: { readonly width: number; readonly height: number },
): PixelRect | null {
  if (!landmarksPx || landmarksPx.length !== 21) return null;
  if (!landmarksPx.every(finitePoint)) return null;
  if (!(shot.width > 0) || !(shot.height > 0)) return null;
  const p0 = landmarksPx[0];
  const ax0 = landmarksPx[9].x - p0.x;
  const ay0 = landmarksPx[9].y - p0.y;
  const al = Math.hypot(ax0, ay0);
  const L = Math.hypot(landmarksPx[12].x - p0.x, landmarksPx[12].y - p0.y);
  if (al < 1e-6 || L < 1e-6) return null;
  const a = { x: ax0 / al, y: ay0 / al };
  // Across, perpendicular to the axis, on the side the little finger is.
  let n = { x: -a.y, y: a.x };
  const sx = landmarksPx[17].x - landmarksPx[5].x;
  const sy = landmarksPx[17].y - landmarksPx[5].y;
  if (sx * n.x + sy * n.y < 0) n = { x: -n.x, y: -n.y };
  let edge = -Infinity;
  for (const p of landmarksPx) {
    edge = Math.max(edge, (p.x - p0.x) * n.x + (p.y - p0.y) * n.y);
  }
  const corners: Pt[] = [];
  for (const s of HAND_BOX_ALONG) {
    for (const t of HAND_BOX_ACROSS) {
      const u = s * L;
      const v = edge + t * L;
      corners.push({
        x: p0.x + a.x * u + n.x * v,
        y: p0.y + a.y * u + n.y * v,
      });
    }
  }
  const x0 = Math.max(0, Math.min(...corners.map((c) => c.x)));
  const y0 = Math.max(0, Math.min(...corners.map((c) => c.y)));
  const x1 = Math.min(shot.width, Math.max(...corners.map((c) => c.x)));
  const y1 = Math.min(shot.height, Math.max(...corners.map((c) => c.y)));
  if (x1 - x0 < MIN_BOX_PX || y1 - y0 < MIN_BOX_PX) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
