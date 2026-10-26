/**
 * Live soft hints about the hand's placement (V3.3 WP3a, Kirby 2026-10-26,
 * candidate 未拍板; F20 DESIGN-placement-guidance §4.1, §4.3, §4.4 and
 * appendix B). HINTS ONLY: nothing here is an auto-capture gate, the ring
 * fills while a hint shows, and no number changes.
 *
 * The hand is read only every `handSampleIntervalMs` (500 ms), while the cue
 * debounce (cueDebounce.ts) counts 8 Hz samples: one old reading would be
 * counted again and again. So the hand's state is settled per READING here,
 * then handed to `pickCue` (`CueInput.placement`), and the words still go
 * through the cue debounce as usual (§4.4):
 *   - a hint shows after `showAfterReadings` readings in a row failed its
 *     check, and goes after `clearAfterReadings` readings in a row passed;
 *   - each check has a band: once up, a hint goes only when the reading is
 *     back inside a narrower range (wrist 18 / 15 mm, axis 20 / 17°, margin
 *     3 / 5 mm, palm ratio 0.44-0.56 / 0.46-0.54);
 *   - a reading that cannot judge a check (no hand, no sheet at that sample)
 *     leaves that check as it was.
 *
 * `placementCueInput` gives nothing (no hint, today's behaviour) while the
 * hand detector is not loaded or the newest reading is older than
 * `noSheetCapture.handStaleMs` (§4.1). Pure.
 */
import type { WristEdge } from "../photo/handPlacement";
import { CAMERA_CONSTANTS } from "./constants";

/** The live hand hints, in the order `pickCue` puts them (§4.1: on the paper → wrist / inside / direction → flat). */
export const PLACEMENT_CUE_CODES = [
  "hand-missing",
  "wrist-align",
  "hand-inside",
  "hand-straight",
  "hand-flat",
] as const;
export type PlacementCueCode = (typeof PLACEMENT_CUE_CODES)[number];

export function isPlacementCueCode(code: unknown): code is PlacementCueCode {
  return (
    typeof code === "string" &&
    (PLACEMENT_CUE_CODES as readonly string[]).includes(code)
  );
}

export type PlacementHintsMode = "off" | "debug-only" | "on";

/** Whether the WP3 hints (live and post-shot) are on for this visit. Pure. */
export function placementHintsOn(
  debug: boolean,
  mode: PlacementHintsMode = CAMERA_CONSTANTS.placement
    .enabled as PlacementHintsMode,
): boolean {
  if (mode === "on") return true;
  if (mode === "debug-only") return debug === true;
  return false;
}

/** The live part of `CAMERA_CONSTANTS.placement`, widened for tests. */
export interface PlacementLiveThresholds {
  readonly live: {
    readonly handMissing: boolean;
    readonly wristAlign: boolean;
    readonly handInside: boolean;
    readonly handStraight: boolean;
    readonly handFlat: boolean;
    /** The curl half of `hand-flat`: the fingers' distal/proximal ratio. */
    readonly fingerCurl: boolean;
  };
  readonly showAfterReadings: number;
  readonly clearAfterReadings: number;
  readonly wristToEdge: {
    readonly showMinMm: number;
    readonly showMaxMm: number;
    readonly clearMinMm: number;
    readonly clearMaxMm: number;
  };
  readonly sideMargin: {
    readonly showBelowMm: number;
    readonly clearFromMm: number;
  };
  readonly handAxis: {
    readonly showAboveDeg: number;
    readonly clearAtDeg: number;
  };
  readonly palmOverHand: {
    readonly showMin: number;
    readonly showMax: number;
    readonly clearMin: number;
    readonly clearMax: number;
  };
  readonly fingerRatio: {
    readonly showBelow: number;
    readonly clearFrom: number;
  };
  readonly bottomEdgeWristMm: number;
}

export const PLACEMENT_LIVE_THRESHOLDS: PlacementLiveThresholds =
  CAMERA_CONSTANTS.placement;

/** One live hand reading, as the hints see it. */
export interface PlacementObservation {
  /** performance.now() of the hand reading (the same reading is counted once). */
  readonly atMs: number;
  /** Whether the detector found a hand in this reading. */
  readonly handSeen: boolean;
  /** livePlacement.ts; `null` without the sheet's four corners at that sample. */
  readonly wristToEdgeMm: number | null;
  readonly wristEdge: WristEdge | null;
  readonly handAxisDeg: number | null;
  readonly minSideMarginMm: number | null;
  readonly palmOverHand: number | null;
  /** The fingers' mean distal/proximal ratio; missing = not read. */
  readonly fingerRatioMean?: number | null;
}

interface CheckState {
  readonly active: boolean;
  readonly failStreak: number;
  readonly passStreak: number;
}

export interface PlacementHysteresisState {
  /** `atMs` of the last reading counted. */
  readonly lastAtMs: number | null;
  /** The last reading counted. */
  readonly latest: PlacementObservation | null;
  readonly checks: Readonly<Record<PlacementCueCode, CheckState>>;
}

const IDLE: CheckState = { active: false, failStreak: 0, passStreak: 0 };

export const INITIAL_PLACEMENT_HYSTERESIS_STATE: PlacementHysteresisState = {
  lastAtMs: null,
  latest: null,
  checks: {
    "hand-missing": IDLE,
    "wrist-align": IDLE,
    "hand-inside": IDLE,
    "hand-straight": IDLE,
    "hand-flat": IDLE,
  },
};

export type PlacementVerdict = "fail" | "pass" | "unknown";

const num = (x: number | null | undefined): x is number =>
  typeof x === "number" && Number.isFinite(x);

/** Whether a check is switched on (`live`). */
export function placementCheckOn(
  code: PlacementCueCode,
  t: PlacementLiveThresholds = PLACEMENT_LIVE_THRESHOLDS,
): boolean {
  switch (code) {
    case "hand-missing":
      return t.live.handMissing;
    case "wrist-align":
      return t.live.wristAlign;
    case "hand-inside":
      return t.live.handInside;
    case "hand-straight":
      return t.live.handStraight;
    case "hand-flat":
      return t.live.handFlat || t.live.fingerCurl;
  }
}

/**
 * One reading's verdict on one check. `active`: whether the hint is up, which
 * picks the band (show bounds while down, clear bounds while up). A value
 * exactly on a show bound does not fail; one exactly on a clear bound passes.
 * Pure.
 */
export function placementVerdict(
  code: PlacementCueCode,
  obs: PlacementObservation,
  active: boolean,
  t: PlacementLiveThresholds = PLACEMENT_LIVE_THRESHOLDS,
): PlacementVerdict {
  if (code === "hand-missing") return obs.handSeen ? "pass" : "fail";
  if (!obs.handSeen) return "unknown";
  switch (code) {
    case "wrist-align": {
      const v = obs.wristToEdgeMm;
      if (!num(v)) return "unknown";
      const w = t.wristToEdge;
      if (active)
        return v >= w.clearMinMm && v <= w.clearMaxMm ? "pass" : "fail";
      return v < w.showMinMm || v > w.showMaxMm ? "fail" : "pass";
    }
    case "hand-inside": {
      const v = obs.minSideMarginMm;
      if (!num(v)) return "unknown";
      const m = t.sideMargin;
      if (active) return v >= m.clearFromMm ? "pass" : "fail";
      return v < m.showBelowMm ? "fail" : "pass";
    }
    case "hand-straight": {
      if (!num(obs.handAxisDeg)) return "unknown";
      const v = Math.abs(obs.handAxisDeg);
      const a = t.handAxis;
      if (active) return v <= a.clearAtDeg ? "pass" : "fail";
      return v > a.showAboveDeg ? "fail" : "pass";
    }
    case "hand-flat": {
      // Two halves, each on its own switch: the palm/hand ratio (a lifted
      // wrist) and the fingers' ratio (a curl). Either failing fails.
      const verdicts: PlacementVerdict[] = [];
      const v = obs.palmOverHand;
      if (t.live.handFlat && num(v)) {
        const p = t.palmOverHand;
        const ok = active
          ? v >= p.clearMin && v <= p.clearMax
          : !(v < p.showMin || v > p.showMax);
        verdicts.push(ok ? "pass" : "fail");
      }
      const f = obs.fingerRatioMean;
      if (t.live.fingerCurl && num(f)) {
        const r = t.fingerRatio;
        const ok = active ? f >= r.clearFrom : !(f < r.showBelow);
        verdicts.push(ok ? "pass" : "fail");
      }
      if (verdicts.length === 0) return "unknown";
      return verdicts.includes("fail") ? "fail" : "pass";
    }
  }
}

function advanceCheck(
  check: CheckState,
  verdict: PlacementVerdict,
  t: PlacementLiveThresholds,
): CheckState {
  if (verdict === "unknown") return check;
  if (verdict === "fail") {
    const failStreak = check.failStreak + 1;
    return {
      active: check.active || failStreak >= Math.max(1, t.showAfterReadings),
      failStreak,
      passStreak: 0,
    };
  }
  const passStreak = check.passStreak + 1;
  return {
    active: check.active && passStreak < Math.max(1, t.clearAfterReadings),
    failStreak: 0,
    passStreak,
  };
}

/**
 * The state after one hand reading. The same reading (same `atMs`) is not
 * counted twice. A check that is switched off never comes up. Pure.
 */
export function advancePlacementHysteresis(
  state: PlacementHysteresisState,
  obs: PlacementObservation,
  t: PlacementLiveThresholds = PLACEMENT_LIVE_THRESHOLDS,
): PlacementHysteresisState {
  if (!num(obs.atMs) || obs.atMs === state.lastAtMs) return state;
  const checks = { ...state.checks };
  for (const code of PLACEMENT_CUE_CODES) {
    checks[code] = placementCheckOn(code, t)
      ? advanceCheck(
          state.checks[code],
          placementVerdict(code, obs, state.checks[code].active, t),
          t,
        )
      : IDLE;
  }
  return { lastAtMs: obs.atMs, latest: obs, checks };
}

/** What `pickCue` is told about the hand (`CueInput.placement`). */
export interface PlacementCueInput {
  /** The hand hint that is up, first in `PLACEMENT_CUE_CODES` order, or none. */
  readonly hint: PlacementCueCode | null;
  /**
   * §4.3: the newest reading has the wrist within `bottomEdgeWristMm` of the
   * sheet's bottom edge (either side), so "the bottom edge is covered" is
   * the hand meant to be there, and is not said.
   */
  readonly wristNearBottomEdge: boolean;
}

/**
 * The hand's part of the live cue, or `null` (nothing to say; `pickCue`
 * then behaves exactly as before) while the detector is not loaded, no
 * reading was counted, or the newest one is older than `staleMs`. Pure.
 */
export function placementCueInput(
  state: PlacementHysteresisState,
  input: {
    readonly nowMs: number;
    readonly detectorReady: boolean;
    readonly staleMs?: number;
  },
  t: PlacementLiveThresholds = PLACEMENT_LIVE_THRESHOLDS,
): PlacementCueInput | null {
  if (!input.detectorReady) return null;
  const latest = state.latest;
  if (!latest || state.lastAtMs === null) return null;
  const staleMs = input.staleMs ?? CAMERA_CONSTANTS.noSheetCapture.handStaleMs;
  const age = input.nowMs - state.lastAtMs;
  if (!num(age) || age > staleMs) return null;
  let hint: PlacementCueCode | null = null;
  for (const code of PLACEMENT_CUE_CODES) {
    if (placementCheckOn(code, t) && state.checks[code].active) {
      hint = code;
      break;
    }
  }
  const wristNearBottomEdge =
    latest.handSeen &&
    latest.wristEdge === "near-bottom" &&
    num(latest.wristToEdgeMm) &&
    Math.abs(latest.wristToEdgeMm) <= t.bottomEdgeWristMm;
  return { hint, wristNearBottomEdge };
}
