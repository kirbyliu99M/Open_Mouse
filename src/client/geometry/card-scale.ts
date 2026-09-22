/**
 * Independent scale cross-check: measure a bank card (fixed, known,
 * ISO/IEC 7810 ID-1 size — unaffected by printer scaling) through the same
 * homography used for the sheet, and compare against `ID1_CARD_MM`.
 *
 * If the printer scaled the page (e.g. "fit to page" at 97%), the markers'
 * *physical* spacing shrinks but the homography is built assuming they sit
 * at their nominal design mm positions (src/client/sheet/layout.ts). The
 * card's mapped size then comes out proportionally too large (or small),
 * which is exactly the signal `cardScaleRatio` reports: 1.0 = agreement,
 * >1 = the sheet under-measures real mm (page printed smaller than 100%).
 */
import { ID1_CARD_MM } from "../../lib/contracts/measurement";
import { applyHomography, type Homography, type Point2 } from "./homography";

/**
 * The card's 4 corners in image pixels, in order around its perimeter
 * (either winding direction, starting from any corner — the result is
 * invariant to both).
 */
export type CardCorners = readonly [Point2, Point2, Point2, Point2];

/**
 * `(scale implied by the sheet) ÷ (scale implied by the card)`. The sheet's
 * own scale is 1 by construction (the homography reproduces the marker
 * layout's nominal mm exactly); the card's implied scale is its measured
 * mapped size ÷ its true ID-1 size. So this reduces to
 * `measured card size ÷ true card size`, averaged over the two long and the
 * two short sides so it doesn't matter which corner is first or whether the
 * card was photographed in portrait or landscape.
 */
export function computeCardScaleRatio(
  cardCorners: CardCorners,
  homography: Homography,
): number {
  const mapped = cardCorners.map((corner) =>
    applyHomography(homography, corner),
  );

  const edgeLengths = [0, 1, 2, 3].map((i) => {
    const a = mapped[i];
    const b = mapped[(i + 1) % 4];
    return Math.hypot(a.x - b.x, a.y - b.y);
  });

  const sorted = [...edgeLengths].sort((a, b) => a - b);
  const measuredShortMm = (sorted[0] + sorted[1]) / 2;
  const measuredLongMm = (sorted[2] + sorted[3]) / 2;

  const trueShortMm = Math.min(ID1_CARD_MM.width, ID1_CARD_MM.height);
  const trueLongMm = Math.max(ID1_CARD_MM.width, ID1_CARD_MM.height);

  return (measuredLongMm / trueLongMm + measuredShortMm / trueShortMm) / 2;
}
