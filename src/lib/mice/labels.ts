/**
 * The words for a mouse's size, shape and connection on the public mouse,
 * comparison and guide pages: the results filter's own words, and the /mice
 * page's word for a hybrid shape (the filter has none), so every page names a
 * value the same way.
 */
import type { Connectivity, Shape } from "../contracts/descriptors";
import type { Locale } from "../contracts/locale";
import { micePageCopy } from "../copy/mice-page";
import { en as resultsEn, zhTW as resultsZh } from "../copy/results-page";
import { pickCopy } from "../i18n/copy";
import type { MiceListRow } from "./list";

export interface MouseLabels {
  size: (size: MiceListRow["size"]) => string;
  /** Null for an unknown shape. */
  shape: (shape: Shape | null) => string | null;
  connectivity: (c: Connectivity | null) => string | null;
}

export function mouseLabels(locale: Locale): MouseLabels {
  const filter = pickCopy(locale, { zhTW: resultsZh, en: resultsEn }).filter;
  const hybrid = micePageCopy(locale).shapeHybrid;
  return {
    size: (size) => filter.size[size],
    shape: (shape) =>
      shape === null ? null : shape === "hybrid" ? hybrid : filter.shape[shape],
    connectivity: (c) => (c === null ? null : filter.connectivity[c]),
  };
}
