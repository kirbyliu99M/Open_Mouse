/**
 * Post-shot soft hint (V3.3 WP1a, 2026-10-25, 未拍板 candidate): picks AT MOST
 * ONE light, dismissible reminder for one analysed photo, e.g. "your wrist may
 * not be at the paper's edge". Design: F20 DESIGN-placement-guidance appendix A
 * (Kirby's proposal) and appendix B (Kirby's decision): these checks are hints
 * only. They are NOT gates: they never block auto-capture or the confirm
 * button and never change a number. The thresholds below only decide whether a
 * reminder is worth showing; WP2's real scans set the actual values.
 *
 * Returns a code, never user-facing text: the strings belong in the copy
 * module (zh-TW + en) and are added with the UI work.
 *
 * ── Priority (first that fires wins; follows the live cue order of §4.1:
 *    distance → hand on paper → hand position → hand flat → focus) ──
 *   1. `paper-small`    the sheet fills too little of the photo's width
 *   2. `hand-inside`    a finger or the wrist is near/over a side or the far edge
 *   3. `wrist-align`    the wrist is too far from (or past) its short edge
 *   4. `hand-straight`  the hand axis is turned too far from the sheet's long side
 *   5. `hand-flat`      palm/hand ratio or reach out of band, or (when enabled)
 *                       the 3D palm tilt / finger flex is too large
 *   6. `blurry`         the photo is soft (off by default, see below)
 * Rationale: a cause that also distorts the later readings goes first (a hand
 * off the sheet makes the wrist and ratio readings moot). Placing `blurry`
 * last mirrors §4.1 ("對焦" last); whether blur should outrank the hand hints
 * after a shot is for Claude/Kirby to decide.
 *
 * ── Throttle (appendix A: "the same hint shown 3 times in a row on one device
 *    is not shown again") ──
 * The caller keeps, per device, the CANDIDATE code of each recent photo
 * (`SoftHintResult.candidate`, the hint chosen before throttling; `null` for a
 * photo with no hint), most recent last. When the last `repeatLimit` entries
 * all equal this photo's candidate, the hint is suppressed (`code: null`,
 * `suppressed: true`). No lower-priority hint is shown in its place. A photo
 * with no hint or a different one breaks the streak, after which the hint can
 * show again.
 *
 * A metric that is `null` (not measured, not available) never fires. A value
 * exactly on a limit does not fire (the milder side, as in handFlatness.ts).
 */

export const SOFT_HINT_CODES = [
  "paper-small",
  "hand-inside",
  "wrist-align",
  "hand-straight",
  "hand-flat",
  "blurry",
] as const;
export type SoftHintCode = (typeof SOFT_HINT_CODES)[number];

/** One photo's readings; any of them may be null when not measured. */
export interface SoftHintInput {
  /** handPlacement.ts, sheet mm, positive inside. */
  readonly wristToEdgeMm: number | null;
  /** handPlacement.ts, degrees, signed. */
  readonly handAxisDeg: number | null;
  /** handPlacement.ts, sheet mm, positive inside. */
  readonly minSideMarginMm: number | null;
  /** handPlacement.ts. */
  readonly palmOverHand: number | null;
  /** handFlatness.ts `reachMean`. */
  readonly reachMean: number | null;
  /** handWorld.ts, degrees. */
  readonly palmTiltDeg: number | null;
  /** handWorld.ts, degrees per finger. */
  readonly fingerFlexDeg: readonly number[] | null;
  /**
   * handPlacement.ts `distalOverProximal`, the four fingers' mean
   * (`meanFingerRatio`): about 0.47 flat, about 0.18 fully curled (Kirby's
   * S25 test, 2026-10-26, n = 1 each).
   */
  readonly fingerRatioMean?: number | null;
  /** Laplacian variance of the analysed photo (attempt log `sharpness`). */
  readonly sharpness: number | null;
  /** Paper width as a fraction of the photo width (attempt log `paper.widthFraction`). */
  readonly paperWidthFraction: number | null;
}

export interface SoftHintThresholds {
  /** `wrist-align` when wristToEdgeMm < this. */
  readonly wristToEdgeMinMm: number;
  /** `wrist-align` when wristToEdgeMm > this. */
  readonly wristToEdgeMaxMm: number;
  /** `hand-straight` when |handAxisDeg| > this. */
  readonly handAxisMaxDeg: number;
  /** `hand-inside` when minSideMarginMm < this. */
  readonly minSideMarginMm: number;
  /** `hand-flat` when palmOverHand < this. */
  readonly palmOverHandMin: number;
  /** `hand-flat` when palmOverHand > this. */
  readonly palmOverHandMax: number;
  /** `hand-flat` when reachMean < this. */
  readonly reachMeanMin: number;
  /** `hand-flat` when reachMean > this. */
  readonly reachMeanMax: number;
  /** `hand-flat` when palmTiltDeg > this; null = check off. */
  readonly palmTiltMaxDeg: number | null;
  /** `hand-flat` when any finger's flex > this; null = check off. */
  readonly fingerFlexMaxDeg: number | null;
  /** `hand-flat` when the fingers' mean distal/proximal ratio < this; null = check off. */
  readonly fingerRatioMin: number | null;
  /** `paper-small` when paperWidthFraction < this. */
  readonly minPaperWidthFraction: number;
  /** `blurry` when sharpness < this; null = check off. */
  readonly minSharpness: number | null;
  /** Same candidate this many times in a row → suppressed. */
  readonly repeatLimit: number;
}

/**
 * ALL CANDIDATES (未拍板), copied from the design; they decide only whether a
 * reminder is shown, never a gate. WP2's real scans replace them.
 */
export const SOFT_HINT_THRESHOLDS: SoftHintThresholds = Object.freeze({
  // Kirby's S25 tests 2026-10-26 (實測): on the edge -3 to +3 mm, slightly
  // above +10 to +13 mm. The banner is only for "too far up" (> 15 mm); a
  // wrist past the edge either hides the edge (the photo is refused with its
  // own message) or measured fine, so no banner below. 候選.
  wristToEdgeMinMm: -Infinity,
  wristToEdgeMaxMm: 15,
  // §1.1: ≤ 20° (推估).
  handAxisMaxDeg: 20,
  // §1.1: ≥ 3 mm (推估).
  minSideMarginMm: 3,
  // §2.3: outside 0.44–0.56 (推估; flat 0.49–0.50 實測, big wrist lift 0.405 實測).
  palmOverHandMin: 0.44,
  palmOverHandMax: 0.56,
  // §2.3: outside 0.75–1.10 (推估).
  reachMeanMin: 0.75,
  reachMeanMax: 1.1,
  // §2.3 / WP5: the 3D readings stay record-only until WP2 shows they separate.
  palmTiltMaxDeg: null,
  fingerFlexMaxDeg: null,
  // Kirby's S25 test 2026-10-26 (實測, n = 1 each): flat or slightly curved
  // 0.44-0.49 per finger (mean 0.47), fully curled 0.10-0.31 (mean 0.18; the
  // hand read 25 mm short). The palm/hand ratio and reachMean stayed in band
  // for the curl, so this is the one that tells them apart. 候選.
  fingerRatioMin: 0.35,
  // §3.2: auto-capture's lower bound stays 0.55.
  minPaperWidthFraction: 0.55,
  // Appendix A: LOW_SHARPNESS's 50 fires on most of Kirby's frames (實測
  // 30–50), so it would nag; off until a new value is set.
  minSharpness: null,
  // Appendix A: 3 in a row.
  repeatLimit: 3,
});

export interface SoftHintResult {
  /** The hint to show, or null. */
  readonly code: SoftHintCode | null;
  /** The hint chosen before throttling; the caller appends this to the device history. */
  readonly candidate: SoftHintCode | null;
  /** True when `candidate` was dropped by the throttle. */
  readonly suppressed: boolean;
  /** Every check that fired, in priority order (for the local log). */
  readonly fired: readonly SoftHintCode[];
}

const num = (x: number | null | undefined): x is number =>
  typeof x === "number" && Number.isFinite(x);

/** Every hint whose check fires, in priority order. */
export function firedSoftHints(
  input: SoftHintInput,
  t: SoftHintThresholds = SOFT_HINT_THRESHOLDS,
): SoftHintCode[] {
  const out: SoftHintCode[] = [];
  if (
    num(input.paperWidthFraction) &&
    input.paperWidthFraction < t.minPaperWidthFraction
  ) {
    out.push("paper-small");
  }
  if (num(input.minSideMarginMm) && input.minSideMarginMm < t.minSideMarginMm) {
    out.push("hand-inside");
  }
  if (
    num(input.wristToEdgeMm) &&
    (input.wristToEdgeMm < t.wristToEdgeMinMm ||
      input.wristToEdgeMm > t.wristToEdgeMaxMm)
  ) {
    out.push("wrist-align");
  }
  if (
    num(input.handAxisDeg) &&
    Math.abs(input.handAxisDeg) > t.handAxisMaxDeg
  ) {
    out.push("hand-straight");
  }
  const flexOver =
    t.fingerFlexMaxDeg !== null &&
    Array.isArray(input.fingerFlexDeg) &&
    input.fingerFlexDeg.some(
      (f) => num(f) && f > (t.fingerFlexMaxDeg as number),
    );
  if (
    (num(input.palmOverHand) &&
      (input.palmOverHand < t.palmOverHandMin ||
        input.palmOverHand > t.palmOverHandMax)) ||
    (num(input.reachMean) &&
      (input.reachMean < t.reachMeanMin || input.reachMean > t.reachMeanMax)) ||
    (t.palmTiltMaxDeg !== null &&
      num(input.palmTiltDeg) &&
      input.palmTiltDeg > t.palmTiltMaxDeg) ||
    flexOver ||
    (t.fingerRatioMin !== null &&
      num(input.fingerRatioMean) &&
      input.fingerRatioMean < t.fingerRatioMin)
  ) {
    out.push("hand-flat");
  }
  if (
    t.minSharpness !== null &&
    num(input.sharpness) &&
    input.sharpness < t.minSharpness
  ) {
    out.push("blurry");
  }
  return out;
}

/**
 * The one hint (or none) for this photo. `history`: this device's recent
 * candidates (`SoftHintResult.candidate`), most recent last.
 */
export function pickSoftHint(
  input: SoftHintInput,
  history: readonly (SoftHintCode | null)[] = [],
  t: SoftHintThresholds = SOFT_HINT_THRESHOLDS,
): SoftHintResult {
  const fired = firedSoftHints(input, t);
  const candidate = fired[0] ?? null;
  let suppressed = false;
  const n = Math.max(1, Math.floor(t.repeatLimit));
  if (candidate !== null && Array.isArray(history) && history.length >= n) {
    suppressed = history.slice(-n).every((h) => h === candidate);
  }
  return { code: suppressed ? null : candidate, candidate, suppressed, fired };
}

/** Default number of history entries kept per device. */
export const SOFT_HINT_HISTORY_MAX = 10;

/** History with `candidate` appended, trimmed to the last `max` entries. */
export function appendSoftHintHistory(
  history: readonly (SoftHintCode | null)[],
  candidate: SoftHintCode | null,
  max = SOFT_HINT_HISTORY_MAX,
): (SoftHintCode | null)[] {
  const next = [...(Array.isArray(history) ? history : []), candidate];
  return next.slice(-Math.max(1, Math.floor(max)));
}

/**
 * The four fingers' mean distal/proximal ratio (handPlacement.ts
 * `distalOverProximal`), or null without all four finite values. Pure.
 */
export function meanFingerRatio(
  ratios: readonly number[] | null | undefined,
): number | null {
  if (!Array.isArray(ratios) || ratios.length !== 4) return null;
  if (!ratios.every((r) => typeof r === "number" && Number.isFinite(r)))
    return null;
  return (ratios[0] + ratios[1] + ratios[2] + ratios[3]) / 4;
}
