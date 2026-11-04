/**
 * Scan lab L10 P1 (candidate 未拍板): checks most guide versions share,
 * built from a `GuideInput`. A version lists the ones it wants, in its own
 * priority order, next to its own checks. Thresholds are the proposal's
 * starting guesses (§2), all candidate. Pure.
 */
import { GUIDE_COPY } from "./guideCopy";
import { minFingerStraightness } from "./handGeometry";
import type { GuideCheck, GuideInput } from "./guides/types";

/** Steady: the largest landmark move between two readings, over the view's diagonal. */
export const STEADY_MAX_MOVEMENT = 0.03;
/** Fingers straight: the least straight of the four fingers. */
export const FINGER_STRAIGHT_MIN = 0.9;
/** Phone tilt: ok at or under, warn up to `TILT_FAIL_DEG`, fail above. */
export const TILT_OK_DEG = 4;
export const TILT_FAIL_DEG = 8;

const ok = (id: string, hint: string, value?: number | null): GuideCheck => ({
  id,
  level: "ok",
  blocks: true,
  hint,
  value,
});

/** The detector has loaded. */
export function detectorCheck(input: GuideInput): GuideCheck {
  return input.detectorReady
    ? ok("detector", GUIDE_COPY.loading)
    : { id: "detector", level: "fail", blocks: true, hint: GUIDE_COPY.loading };
}

/** A hand is in the latest reading. */
export function handCheck(
  input: GuideInput,
  hint: string = GUIDE_COPY.noHand,
): GuideCheck {
  return input.hand
    ? ok("hand", hint)
    : { id: "hand", level: "fail", blocks: true, hint };
}

/** The hand held still between the last two readings. */
export function steadyCheck(
  input: GuideInput,
  maxMovement: number = STEADY_MAX_MOVEMENT,
  blocks = true,
  hint: string = GUIDE_COPY.steady,
): GuideCheck {
  const m = input.movement;
  if (m === null)
    return { id: "steady", level: "fail", blocks, hint, value: null };
  return m < maxMovement
    ? { ...ok("steady", hint, m), blocks }
    : { id: "steady", level: "fail", blocks, hint, value: m };
}

/** Every finger straight (bent fingers fail; the spread is not judged). */
export function fingersCheck(
  input: GuideInput,
  min: number = FINGER_STRAIGHT_MIN,
  hint: string = GUIDE_COPY.fingersStraight,
): GuideCheck {
  const s = input.hand ? minFingerStraightness(input.hand.points) : null;
  if (s === null)
    return { id: "fingers", level: "fail", blocks: true, hint, value: null };
  return s >= min
    ? ok("fingers", hint, s)
    : { id: "fingers", level: "fail", blocks: true, hint, value: s };
}

/**
 * The phone's tilt: ok ≤ `okDeg`, warn (does not hold the shutter) up to
 * `failDeg`, fail above. No sensor reading: warn (recorded, not held).
 */
export function tiltCheck(
  input: GuideInput,
  okDeg: number = TILT_OK_DEG,
  failDeg: number = TILT_FAIL_DEG,
  hint: string = GUIDE_COPY.levelPhone,
): GuideCheck {
  const t = input.tiltDeg;
  if (t === null)
    return {
      id: "tilt",
      level: "warn",
      blocks: false,
      hint,
      value: null,
      quiet: true,
    };
  if (t <= okDeg) return ok("tilt", hint, t);
  if (t <= failDeg)
    return { id: "tilt", level: "warn", blocks: false, hint, value: t };
  return { id: "tilt", level: "fail", blocks: true, hint, value: t };
}
