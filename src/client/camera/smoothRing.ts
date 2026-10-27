/**
 * The shutter ring drawn every animation frame (Kirby's S25 test,
 * 2026-10-27: "make the scan process circle smoother", candidate / 未拍板).
 *
 * The ring's fill is the auto-capture's elapsed time (autoCapture.ts), known
 * only at each live sample (about 7 a second, not evenly spaced: the
 * detector's time varies). Drawn at the samples, with a 120 ms transition,
 * it moved in steps. Between two samples that pass, the fill grows with
 * time as the ring's own clock does; it runs at most `leadMs` ahead of the
 * last sample, so a sample that then fails leaves it at most that much
 * ahead, where it holds (never back) until the ring goes on or empties. An
 * emptied ring (a lower fill than the last sample's) is drawn empty at
 * once. With reduced motion the samples' own fill only.
 *
 * Pure: the component calls it once per animation frame.
 */
export interface RingTarget {
  /** The fill at the last sample, 0..1. */
  readonly fraction: number;
  /** performance.now() of that sample. */
  readonly atMs: number;
  /** Whether that sample passed (the ring's clock is running). */
  readonly advancing: boolean;
}

export function smoothRingFraction(input: {
  readonly target: RingTarget;
  /** What was drawn on the last frame, and the sample fill it was drawn for. */
  readonly shown: number;
  readonly shownTarget: number;
  readonly nowMs: number;
  readonly durationMs: number;
  readonly leadMs: number;
  readonly reducedMotion: boolean;
}): number {
  const { target } = input;
  if (input.reducedMotion) return target.fraction;
  // The ring emptied (or started over): no smoothing back down.
  if (target.fraction < input.shownTarget) return target.fraction;
  const ahead = target.advancing
    ? Math.min(Math.max(0, input.nowMs - target.atMs), input.leadMs) /
      input.durationMs
    : 0;
  const next = Math.min(1, target.fraction + ahead);
  return Math.max(next, Math.min(input.shown, 1));
}
