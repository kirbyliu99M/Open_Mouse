/**
 * Live-loop light checks (docs/design/camera-capture-2026-09-25/README.md):
 * mean luma and clipping, over whatever grayscale samples the caller hands
 * in (in practice, the pixels inside the tracked sheet quad of the
 * downscaled live-loop frame — restricting to that region is the caller's
 * job; these functions are plain array reducers). Pure — reuses the same
 * BT.601-weighted grayscale convention as
 * src/client/photo/sharpness.ts#rgbaToGrayscale.
 */
import { CAMERA_CONSTANTS } from "./constants";

/** Mean of a grayscale (0-255) sample array. Throws on an empty array. */
export function computeMeanLuma(gray: ArrayLike<number>): number {
  if (gray.length === 0) {
    throw new RangeError("computeMeanLuma needs at least one sample.");
  }
  let sum = 0;
  for (let i = 0; i < gray.length; i++) sum += gray[i];
  return sum / gray.length;
}

/** Fraction of samples at or above `threshold` (blown-out highlights). */
export function computeClippedFraction(
  gray: ArrayLike<number>,
  threshold: number = CAMERA_CONSTANTS.light.clipLumaThreshold,
): number {
  if (gray.length === 0) {
    throw new RangeError("computeClippedFraction needs at least one sample.");
  }
  let clipped = 0;
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] >= threshold) clipped++;
  }
  return clipped / gray.length;
}

export type LightStatus = "dark" | "bright" | "ok";

/** "More light, please" / "Too bright — avoid glare" / neither. */
export function computeLightStatus(
  meanLuma: number,
  clippedFraction: number,
  thresholds: {
    minMeanLuma: number;
    maxClippedFraction: number;
  } = CAMERA_CONSTANTS.light,
): LightStatus {
  if (meanLuma < thresholds.minMeanLuma) return "dark";
  if (clippedFraction > thresholds.maxClippedFraction) return "bright";
  return "ok";
}
