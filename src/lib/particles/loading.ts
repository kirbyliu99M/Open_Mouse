/**
 * The particle loader (V3.2 U1, candidate / 未拍板; design loading-v5-ring): a
 * round cloud of the home page's blue-white particles that breathes, inside a
 * thin progress ring. It stands in for the results page's loading text and
 * for the wait after a photo is taken. Nothing on it is text or a number.
 *
 * The ring shows waiting, not work done:
 * - reading the recommendations is one server answer with no real progress,
 *   so the ring follows time, 1 - e^(-t / 1.2 s), and stops at 90 %;
 * - analysing a photo has real steps (decode, find the sheet, find the hand,
 *   turn it into mm). Each step that really finishes moves the ring to the
 *   start of the next part; between steps it creeps by the same curve and
 *   never passes the next part's start.
 * When the answer arrives the ring fills to 100 % in 250 ms, the cloud is
 * brightest once, and the loader fades out in 200 ms. The photo's loader
 * stays at least 1.5 s, counted from when it appeared to when it is gone; a
 * longer wait is shown as it is, with nothing added. The recommendations'
 * loader (F7, Kirby's phone test 2026-10-21) appears only when the answer has
 * not come within 300 ms, and then has no minimum (`fitReveal`).
 *
 * Every number here is a named candidate (Kirby 2026-10-20/21 for the timings
 * and colours). Pure: no DOM, no clock.
 */
import { particleCount, PALETTE, type Renderer } from "./budget";
import { clamp01 } from "./interpolate";
import { mulberry32 } from "./random";

export const LOADING_TIMING = {
  /** The time curve's constant: 1 - e^(-t / TAU_MS). */
  TAU_MS: 1200,
  /** The ring never passes this before the answer arrives. */
  WAIT_CAP: 0.9,
  /** From the answer to a full ring. */
  FILL_MS: 250,
  /** The loader fades out after the ring is full. */
  FADE_OUT_MS: 200,
  /**
   * The shortest time the recommendations' loader is on screen: none (F7,
   * Kirby's phone test 2026-10-21; it was 1.2 s). It appears only once the
   * answer has taken `FIT_SHOW_AFTER_MS`, and goes as soon as it is here.
   */
  MIN_DISPLAY_FIT_MS: 0,
  /**
   * The recommendations' loader appears only when the answer has not come
   * within this time (F7, Kirby 2026-10-21): a quick answer is shown at once.
   */
  FIT_SHOW_AFTER_MS: 300,
  /** The shortest time the photo analysis' loader is on screen (Kirby 2026-10-21). */
  MIN_DISPLAY_PHOTO_MS: 1500,
  /** How fast the drawn ring catches up with a step that jumped (ms). */
  SMOOTH_TAU_MS: 140,
} as const;

/** The time-based wait: 1 - e^(-t / 1.2 s), never more than 90 %. 0 before the start. */
export function timeProgress(elapsedMs: number): number {
  if (!(elapsedMs > 0)) return 0;
  const p = 1 - Math.exp(-elapsedMs / LOADING_TIMING.TAU_MS);
  return Math.min(p, LOADING_TIMING.WAIT_CAP);
}

/**
 * The steps of a photo analysis that report themselves before the answer, in
 * order (`onStage` of the pipeline). The last step, turning the landmarks
 * into mm, ends with the answer itself.
 */
export const PHOTO_STAGES = ["decoded", "paper", "hand"] as const;
export type PhotoStage = (typeof PHOTO_STAGES)[number];

/**
 * The stages a photo analysis reports for its calibration: only the
 * paper-edge one reports the sheet (a typed hand length looks for none; the
 * printed sheet's markers are not reported).
 */
export function photoStagesFor(
  method: "paper-edge" | "user-length" | "printed-sheet",
): readonly PhotoStage[] {
  return method === "paper-edge" ? PHOTO_STAGES : ["decoded", "hand"];
}

/**
 * How many steps a photo analysis has in all for the ring: the reported
 * stages and the last one, turning the hand into mm, which ends with the
 * answer.
 */
export function photoStepCount(stages: readonly PhotoStage[]): number {
  return stages.length + 1;
}

/**
 * How many steps of `stages` are done once `reached` has been reported (the
 * steps are reported in order; a stage the list does not have counts
 * nothing).
 */
export function stepsDone(
  stages: readonly PhotoStage[],
  reached: ReadonlySet<PhotoStage>,
): number {
  let n = 0;
  for (const stage of stages) {
    if (!reached.has(stage)) break;
    n += 1;
  }
  return n;
}

/**
 * The step-based wait. `totalSteps` counts every step, the last one being the
 * answer; `done` steps have finished, the last of them `sinceStepMs` ago (or
 * since the start, with none). Part k runs from 90 % * k / total to
 * 90 % * (k + 1) / total, and inside it the ring follows the time curve
 * towards the next part's start without reaching it.
 */
export function stepProgress(
  done: number,
  totalSteps: number,
  sinceStepMs: number,
): number {
  if (!(totalSteps >= 1)) return timeProgress(sinceStepMs);
  const k = Math.min(Math.max(Math.floor(done), 0), totalSteps);
  const cap = LOADING_TIMING.WAIT_CAP;
  if (k >= totalSteps) return cap;
  const from = (cap * k) / totalSteps;
  const to = (cap * (k + 1)) / totalSteps;
  const creep =
    sinceStepMs > 0 ? 1 - Math.exp(-sinceStepMs / LOADING_TIMING.TAU_MS) : 0;
  // `creep` is under 1 for any finite time, so `to` is never reached.
  return Math.min(from + (to - from) * creep, to);
}

/** Ease-out (cubic) over [0, 1]. */
export function easeOutCubic(t: number): number {
  const x = clamp01(t);
  return 1 - (1 - x) ** 3;
}

/** The fill after the answer: from where the ring was to 100 % in 250 ms. */
export function fillProgress(from: number, sinceFillMs: number): number {
  const start = clamp01(from);
  return (
    start + (1 - start) * easeOutCubic(sinceFillMs / LOADING_TIMING.FILL_MS)
  );
}

/**
 * The drawn ring catching up with the wait's value: an exponential approach
 * that never goes backwards, so a step that jumps reads as a quick, smooth
 * advance rather than a snap.
 */
export function approach(shown: number, target: number, dtMs: number): number {
  if (!(target > shown)) return shown;
  if (!(dtMs > 0)) return shown;
  const k = 1 - Math.exp(-dtMs / LOADING_TIMING.SMOOTH_TAU_MS);
  return shown + (target - shown) * k;
}

export interface LoaderTimeline {
  /** When the ring starts filling (ok) or stops and dims (failed). */
  settleAt: number;
  /** When the loader is gone and what it waited for is shown. */
  doneAt: number;
}

/**
 * When an answer that arrived at `arrivedAt` is shown, for a loader that
 * appeared at `startedAt` and stays at least `minMs`. An ok answer fills the
 * ring and fades out (450 ms in all), starting no earlier than the answer and
 * late enough that the loader is on screen for `minMs`. A failure stops the
 * ring at once and its retry is shown once `minMs` has passed (no fill, no
 * fade). A wait longer than `minMs` is never made longer.
 */
export function loaderTimeline(
  startedAt: number,
  arrivedAt: number,
  minMs: number,
  ok: boolean,
): LoaderTimeline {
  const arrived = Math.max(arrivedAt, startedAt);
  if (!ok) {
    return { settleAt: arrived, doneAt: Math.max(arrived, startedAt + minMs) };
  }
  const tail = LOADING_TIMING.FILL_MS + LOADING_TIMING.FADE_OUT_MS;
  const settleAt = Math.max(arrived, startedAt + minMs - tail);
  return { settleAt, doneAt: settleAt + tail };
}

/** The loader's opacity at `now` during its fade-out: 1 until the ring is full, then down to 0. */
export function fadeOutOpacity(now: number, timeline: LoaderTimeline): number {
  const fadeFrom = timeline.doneAt - LOADING_TIMING.FADE_OUT_MS;
  if (now <= fadeFrom) return 1;
  return 1 - clamp01((now - fadeFrom) / LOADING_TIMING.FADE_OUT_MS);
}

/**
 * The recommendations' wait (F7, Kirby's phone test 2026-10-21, candidate):
 * an answer that arrives within `FIT_SHOW_AFTER_MS` of the request is shown
 * at once and no loader is ever drawn; a later one is shown by the loader
 * that appeared at `FIT_SHOW_AFTER_MS`, with no minimum time (`MIN_DISPLAY_FIT_MS`
 * is 0): a result fills the ring and fades (450 ms), a failure stops it at
 * once. The same rule on every way in (after a scan, a direct open, a
 * reload). `loaderShownAt` is when the loader appeared, `null` with none.
 */
export function fitReveal(
  requestedAt: number,
  arrivedAt: number,
  ok: boolean,
): { loaderShownAt: number | null; revealAt: number } {
  const arrived = Math.max(arrivedAt, requestedAt);
  const shownAt = requestedAt + LOADING_TIMING.FIT_SHOW_AFTER_MS;
  if (arrived < shownAt) return { loaderShownAt: null, revealAt: arrived };
  const { doneAt } = loaderTimeline(
    shownAt,
    arrived,
    LOADING_TIMING.MIN_DISPLAY_FIT_MS,
    ok,
  );
  return { loaderShownAt: shownAt, revealAt: doneAt };
}

// ---------------------------------------------------------------- one loader

/** What a loader on screen knows, all times on one clock (ms). */
export interface LoaderInput {
  /** When the loader appeared. */
  startedAt: number;
  /** The shortest time it stays (`MIN_DISPLAY_FIT_MS` or `MIN_DISPLAY_PHOTO_MS`). */
  minMs: number;
  /**
   * A wait with real steps (a photo): how many there are in all, the last
   * being the answer, how many have finished and when the last of them did.
   * `null` for a wait with none (the recommendations): the time curve.
   */
  steps: { total: number; done: number; lastAt: number | null } | null;
  /** The answer, once it is here. */
  arrival: { at: number; ok: boolean } | null;
}

export type LoaderPhase = "waiting" | "filling" | "failed" | "done";

export interface LoaderFrame {
  /** 0 to 1: what the ring shows (before it is smoothed on screen). */
  progress: number;
  phase: LoaderPhase;
  /** The loader's own opacity: 1 until it fades out after a full ring. */
  opacity: number;
}

/**
 * What the loader's one `role="status"` region says: `working` while it
 * waits, `done` once the answer is a result, nothing after a failure (the
 * error says it). Never a percentage.
 */
export function loaderStatusText(
  input: Pick<LoaderInput, "arrival">,
  status: { working: string; done: string },
): string {
  if (input.arrival === null) return status.working;
  return input.arrival.ok ? status.done : "";
}

/**
 * The loader to keep on a failure screen (scan S2, 2026-10-21, candidate):
 * the photo's own loader once its answer was a failure, so the ring stays
 * where it stopped, dimmed, the cloud breathed out, above the retry (the
 * results page's `failedLoader` does the same); `null` while it waits, after
 * an ok answer, or with no loader. Pure.
 */
export function failedLoaderInput(
  input: LoaderInput | null,
): LoaderInput | null {
  return input && input.arrival !== null && !input.arrival.ok ? input : null;
}

/** The wait's value at `now`, before any answer: the time curve or the steps. */
export function waitingProgress(input: LoaderInput, now: number): number {
  if (input.steps === null) return timeProgress(now - input.startedAt);
  const since = now - (input.steps.lastAt ?? input.startedAt);
  return stepProgress(input.steps.done, input.steps.total, since);
}

/**
 * The loader at `now`. Before the answer it waits. A failure stops the ring
 * where it was when the answer came. An ok answer keeps the wait going until
 * the minimum time allows, then fills the ring (250 ms) and fades out
 * (200 ms); at `done` it is gone.
 */
export function loaderFrameAt(input: LoaderInput, now: number): LoaderFrame {
  const { arrival } = input;
  if (arrival === null) {
    return {
      progress: waitingProgress(input, now),
      phase: "waiting",
      opacity: 1,
    };
  }
  if (!arrival.ok) {
    return {
      progress: waitingProgress(input, Math.max(arrival.at, input.startedAt)),
      phase: "failed",
      opacity: 1,
    };
  }
  const timeline = loaderTimeline(
    input.startedAt,
    arrival.at,
    input.minMs,
    true,
  );
  if (now < timeline.settleAt) {
    return {
      progress: waitingProgress(input, now),
      phase: "waiting",
      opacity: 1,
    };
  }
  const from = waitingProgress(input, timeline.settleAt);
  return {
    progress: fillProgress(from, now - timeline.settleAt),
    phase: now >= timeline.doneAt ? "done" : "filling",
    opacity: fadeOutOpacity(now, timeline),
  };
}

// ---------------------------------------------------------------- breathing

/** One breath every 4 s: in for 1.6 s, out for 2.4 s. */
export const BREATH = {
  CYCLE_MS: 4000,
  INHALE_MS: 1600,
  EXHALE_MS: 2400,
  /** Brightness of the cloud, out of breath to full breath. */
  BRIGHTNESS: [0.55, 1],
  /** The glow around each lit particle, as an opacity. */
  GLOW: [0.08, 0.22],
  /** The cloud's size. */
  SCALE: [0.985, 1],
} as const;

/** Sine ease-in-out over [0, 1]. */
export function easeInOutSine(t: number): number {
  const x = clamp01(t);
  return -(Math.cos(Math.PI * x) - 1) / 2;
}

/**
 * How full the breath is at `ms` into the loader: 0 breathed out (where it
 * starts and where a failure leaves it), 1 at the top of the breath.
 */
export function breathAt(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  const phase = ms % BREATH.CYCLE_MS;
  if (phase < BREATH.INHALE_MS) return easeInOutSine(phase / BREATH.INHALE_MS);
  return 1 - easeInOutSine((phase - BREATH.INHALE_MS) / BREATH.EXHALE_MS);
}

/** Between the two ends of `range` at `t` (exactly the ends at 0 and 1). */
function lerp(range: readonly [number, number], t: number): number {
  const x = clamp01(t);
  return range[0] * (1 - x) + range[1] * x;
}

export interface BreathLook {
  brightness: number;
  glow: number;
  scale: number;
}

/** The cloud's brightness, glow and size for a breath of `b` (0 to 1). */
export function breathLook(b: number): BreathLook {
  return {
    brightness: lerp(BREATH.BRIGHTNESS, b),
    glow: lerp(BREATH.GLOW, b),
    scale: lerp(BREATH.SCALE, b),
  };
}

/** Reduced motion: no breathing and no flash, the cloud held at full breath. */
export const STILL_BREATH = 1;

/**
 * The breath the loader draws for its phase at `ms` into the wait: breathed
 * out (0) once it has failed, held at `STILL_BREATH` under reduced motion,
 * otherwise `breathAt(ms)`. The ring's progress never depends on this.
 */
export function breathFor(
  phase: LoaderPhase,
  reducedMotion: boolean,
  ms: number,
): number {
  if (phase === "failed") return 0;
  if (reducedMotion) return STILL_BREATH;
  return breathAt(ms);
}

/** What the loader carries from one drawn frame to the next. */
export interface LoaderDrawState {
  /** The ring as drawn (0 to 1). */
  shown: number;
  /** When the last frame was drawn (0 before the first). */
  lastAt: number;
}

export interface LoaderStep {
  state: LoaderDrawState;
  frame: LoaderFrame;
  /** The breath to draw (`breathFor`). */
  breath: number;
  /** Failed or done: no frame is asked for after this one. */
  settled: boolean;
}

/**
 * One drawn frame of the loader at `now`, from the frame before. The fill is
 * eased already; while waiting, a step that jumps is caught up with smoothly
 * (`approach`). A failure stops the ring where it is drawn (where the wait
 * was, for a loader that only now appears). `reducedMotion` only holds the
 * breath: the ring moves the same with it as without it.
 */
export function loaderStep(
  prev: LoaderDrawState,
  input: LoaderInput,
  now: number,
  reducedMotion: boolean,
): LoaderStep {
  const frame = loaderFrameAt(input, now);
  const { shown } = prev;
  const next =
    frame.phase === "waiting"
      ? approach(shown, frame.progress, prev.lastAt > 0 ? now - prev.lastAt : 0)
      : frame.phase === "failed"
        ? shown > 0
          ? shown
          : frame.progress
        : Math.max(shown, frame.progress);
  return {
    state: { shown: next, lastAt: now },
    frame,
    breath: breathFor(frame.phase, reducedMotion, now - input.startedAt),
    settled: frame.phase === "failed" || frame.phase === "done",
  };
}

// ---------------------------------------------------------------- intensity

/** The lit particles' colour: first light, near the cap, and done. */
export const LOADING_COLORS = {
  start: "#8fb2f8",
  /** The home stage's primary stroke colour. */
  near: PALETTE.primary,
  done: "#ffffff",
} as const;

/** The share of particles that are lit: 25 % at the start, all of them at 100 %. */
export const LIT_SHARE = [0.25, 1] as const;

export function litShare(progress: number): number {
  return lerp(LIT_SHARE, progress);
}

/** Whether a particle with this threshold (0 to 1, its own) is lit at `progress`. */
export function isLit(threshold: number, progress: number): boolean {
  return threshold < litShare(progress);
}

function hexChannels(hex: string): [number, number, number] {
  const v = Number.parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** The colour between two `#rrggbb` colours at `t`, as `rgb(r g b)`. */
export function mixHex(a: string, b: string, t: number): string {
  const x = clamp01(t);
  const ca = hexChannels(a);
  const cb = hexChannels(b);
  const c = ca.map((v, i) => Math.round(v + (cb[i]! - v) * x));
  return `rgb(${c[0]} ${c[1]} ${c[2]})`;
}

/**
 * The lit particles' colour at `progress`: #8FB2F8 at the start, #CFE0FF at
 * the 90 % cap, white at 100 % (only after the answer).
 */
export function litColor(progress: number): string {
  const p = clamp01(progress);
  const cap = LOADING_TIMING.WAIT_CAP;
  if (p <= cap)
    return mixHex(LOADING_COLORS.start, LOADING_COLORS.near, p / cap);
  return mixHex(
    LOADING_COLORS.near,
    LOADING_COLORS.done,
    (p - cap) / (1 - cap),
  );
}

export interface ParticleLook {
  lit: boolean;
  /** 0 to 1, before the breath's brightness. */
  alpha: number;
  /** Times the particle's base radius: brighter is bigger. */
  radius: number;
}

/** A lit particle at 0 % and at 100 %, and an unlit one. */
export const PARTICLE_LOOK = {
  LIT_ALPHA: [0.6, 1],
  LIT_RADIUS: [1, 1.7],
  DARK_ALPHA: 0.16,
  DARK_RADIUS: 0.7,
} as const;

/** How a particle with this threshold looks at `progress`. */
export function particleLook(
  threshold: number,
  progress: number,
): ParticleLook {
  if (!isLit(threshold, progress)) {
    return {
      lit: false,
      alpha: PARTICLE_LOOK.DARK_ALPHA,
      radius: PARTICLE_LOOK.DARK_RADIUS,
    };
  }
  return {
    lit: true,
    alpha: lerp(PARTICLE_LOOK.LIT_ALPHA, progress),
    radius: lerp(PARTICLE_LOOK.LIT_RADIUS, progress),
  };
}

// ---------------------------------------------------------------- the ring

export const RING = {
  /** The ring's track. */
  TRACK_ALPHA: 0.12,
  /** A failed wait: the ring stays where it stopped, this dim. */
  FAILED_ALPHA: 0.35,
} as const;

/** The progress arc's end angle (radians, 0 at the top, clockwise) for `progress`. */
export function ringAngle(progress: number): number {
  return clamp01(progress) * Math.PI * 2;
}

// ---------------------------------------------------------------- the cloud

/** The loader's share of the home stage's Canvas 2D budget (candidate). */
export const LOADER_BUDGET_SHARE = 0.5;

/** The cloud's hole in the middle, as a share of its radius. */
export const CLOUD_INNER = 0.18;

/**
 * How many particles the loader draws: half the home stage's budget for its
 * drawing path (`particleCount`, which already halves it on a device with 4
 * cores or fewer). The slow-frame guard (degrade.ts) can draw fewer still.
 */
export function loaderParticleCount(
  wide: boolean,
  hardwareConcurrency: number | undefined,
  renderer: Renderer = "2d",
): number {
  const full = particleCount(wide, hardwareConcurrency, renderer);
  return Math.max(1, Math.floor(full * LOADER_BUDGET_SHARE));
}

export interface CloudPoint {
  /** In the unit disc, centre at 0. */
  x: number;
  y: number;
  /** Lit once `litShare(progress)` passes it. */
  threshold: number;
  /** 0.6 to 1.2: each particle's own base size. */
  size: number;
}

/**
 * The cloud: `count` points spread evenly over a ring-shaped disc (thinner in
 * the middle), each with its own threshold and size. Seeded, so the same
 * count gives the same cloud. The points are in random order, so drawing the
 * first n of them (fewer, under the slow-frame guard) is still an even cloud.
 */
export function cloudPoints(count: number, seed = 20261021): CloudPoint[] {
  const random = mulberry32(seed);
  const n = Math.max(0, Math.floor(count));
  const inner2 = CLOUD_INNER * CLOUD_INNER;
  const points: CloudPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const angle = random() * Math.PI * 2;
    // Even per area between the hole and the edge.
    const r = Math.sqrt(inner2 + (1 - inner2) * random());
    points.push({
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r,
      threshold: random(),
      size: 0.6 + 0.6 * random(),
    });
  }
  return points;
}
