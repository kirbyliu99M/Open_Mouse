/**
 * Hand type (fit-v1 candidate, docs/fit-algorithm.md §7): a display-only label
 * for the person's hand, anchored to mouse sizes. It is never compared with
 * other people and never feeds a score.
 *
 * Pure, and safe on both sides of the seam.
 */
import type { GripStyle, HandType } from "../contracts/fit";
import { computeSize } from "../../server/catalogue/size";

/** The engine targets the type is read from (a subset of `FitResponse["targets"]`). */
export interface HandTypeTargets {
  lengthMm: number;
  gripWidthMm: number;
  heightMm: number;
}

/** What the catalogue says about "wide" versus "slim". */
export interface HandTypeCatalogueStats {
  /**
   * The width/length ratio that splits slim from wide. Candidate (未拍板):
   * the median of width/length over the catalogue.
   */
  widthToLengthSplit: number;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The catalogue median of width/length, or `null` for an empty catalogue. */
export function handTypeStatsFromCatalogue(
  catalogue: readonly { lengthMm: number; widthMm: number }[],
): HandTypeCatalogueStats | null {
  if (catalogue.length === 0) return null;
  return {
    widthToLengthSplit: median(catalogue.map((m) => m.widthMm / m.lengthMm)),
  };
}

/**
 * Which catalogue size class the target mouse falls in (the same `computeSize`
 * rule the catalogue uses), reading "fingertip" (the rule's sub-small class
 * for short, low mice) as small: a hand type has three sizes.
 */
function sizeOf(targets: HandTypeTargets): HandType["size"] {
  const size = computeSize({
    lengthMm: targets.lengthMm,
    widthMm: targets.gripWidthMm,
    heightMm: targets.heightMm,
  });
  return size === "fingertip" ? "small" : size;
}

/**
 * `{ size, grip, width }` for the grip the score used (or the arg-max predicted
 * one). `width` is wide when the target grip width / target length is above the
 * catalogue split, slim at or below it.
 */
export function classifyHandType(
  targets: HandTypeTargets,
  grip: GripStyle,
  stats: HandTypeCatalogueStats,
): HandType {
  const ratio = targets.gripWidthMm / targets.lengthMm;
  return {
    size: sizeOf(targets),
    grip,
    width: ratio > stats.widthToLengthSplit ? "wide" : "slim",
  };
}
