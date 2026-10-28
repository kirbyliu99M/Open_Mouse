/**
 * The shutter ring drawn every animation frame (Kirby's S25 test,
 * 2026-10-27: "make the scan process circle smoother", candidate / 未拍板).
 *
 * The ring's fill is the auto-capture's elapsed time (autoCapture.ts), known
 * only at each live sample (about 7 a second, not evenly spaced: the
 * detector's time varies). Drawn at the samples, with a 120 ms transition,
 * it moved in steps. Between two samples that pass, the fill grows with
 * time as the ring's own clock does, timed from each sample's own moment
 * (not when its detection finished). It runs at most `leadMs` ahead of the
 * last sample, also through a sample or two that fail (they only pause the
 * ring), and never goes back until the ring goes on or empties. An emptied
 * ring (a lower fill than the last sample's) is drawn empty at once. With
 * reduced motion the samples' own fill only.
 *
 * 2026-10-28 (Kirby's S25 test again: "掃描loading的圈圈還是會輕微卡頓";
 * candidate 未拍板). A sample that fails does not add to the elapsed time
 * (autoCapture.ts), and the fill drawn ahead from it starts again from that
 * sample's moment. The ring was by then already one sample interval ahead
 * (about 150 ms at Kirby's 6.6 samples a second), so "never back" held it
 * STILL for that long: nine frames at 60 fps, one hitch per failed sample,
 * with the frames themselves on time (his `?debug=1` frame gaps: p95 16.7,
 * max 16.8 ms). Now a ring drawn ahead of its samples does not stop: it goes
 * on at `aheadRate` of its speed (still never back, still never past
 * `leadMs` ahead of the last sample's fill) until the samples catch up, so a
 * failed sample reads as a short slow-down instead of a stop.
 *
 * Pure: the component calls it once per animation frame.
 */
export interface RingTarget {
  /** The fill at the last sample, 0..1. */
  readonly fraction: number;
  /** performance.now() of that sample. */
  readonly atMs: number;
  /** Whether the ring is filling (started, not yet fired): drawn ahead of the sample. */
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
  /**
   * When the last frame was drawn, and how fast (a share of the ring's own
   * speed) a ring drawn ahead of its samples goes on. Without them (or a rate
   * of 0) a ring ahead holds still, as before 2026-10-28.
   */
  readonly shownAtMs?: number;
  readonly aheadRate?: number;
}): number {
  const { target } = input;
  if (input.reducedMotion) return target.fraction;
  // The ring emptied (or started over): no smoothing back down.
  if (target.fraction < input.shownTarget) return target.fraction;
  const shown = Math.min(input.shown, 1);
  if (!target.advancing) return Math.max(Math.min(1, target.fraction), shown);
  const ahead =
    Math.min(Math.max(0, input.nowMs - target.atMs), input.leadMs) /
    input.durationMs;
  const fromSamples = Math.min(1, target.fraction + ahead);
  if (fromSamples >= shown) return fromSamples;
  // Drawn ahead of the samples (a sample failed): slower, not still.
  const rate = Math.max(0, Math.min(1, input.aheadRate ?? 0));
  const frameMs =
    input.shownAtMs === undefined
      ? 0
      : Math.max(0, input.nowMs - input.shownAtMs);
  const cap = Math.min(1, target.fraction + input.leadMs / input.durationMs);
  const slowed = shown + (rate * frameMs) / input.durationMs;
  return Math.max(shown, Math.min(slowed, cap));
}
