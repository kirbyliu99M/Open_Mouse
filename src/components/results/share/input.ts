/**
 * From a fit response to the share card's input, and the file name of the PNG.
 * Pure. Every value on the card comes from the response: the top entry's
 * brand, model and total, its band from `bandOf`, and the hand type if the
 * engine sent one (fit-v0 does not, and the card never invents one). Out of
 * the catalogue's length range the total and the band are null.
 */
import type { Locale } from "../../../lib/contracts/locale";
import type { FitEntry, FitResponse } from "../../../lib/contracts/fit";
import { en, zhTW } from "../../../lib/copy/fit-bands";
import { bandOf } from "../../../lib/fit/bands";
import { isSitePath, type ShareCardInput } from "./layout";

/** The best-ranked entry, or null for an empty result list. */
export function topPick(fit: FitResponse): FitEntry | null {
  let best: FitEntry | null = null;
  for (const entry of fit.results) {
    if (best === null || entry.rank < best.rank) best = entry;
  }
  return best;
}

/**
 * The mouse the card is about when it is not the overall #1 (V3.2 F24,
 * Kirby 2026-10-26, candidate / 未拍板): under a filter whose #1 is another
 * mouse, the card follows the page and shows that #1, titled with its place
 * there (「人體工學第 1 名」) instead of 「最適合我的滑鼠」.
 */
export interface SharePick {
  entry: FitEntry;
  placeLabel: string;
}

/** The band's name in the card's language, or null if the total is not gradable. */
export function bandLabelFor(total: number, lang: Locale): string | null {
  let band;
  try {
    band = bandOf(total);
  } catch {
    return null;
  }
  if (band === null) return null;
  return (lang === "zh-TW" ? zhTW : en).bands[band].label;
}

/**
 * `photoSrc` is the product photo's path once it has loaded, else null. With
 * a `pick` the card is about that mouse and carries its place (F24).
 */
export function buildShareCardInput(
  fit: FitResponse,
  lang: Locale,
  photoSrc: string | null,
  pick: SharePick | null = null,
): ShareCardInput | null {
  const top = pick?.entry ?? topPick(fit);
  if (top === null) return null;
  // Out of the catalogue's length range `total` is the value the engine sorted
  // by against the catalogue's edge, not a distance to this hand (contract,
  // `fitCoverageSchema`): no number, no band. `coverage` itself never enters
  // the card input; only these two fields change.
  const hidden = fit.coverage?.lengthOutOfRange === true;
  return {
    lang,
    ...(fit.handType ? { handType: fit.handType } : {}),
    brand: top.mouse.brand,
    model: top.mouse.model,
    total: hidden ? null : top.total,
    bandLabel: hidden ? null : bandLabelFor(top.total, lang),
    photoSrc: isSitePath(photoSrc) ? photoSrc : null,
    ...(pick ? { placeLabel: pick.placeLabel } : {}),
  };
}

/** The photo the card should try to load, or null (then it draws the silhouette). */
export function topPickPhotoPath(
  fit: FitResponse,
  pick: SharePick | null = null,
): string | null {
  const path = (pick?.entry ?? topPick(fit))?.mouse.imageUrl;
  return isSitePath(path) ? path : null;
}

/** `palmate-<slug>.png`, the slug cut down to letters, digits and hyphens. */
export function shareFileName(slug: string): string {
  const clean = slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `palmate-${clean || "mouse"}.png`;
}
