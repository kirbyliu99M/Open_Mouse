/**
 * Scan lab L10 P1 (candidate 未拍板): what the page does with a version's
 * `GuideEvaluation` on each reading, the same for every version: pick the
 * hint (first problem in priority order), hold it for the hysteresis time
 * so it does not flicker, decide the auto shutter, and count what the record
 * keeps about the process. Pure reducers.
 */
import type { GuideCheck, GuideEvaluation } from "./guides/types";

export const DEFAULT_HINT_HOLD_MS = 700;

/** The status of a reading: the worst level among its checks. */
export function statusOf(
  checks: readonly GuideCheck[],
): "ok" | "warn" | "fail" {
  if (checks.some((c) => c.level === "fail")) return "fail";
  if (checks.some((c) => c.level === "warn")) return "warn";
  return "ok";
}

/** The first check that is not ok (priority order), or null. */
export function firstProblem(checks: readonly GuideCheck[]): GuideCheck | null {
  return checks.find((c) => c.level !== "ok" && !c.quiet) ?? null;
}

/** The hint the reading asks for: the first problem's, else the ok hint. */
export function wantedHint(evaluation: GuideEvaluation): {
  readonly text: string;
  readonly checkId: string | null;
  readonly level: "ok" | "warn" | "fail";
} {
  const p = firstProblem(evaluation.checks);
  return p
    ? { text: p.hint, checkId: p.id, level: p.level }
    : { text: evaluation.okHint, checkId: null, level: "ok" };
}

/** Whether the checks let the shutter fill (no blocking fail). */
export function checksAllowShutter(checks: readonly GuideCheck[]): boolean {
  return !checks.some((c) => c.level === "fail" && c.blocks);
}

/** The shutter step for a reading: the version's override, else from the checks. */
export function shutterStep(
  evaluation: GuideEvaluation,
): "fill" | "pause" | "reset" {
  if (evaluation.shutter) return evaluation.shutter;
  return checksAllowShutter(evaluation.checks) ? "fill" : "reset";
}

// ── Hint hysteresis ────────────────────────────────────────────────────────

export interface HintState {
  /** What is on screen. */
  readonly shown: {
    readonly text: string;
    readonly checkId: string | null;
    readonly level: "ok" | "warn" | "fail";
  } | null;
  /** A different hint waiting to replace it, and since when. */
  readonly candidate: {
    readonly text: string;
    readonly checkId: string | null;
    readonly level: "ok" | "warn" | "fail";
    readonly sinceMs: number;
  } | null;
  /** How many times the shown hint changed. */
  readonly switches: number;
}

export const INITIAL_HINT: HintState = {
  shown: null,
  candidate: null,
  switches: 0,
};

/**
 * Show `wanted` once it has been asked for `holdMs` in a row (the first hint
 * shows at once). Asking for the shown one again drops the candidate.
 */
export function advanceHint(
  state: HintState,
  wanted: {
    readonly text: string;
    readonly checkId: string | null;
    readonly level: "ok" | "warn" | "fail";
  },
  nowMs: number,
  holdMs: number = DEFAULT_HINT_HOLD_MS,
): HintState {
  if (!state.shown) return { shown: wanted, candidate: null, switches: 0 };
  if (state.shown.text === wanted.text && state.shown.level === wanted.level)
    return { ...state, candidate: null };
  const candidate =
    state.candidate &&
    state.candidate.text === wanted.text &&
    state.candidate.level === wanted.level
      ? state.candidate
      : { ...wanted, sinceMs: nowMs };
  if (nowMs - candidate.sinceMs >= holdMs)
    return { shown: wanted, candidate: null, switches: state.switches + 1 };
  return { ...state, candidate };
}

// ── Auto shutter ───────────────────────────────────────────────────────────

export interface HoldState {
  readonly elapsedMs: number;
  readonly fired: boolean;
}

export const INITIAL_HOLD: HoldState = { elapsedMs: 0, fired: false };

/** Advance the hold by one reading `dtMs` after the last. */
export function advanceHold(
  state: HoldState,
  step: "fill" | "pause" | "reset",
  dtMs: number,
  holdMs: number,
): HoldState {
  if (state.fired) return state;
  if (step === "reset") return INITIAL_HOLD;
  if (step === "pause") return state;
  const elapsedMs = state.elapsedMs + Math.max(0, dtMs);
  return elapsedMs >= holdMs
    ? { elapsedMs: holdMs, fired: true }
    : { elapsedMs, fired: false };
}

export function holdFraction(state: HoldState, holdMs: number): number {
  return holdMs > 0 ? Math.min(1, state.elapsedMs / holdMs) : 1;
}

// ── Process log (kept in the record) ───────────────────────────────────────

/** One reading as the record keeps it. */
export interface CheckSnapshot {
  readonly atMs: number;
  readonly status: "ok" | "warn" | "fail";
  /** Ids of the checks not ok, with their level. */
  readonly problems: readonly string[];
}

export interface ProcessLog {
  readonly startedAtMs: number;
  /** The latest readings (at most `PROCESS_RECENT`). */
  readonly recent: readonly CheckSnapshot[];
  /** Per check id: ms it was not ok, time-weighted by the gap to the next reading. */
  readonly notOkMs: Readonly<Record<string, number>>;
  /** Total ms covered by readings. */
  readonly totalMs: number;
  readonly readings: number;
  readonly lastAtMs: number | null;
}

export const PROCESS_RECENT = 10;

export function startProcess(nowMs: number): ProcessLog {
  return {
    startedAtMs: nowMs,
    recent: [],
    notOkMs: {},
    totalMs: 0,
    readings: 0,
    lastAtMs: null,
  };
}

/** Add a reading; the gap since the previous one is charged to the previous one's problems. */
export function recordReading(
  log: ProcessLog,
  checks: readonly GuideCheck[],
  nowMs: number,
): ProcessLog {
  const snapshot: CheckSnapshot = {
    atMs: Math.round(nowMs - log.startedAtMs),
    status: statusOf(checks),
    problems: checks
      .filter((c) => c.level !== "ok")
      .map((c) => `${c.id}:${c.level}`),
  };
  const previous = log.recent[log.recent.length - 1] ?? null;
  const dt = log.lastAtMs === null ? 0 : Math.max(0, nowMs - log.lastAtMs);
  const notOkMs: Record<string, number> = { ...log.notOkMs };
  if (previous)
    for (const p of previous.problems) {
      const id = p.split(":")[0];
      notOkMs[id] = (notOkMs[id] ?? 0) + dt;
    }
  return {
    startedAtMs: log.startedAtMs,
    recent: [...log.recent, snapshot].slice(-PROCESS_RECENT),
    notOkMs,
    totalMs: log.totalMs + dt,
    readings: log.readings + 1,
    lastAtMs: nowMs,
  };
}

/** Per check: the fraction of the covered time it was not ok. */
export function notOkFractions(log: ProcessLog): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, ms] of Object.entries(log.notOkMs))
    out[id] = log.totalMs > 0 ? ms / log.totalMs : 0;
  return out;
}
