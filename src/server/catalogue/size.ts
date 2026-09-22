import type { Size } from "../../lib/contracts/descriptors";

/**
 * Size is computed, never classified (docs/shape-rubric.md §1).
 * Measured against the validation fixture: 91.5% exact (n=1260),
 * 99.8% within one level; 89.5% exact on Logitech (n=76).
 */
export const SIZE_RULE = {
  widthWeight: 0.4,
  widthPivotMm: 64,
  fingertipMaxLengthMm: 104,
  fingertipMaxHeightRatio: 0.38,
  smallBelow: 117,
  mediumUpTo: 124,
} as const;

export function sizeScore(lengthMm: number, widthMm: number): number {
  return lengthMm + SIZE_RULE.widthWeight * (widthMm - SIZE_RULE.widthPivotMm);
}

export function computeSize(dims: {
  lengthMm: number;
  widthMm: number;
  heightMm: number;
}): Size {
  const { lengthMm, widthMm, heightMm } = dims;
  for (const [name, value] of Object.entries(dims)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`${name} must be a positive number, got ${value}`);
    }
  }
  if (
    lengthMm <= SIZE_RULE.fingertipMaxLengthMm &&
    heightMm / lengthMm <= SIZE_RULE.fingertipMaxHeightRatio
  ) {
    return "fingertip";
  }
  const score = sizeScore(lengthMm, widthMm);
  if (score < SIZE_RULE.smallBelow) return "small";
  if (score <= SIZE_RULE.mediumUpTo) return "medium";
  return "large";
}
