/**
 * Scan lab L11 (2026-11-04, candidate 未拍板): the hand guide's card slot as
 * the card detector's search box.
 *
 * A version that draws a card slot (G-M2, G-LC) keeps it in its layout as
 * `cardZone`, in view coordinates (0..1 of the on-screen region, mirrored
 * for the left hand by the version). The shutter's frame IS that on-screen
 * region (`handShot.ts`: the canvas is the stream cut to
 * `visibleRegionInStream`, `coverMap.ts`), so a view point maps to the shot
 * by a plain scale: x * width, y * height. Not through the stream: the
 * stream is taller than the shot (Kirby's 2026-11-03 G-LC photo: stream
 * 1080 x 1920, shot 1080 x 1768 from y 76), and the slot's top at view
 * 0.32 is shot y 566 (the card's top edge was at 571-587 px), where the
 * stream would put it at 614.
 *
 * The slot is widened by `CARD_SLOT_MARGIN_FRACTION` of the shot's short
 * side on every side (clamped to the frame): it is drawn about one card
 * short side wide, and on Kirby's photo the card's left edge lay 19 px
 * left of it. G0 and G-A4 have no slot: no box, the detector searches the
 * whole frame as before. Pure.
 */
import type { PixelRect } from "../detect/coarse";

/** Margin around the slot, fraction of the shot's short side. Candidate 未拍板. */
export const CARD_SLOT_MARGIN_FRACTION = 0.08;

function isRect(v: unknown): v is PixelRect {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return ["x", "y", "width", "height"].every(
    (k) => typeof r[k] === "number" && Number.isFinite(r[k]),
  );
}

/**
 * The search box (shot px) for a version's layout, or `null` when the
 * layout has no `cardZone` (or a degenerate one).
 */
export function cardSlotSearchRegion(
  layout: Readonly<Record<string, unknown>> | null | undefined,
  shot: { readonly width: number; readonly height: number },
): PixelRect | null {
  const zone = layout?.cardZone;
  if (!isRect(zone) || zone.width <= 0 || zone.height <= 0) return null;
  if (!(shot.width > 0) || !(shot.height > 0)) return null;
  const m = CARD_SLOT_MARGIN_FRACTION * Math.min(shot.width, shot.height);
  const x0 = Math.max(0, zone.x * shot.width - m);
  const y0 = Math.max(0, zone.y * shot.height - m);
  const x1 = Math.min(shot.width, (zone.x + zone.width) * shot.width + m);
  const y1 = Math.min(shot.height, (zone.y + zone.height) * shot.height + m);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
