/**
 * §3: score = round(100 · exp(−½(Δ/σ)²)), 0–100. Shared by every sub-score
 * that decays from a target by a Gaussian.
 */
export function gaussianScore(deltaMm: number, sigmaMm: number): number {
  const raw = 100 * Math.exp(-0.5 * (deltaMm / sigmaMm) ** 2);
  return Math.max(0, Math.min(100, Math.round(raw)));
}
