/**
 * G-M2 極簡框＋卡片槽 (L10 P2, 2026-11-02, candidate 未拍板): the layout and
 * the check table of proposal §2, as pure functions. `guides/gm2.ts` wires
 * them into the guide slot and draws the overlay.
 *
 * Frames: the guide sees the hand in VIEW coordinates (0..1 on each axis of
 * the visible picture). Those two axes have different px scales (a portrait
 * view is taller than wide), so every angle, ratio and length here is taken
 * after scaling back to view px (`toViewPx`); only "is this point inside that
 * rectangle" tests stay in 0..1, where the layout lives.
 *
 * Every number below is the proposal's starting guess (candidate); the first
 * session is a calibration, not an acceptance test.
 */
import { GUIDE_COPY } from "./guideCopy";
import {
  boundingBox,
  dist,
  handAxisDeg,
  LM,
  minFingerStraightness,
  overflow,
  thumbSideHand,
  type Pt,
  type Rect,
} from "./handGeometry";
import {
  STEADY_MAX_MOVEMENT,
  TILT_FAIL_DEG,
  TILT_OK_DEG,
} from "./commonChecks";
import type { GuideCheck, GuideInput, HandSide } from "./guides/types";

// ── Layout (right hand; the left hand is the mirror image) ─────────────────

/**
 * Hand bracket box, right hand: x 0.05–0.65, y 0.14–0.70 (v2, 2026-11-02).
 * v1 (x 0.08–0.62, y 0.12–0.78, distance 0.46–0.58) could not fire on
 * Kirby's first session: a naturally spread hand is ≈ 1.17 × its 0→12
 * length wide (view width over view height, portrait 1080 × 1732), so the
 * 0.54-wide box only held hands up to ≈ 0.50 long while the band asked for
 * ≥ 0.46, and the wrist sat ≈ 0.12 above the 0.78 line in every shot
 * (people centre the hand). v2 is sized from those 7 shots (n = 1 person,
 * candidate): 1.17 × 0.50 = 0.585 fits the 0.60 box, the axis stays 0.35.
 *
 * v3 (2026-11-05, candidate 未拍板): x 0.03–0.66, y 0.08–0.88. Session 3
 * (16 shots, right hand, setup R, 9 of them G-M2 v2): Kirby found the
 * window too narrow (「判定範圍太小，需要更 free 的機制」; his first G-M2
 * shot took 50 s, difficulty 5, against 9.5 s / 1 for G-LC). What held the
 * shutter most was the wrist (point 0 in the 0.06-tall band above the
 * 0.70 line: 63% of the first shot's readings failed it) and in-frame
 * (46%). Where the hands were when the shutter fired: wrist y 0.60–0.75,
 * thumb tip x down to 0.051, little fingertip x up to 0.646 (0.715 in a
 * G-LC shot), highest fingertip y 0.19–0.34, distance ratio 0.384–0.517.
 * So: the box grows (its right edge 0.66 stays clear of the card slot at
 * 0.68; tolerance still 0.02); the wrist only has to be inside the box
 * with y 0.55–0.88 (`GM2_WRIST_BAND`), and the line is drawn as a faint
 * reference, not a threshold; distance max 0.50 → 0.56 (min stays 0.38:
 * far shots read the hand short); axis 12° → 15° (as G-LC). Tilt is NOT
 * loosened: the four 9–20° shots were tilted on purpose and pressed by
 * hand, and were also held far (ratio 0.28–0.37), so the data cannot tell
 * tilt from distance. n = 1 person.
 */
export const GM2_HAND_ZONE = { x0: 0.03, x1: 0.66, y0: 0.08, y1: 0.88 };
/** v3: the band point 0 may sit in (fraction of the view's height). */
export const GM2_WRIST_BAND = { y0: 0.55, y1: 0.88 } as const;
/**
 * v3: a faint reference line only (not a threshold), where Kirby's wrists
 * sat in session 3 (y 0.60–0.75; v2's line).
 */
export const GM2_WRIST_LINE_Y = 0.7;
/** The middle-finger axis tick, right hand. */
export const GM2_AXIS_X = 0.35;
/**
 * Card zone, right hand: x 0.68–0.90 (≥ 10% of the width from the edge),
 * centred on y 0.42 (v2: moved with the wrist line). Drawn as a loose zone about 1.4 × the card's long side
 * at the middle of the distance band (86 mm / 190 mm × 0.52 × 1.4 ≈ 0.33 of
 * the long edge), not to scale, so nobody uses it as a distance target.
 */
export const GM2_CARD_ZONE = { x0: 0.68, x1: 0.9, cy: 0.42, height: 0.32 };
/**
 * The spirit level, right hand: inside the card slot's top, centred on it
 * (v3.4 review K2: the lab's top-right corner sat on the hand chip).
 */
export const GM2_LEVEL_AT = { x: 0.79, y: 0.285 };

export interface Gm2Layout {
  readonly side: HandSide;
  readonly handZone: Rect;
  readonly wristLineY: number;
  readonly axisX: number;
  readonly cardZone: Rect;
  readonly levelAt: Pt;
  readonly thresholds: typeof GM2_THRESHOLDS;
}

/** A right-hand x span as a rectangle, mirrored left↔right for the left hand. */
export function spanRect(
  side: HandSide,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): Rect {
  const left = side === "right" ? x0 : 1 - x1;
  return { x: left, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function gm2Layout(side: HandSide): Gm2Layout {
  const z = GM2_HAND_ZONE;
  const c = GM2_CARD_ZONE;
  return {
    side,
    handZone: spanRect(side, z.x0, z.x1, z.y0, z.y1),
    wristLineY: GM2_WRIST_LINE_Y,
    axisX: side === "right" ? GM2_AXIS_X : 1 - GM2_AXIS_X,
    cardZone: spanRect(
      side,
      c.x0,
      c.x1,
      c.cy - c.height / 2,
      c.cy + c.height / 2,
    ),
    levelAt:
      side === "right"
        ? GM2_LEVEL_AT
        : { x: 1 - GM2_LEVEL_AT.x, y: GM2_LEVEL_AT.y },
    thresholds: GM2_THRESHOLDS,
  };
}

// ── Thresholds (proposal §2 table, all candidate) ──────────────────────────

export const GM2_THRESHOLDS = {
  /** #2 MediaPipe hand confidence (judged only when the page passes one). */
  minConfidence: 0.7,
  /** #3 The landmarks may stick out of the brackets by this much (view 0..1). */
  inFrameTolerance: 0.02,
  /** #4 0→12 px length over the view's long edge (v3: max 0.50 → 0.56; session 3 fired at 0.384–0.517). */
  distanceMin: 0.38,
  distanceMax: 0.56,
  /** #5 v3: point 0 inside the box with y in this band (fraction of the view's height). */
  wristMinY: GM2_WRIST_BAND.y0,
  wristMaxY: GM2_WRIST_BAND.y1,
  /** #6 0→9 against the vertical axis, degrees (v3: 12 → 15, as G-LC). */
  axisMaxDeg: 15,
  /** #7 Least straight of the four fingers (straight ÷ path). */
  fingerStraightMin: 0.9,
  /** #8 Phone tilt: green ≤ ok, amber ≤ fail (recorded, not held), block above. */
  tiltOkDeg: TILT_OK_DEG,
  tiltFailDeg: TILT_FAIL_DEG,
  /** #9 Largest landmark move between readings over the view's diagonal. */
  steadyMaxMovement: STEADY_MAX_MOVEMENT,
  /** All pass for this long → auto shutter. */
  holdMs: 1200,
  /** Hint hysteresis. */
  hintHoldMs: 700,
} as const;

/** Landmarks the in-frame check keeps inside the brackets: wrist, thumb tip, 5, 17, fingertips. */
export const GM2_IN_FRAME_POINTS: readonly number[] = [
  LM.wrist,
  LM.thumbTip,
  LM.indexMcp,
  LM.pinkyMcp,
  LM.indexTip,
  LM.middleTip,
  LM.ringTip,
  LM.pinkyTip,
];

// ── Copy (繁中, candidate; natural posture, no medical wording) ───────────

export const GM2_COPY = {
  loading: GUIDE_COPY.loading,
  noHand: "手背朝上，平放進框內，手指朝上",
  inFrame: "整隻手放進框內",
  closer: "手機再靠近一點",
  higher: "手機再拿高一點",
  /** v3: point 0 too low (y > 0.88): the hand goes up the picture. */
  wristUp: "手往上移一點",
  /** v3: point 0 too high (y < 0.55): the hand goes down the picture. */
  wristDown: "手往下移一點",
  axis: "手放正，中指對準中線",
  fingers: GUIDE_COPY.fingersStraight,
  tilt: GUIDE_COPY.levelPhone,
  steady: GUIDE_COPY.steady,
  ok: GUIDE_COPY.locked,
  sideRight: "看起來是右手，請確認左右手的選擇",
  sideLeft: "看起來是左手，請確認左右手的選擇",
} as const;

/**
 * The pre-shot card for G-M2. Kirby 2026-11-05: in card mode the hand
 * posture matches A4, fingers straight and together (伸直併攏); this
 * replaces decision 3's natural spread. The live checks do not judge the
 * spread (only straightness), so nothing else changes.
 */
export const GM2_STEPS: readonly string[] = [
  "① 卡片直放在小指那一側的桌上、虛線區裡，大約對齊指根；不要拿在手上、不要墊高",
  "② 手背朝上，手掌和手腕整段貼桌；手指伸直併攏",
  "③ 中指大約對準中線，整隻手放進框裡，前臂從畫面下方伸出去",
  "④ 手機直拿、在正上方放平，整隻手和卡片都入鏡",
];

// ── Checks ─────────────────────────────────────────────────────────────────

/** View 0..1 → view px (so angles and ratios are true). */
export function toViewPx(
  points: readonly Pt[],
  view: { readonly width: number; readonly height: number },
): Pt[] {
  return points.map((p) => ({ x: p.x * view.width, y: p.y * view.height }));
}

const pass = (id: string, hint: string, value?: number | null): GuideCheck => ({
  id,
  level: "ok",
  blocks: true,
  hint,
  value,
});
const fail = (id: string, hint: string, value?: number | null): GuideCheck => ({
  id,
  level: "fail",
  blocks: true,
  hint,
  value,
});

/** The confidence the page may pass with the hand (not in `GuideHand` yet). */
export function handConfidence(hand: GuideInput["hand"]): number | null {
  const c = (hand as unknown as { readonly confidence?: unknown } | null)
    ?.confidence;
  return typeof c === "number" && Number.isFinite(c) ? c : null;
}

/** #2 A hand, at confidence ≥ 0.7 when a confidence is known. */
export function gm2HandCheck(input: GuideInput): GuideCheck {
  if (!input.hand) return fail("hand", GM2_COPY.noHand, null);
  const c = handConfidence(input.hand);
  if (c !== null && c < GM2_THRESHOLDS.minConfidence)
    return fail("hand", GM2_COPY.noHand, c);
  return pass("hand", GM2_COPY.noHand, c);
}

export interface InFrameResult {
  readonly check: GuideCheck;
  /** How far past the brackets on each side (view 0..1), beyond the tolerance. */
  readonly out: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  };
}

/** #3 The hand's key points inside the brackets (2% tolerance). */
export function gm2InFrame(
  points: readonly Pt[],
  layout: Gm2Layout,
): InFrameResult {
  const box = boundingBox(points, GM2_IN_FRAME_POINTS);
  const o = overflow(box, layout.handZone);
  const t = GM2_THRESHOLDS.inFrameTolerance;
  const out = {
    left: Math.max(0, o.left - t),
    right: Math.max(0, o.right - t),
    top: Math.max(0, o.top - t),
    bottom: Math.max(0, o.bottom - t),
  };
  const worst = Math.max(o.left, o.right, o.top, o.bottom);
  const inside = out.left + out.right + out.top + out.bottom === 0;
  return {
    check: inside
      ? pass("inFrame", GM2_COPY.inFrame, worst)
      : fail("inFrame", GM2_COPY.inFrame, worst),
    out,
  };
}

/** #4 0→12 over the long edge, in view px: 0.38–0.56 (v3). */
export function gm2DistanceRatio(
  points: readonly Pt[],
  view: GuideInput["view"],
): number | null {
  const long = Math.max(view.width, view.height);
  if (!(long > 0)) return null;
  const px = toViewPx([points[LM.wrist], points[LM.middleTip]], view);
  return dist(px[0], px[1]) / long;
}

export function gm2DistanceCheck(
  points: readonly Pt[],
  view: GuideInput["view"],
): GuideCheck {
  const r = gm2DistanceRatio(points, view);
  if (r === null) return fail("distance", GM2_COPY.closer, null);
  if (r < GM2_THRESHOLDS.distanceMin)
    return fail("distance", GM2_COPY.closer, r);
  if (r > GM2_THRESHOLDS.distanceMax)
    return fail("distance", GM2_COPY.higher, r);
  return pass("distance", GM2_COPY.closer, r);
}

/**
 * #5 (v3) Point 0 inside the box sideways (with the in-frame tolerance) and
 * its y in 0.55–0.88. Value: point 0's y (view 0..1). The hint says which
 * way: too low →「手往上移一點」, too high →「手往下移一點」; out sideways →
 * the in-frame words (in-frame comes first and already says it).
 */
export function gm2WristCheck(
  points: readonly Pt[],
  layout: Gm2Layout,
): GuideCheck {
  const t = GM2_THRESHOLDS;
  const w = points[LM.wrist];
  if (!w || !Number.isFinite(w.x) || !Number.isFinite(w.y))
    return fail("wrist", GM2_COPY.inFrame, null);
  if (w.y > t.wristMaxY) return fail("wrist", GM2_COPY.wristUp, w.y);
  if (w.y < t.wristMinY) return fail("wrist", GM2_COPY.wristDown, w.y);
  const z = layout.handZone;
  const tol = t.inFrameTolerance;
  if (w.x < z.x - tol || w.x > z.x + z.width + tol)
    return fail("wrist", GM2_COPY.inFrame, w.y);
  return pass("wrist", GM2_COPY.wristUp, w.y);
}

/** #6 0→9 against the vertical axis (view px), |angle| ≤ 15° (v3). Value: signed degrees. */
export function gm2AxisCheck(
  points: readonly Pt[],
  view: GuideInput["view"],
): GuideCheck {
  const deg = handAxisDeg(toViewPx(points, view));
  return Number.isFinite(deg) && Math.abs(deg) <= GM2_THRESHOLDS.axisMaxDeg
    ? pass("axis", GM2_COPY.axis, deg)
    : fail("axis", GM2_COPY.axis, Number.isFinite(deg) ? deg : null);
}

/** #7 Every finger straight (view px): min ratio ≥ 0.90. The spread is not judged. */
export function gm2FingersCheck(
  points: readonly Pt[],
  view: GuideInput["view"],
): GuideCheck {
  const s = minFingerStraightness(toViewPx(points, view));
  if (s === null) return fail("fingers", GM2_COPY.fingers, null);
  return s >= GM2_THRESHOLDS.fingerStraightMin
    ? pass("fingers", GM2_COPY.fingers, s)
    : fail("fingers", GM2_COPY.fingers, s);
}

/** #8 Tilt: ≤ 4° ok, 4–8° warn (not held), > 8° fail; no sensor: warn. */
export function gm2TiltCheck(tiltDeg: number | null): GuideCheck {
  const hint = GM2_COPY.tilt;
  if (tiltDeg === null || !Number.isFinite(tiltDeg))
    return {
      id: "tilt",
      level: "warn",
      blocks: false,
      hint,
      value: null,
      quiet: true,
    };
  if (tiltDeg <= GM2_THRESHOLDS.tiltOkDeg) return pass("tilt", hint, tiltDeg);
  if (tiltDeg <= GM2_THRESHOLDS.tiltFailDeg)
    return { id: "tilt", level: "warn", blocks: false, hint, value: tiltDeg };
  return fail("tilt", hint, tiltDeg);
}

/** #9 Steady: movement < 0.03 of the diagonal (none to compare yet: fail). */
export function gm2SteadyCheck(movement: number | null): GuideCheck {
  if (movement === null || !Number.isFinite(movement))
    return fail("steady", GM2_COPY.steady, null);
  return movement < GM2_THRESHOLDS.steadyMaxMovement
    ? pass("steady", GM2_COPY.steady, movement)
    : fail("steady", GM2_COPY.steady, movement);
}

/**
 * Recorded only (proposal §2 shared rule): the thumb-side hand against the
 * chosen one. A mismatch is a warn that never holds the shutter; it comes
 * last so it never hides a real problem. Value: 1 match, 0 mismatch, null
 * unknown.
 */
export function gm2SideCheck(
  points: readonly Pt[],
  chosen: HandSide,
): GuideCheck {
  const seen = thumbSideHand(points);
  const hint = seen === "left" ? GM2_COPY.sideLeft : GM2_COPY.sideRight;
  if (seen === null || seen === chosen)
    return {
      id: "side",
      level: "ok",
      blocks: false,
      hint,
      value: seen === null ? null : 1,
    };
  return {
    id: "side",
    level: "warn",
    blocks: false,
    hint,
    value: 0,
    quiet: true,
  };
}

export interface Gm2Result {
  readonly layout: Gm2Layout;
  /** Priority order (proposal §2): the first not-ok one gives the hint. */
  readonly checks: readonly GuideCheck[];
  /** Overflow per side beyond the tolerance, when a hand was checked. */
  readonly out: InFrameResult["out"] | null;
}

/**
 * The full table for one reading. Without the detector or a hand, the
 * hand-dependent checks are left out (the first fail already holds the
 * shutter); tilt is always judged so the level stays live.
 */
export function evaluateGm2Checks(input: GuideInput): Gm2Result {
  const layout = gm2Layout(input.side);
  const detector: GuideCheck = input.detectorReady
    ? pass("detector", GM2_COPY.loading)
    : fail("detector", GM2_COPY.loading);
  const hand = gm2HandCheck(input);
  const tilt = gm2TiltCheck(input.tiltDeg);
  if (!input.detectorReady || hand.level !== "ok" || !input.hand)
    return { layout, checks: [detector, hand, tilt], out: null };
  const p = input.hand.points;
  const frame = gm2InFrame(p, layout);
  return {
    layout,
    out: frame.out,
    checks: [
      detector,
      hand,
      frame.check,
      gm2DistanceCheck(p, input.view),
      gm2WristCheck(p, layout),
      gm2AxisCheck(p, input.view),
      gm2FingersCheck(p, input.view),
      tilt,
      gm2SteadyCheck(input.movement),
      gm2SideCheck(p, input.side),
    ],
  };
}
