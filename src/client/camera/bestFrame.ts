/**
 * The sharpest frame of the auto-capture ring (Kirby's S25 test, 2026-10-26,
 * candidate / 未拍板): every photo of the test came out under the sharpness
 * floor (28-34 against 50), taken the moment the ring filled. The ring now
 * lasts 2.5 s, and the photo is the sharpest frame of its LAST
 * `windowMs`, not whatever frame the shutter falls on. Only the last part of
 * the fill counts: a hint shown during the ring may have just made the
 * person move their wrist, and an earlier sharp frame would undo that. The
 * person's own tap on the shutter takes the frame of that moment.
 *
 * 2026-10-27: the live sample's Laplacian variance (a 342 px wide picture)
 * did not pick the sharpest photo (the ring's shots read 36 and 45 at full
 * size, under the floor). So the `keep` sharpest frames by that live number
 * are kept, and the shot scores those again at full size
 * (`pickSharpestScore`) and uses the best of them.
 *
 * Pure: the live loop keeps the state and draws the frames when told to.
 */

export interface BestFrameState {
  /** The kept frame's live Laplacian variance. */
  readonly variance: number;
  /** performance.now() of the kept frame (its key). */
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
  /** How many frames are kept for the full-size score. */
  readonly keep: number;
}

export interface BestFrameStep {
  /** The kept frames, sharpest (live) first. */
  readonly kept: readonly BestFrameState[];
  /** Whether to draw this sample's frame now (it is one of the kept). */
  readonly keepThis: boolean;
  /** The `atMs` of the frames no longer kept, whose pictures can go. */
  readonly dropped: readonly number[];
}

/**
 * The kept frames after one sample. An empty ring forgets them all; a
 * failing sample keeps them (the ring only paused). Pure.
 */
export function nextBestFrame(
  kept: readonly BestFrameState[],
  sample: BestFrameSample,
): BestFrameStep {
  if (!(sample.ringElapsedMs > 0))
    return { kept: [], keepThis: false, dropped: kept.map((k) => k.atMs) };
  const windowStart = sample.ringDurationMs - sample.windowMs;
  const keep = Math.max(1, Math.floor(sample.keep));
  if (
    !sample.passing ||
    !Number.isFinite(sample.variance) ||
    sample.ringElapsedMs < windowStart
  )
    return { kept, keepThis: false, dropped: [] };
  const weakest = kept[kept.length - 1];
  if (kept.length >= keep && weakest && !(sample.variance > weakest.variance))
    return { kept, keepThis: false, dropped: [] };
  const next = [...kept, { variance: sample.variance, atMs: sample.atMs }].sort(
    (a, b) => b.variance - a.variance,
  );
  return {
    kept: next.slice(0, keep),
    keepThis: true,
    dropped: next.slice(keep).map((k) => k.atMs),
  };
}

/**
 * The index of the highest full-size score, or `null` when none is a number
 * (the shot then takes the live order's first). Pure.
 */
export function pickSharpestScore(scores: readonly number[]): number | null {
  let best: number | null = null;
  scores.forEach((score, i) => {
    if (!Number.isFinite(score)) return;
    if (best === null || score > (scores[best] as number)) best = i;
  });
  return best;
}
