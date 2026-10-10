/**
 * Hand type (fit-v1 candidate, docs/fit-algorithm.md §7): a display-only label
 * for the person's hand, anchored to mouse sizes. It is never compared with
 * other people and never feeds a score.
 *
 * Pure, and safe on both sides of the seam.
 */
import type { Size } from "../contracts/descriptors";
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
 * A catalogue size as one of the three a person sees: "fingertip" (the size
 * rule's sub-small class) counts as small. The hand type's size and the
 * results filter's 尺寸 groups both come from this one function, so a mouse is
 * in the group the hand type points to exactly when its size says so
 * (FILTER-1, candidate; pinned by tests/unit/results-filters.test.ts).
 */
export function handSizeOf(size: Size): HandType["size"] {
  return size === "fingertip" ? "small" : size;
}

/**
 * Which catalogue size class the target mouse falls in (the same `computeSize`
 * rule the catalogue uses), reading "fingertip" (the rule's sub-small class
 * for short, low mice) as small: a hand type has three sizes.
 */
function sizeOf(targets: HandTypeTargets): HandType["size"] {
  return handSizeOf(
    computeSize({
      lengthMm: targets.lengthMm,
      widthMm: targets.gripWidthMm,
      heightMm: targets.heightMm,
    }),
  );
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
