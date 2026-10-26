/**
 * The sharpest frame of the auto-capture ring (Kirby's S25 test, 2026-10-26,
 * candidate / 未拍板): every photo of the test came out under the sharpness
 * floor (28-34 against 50), taken the moment the ring filled. The ring now
 * lasts 2.5 s, and the photo is the sharpest frame of its LAST
 * `windowMs` (by the live sample's Laplacian variance, the same number the
 * loop already computes), not whatever frame the shutter falls on. Only the
 * last part of the fill counts: a hint shown during the ring may have just
 * made the person move their wrist, and an earlier sharp frame would undo
 * that. The person's own tap on the shutter takes the frame of that moment.
 *
 * Pure: the live loop keeps the state and draws the frame when told to.
 */

export interface BestFrameState {
  /** The kept frame's live Laplacian variance. */
  readonly variance: number;
  /** performance.now() of the kept frame. */
  readonly atMs: number;
}

export interface BestFrameSample {
  readonly variance: number;
  readonly atMs: number;
  /** Whether this sample passed the paper's checks (the ring's input). */
  readonly passing: boolean;
  /** The ring's filled time after this sample (autoCapture.ts `elapsedMs`). */
  readonly ringElapsedMs: number;
  /** The ring's full duration. */
  readonly ringDurationMs: number;
  /** How much of the ring's end frames are taken from. */
  readonly windowMs: number;
}

/**
 * The kept frame after one sample, and whether to draw this sample's frame
 * now (it is the sharpest of the window so far). An empty ring forgets the
 * kept frame; a failing sample keeps it (the ring only paused). Pure.
 */
export function nextBestFrame(
  best: BestFrameState | null,
  sample: BestFrameSample,
): { readonly best: BestFrameState | null; readonly keepThis: boolean } {
  if (!(sample.ringElapsedMs > 0)) return { best: null, keepThis: false };
  const windowStart = sample.ringDurationMs - sample.windowMs;
  if (
    !sample.passing ||
    !Number.isFinite(sample.variance) ||
    sample.ringElapsedMs < windowStart
  )
    return { best, keepThis: false };
  if (best !== null && !(sample.variance > best.variance))
    return { best, keepThis: false };
  return {
    best: { variance: sample.variance, atMs: sample.atMs },
    keepThis: true,
  };
}
