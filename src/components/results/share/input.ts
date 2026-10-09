/**
 * From a fit response to the share card's input, and the file name of the PNG.
 * Pure. Every value on the card comes from the response: the top entry's
 * brand, model and total, its band from `bandOf`, and the hand type if the
 * engine sent one (fit-v0 does not, and the card never invents one).
 */
import type { UiLanguage } from "../../../client/uiLanguage";
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

/** The band's name in the card's language, or null if the total is not gradable. */
export function bandLabelFor(total: number, lang: UiLanguage): string | null {
  let band;
  try {
    band = bandOf(total);
  } catch {
    return null;
  }
  if (band === null) return null;
  return (lang === "zh-TW" ? zhTW : en).bands[band].label;
}

/** `photoSrc` is the product photo's path once it has loaded, else null. */
export function buildShareCardInput(
  fit: FitResponse,
  lang: UiLanguage,
  photoSrc: string | null,
): ShareCardInput | null {
  const top = topPick(fit);
  if (top === null) return null;
  return {
    lang,
    ...(fit.handType ? { handType: fit.handType } : {}),
    brand: top.mouse.brand,
    model: top.mouse.model,
    total: top.total,
    bandLabel: bandLabelFor(top.total, lang),
    photoSrc: isSitePath(photoSrc) ? photoSrc : null,
  };
}

/** The photo the card should try to load, or null (then it draws the silhouette). */
export function topPickPhotoPath(fit: FitResponse): string | null {
  const path = topPick(fit)?.mouse.imageUrl;
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
