/**
 * Pure state machine for the easy-scan hand chip
 * (docs/design/easy-scan-shell-2026-09-25/README.md point 2: "Hand is
 * inferred: MediaPipe's handedness ... picks left/right; the chip shows
 * 'Right hand · auto' and a tap flips it. Default right until the first
 * detection.").
 *
 * `hand` is always right by default. Once the user taps the chip, the
 * state is `locked` and no later detection overwrites it — a manual choice
 * always wins. While unlocked, `applyDetectedHandedness` lets the chip pick
 * up MediaPipe's own handedness (already computed by the photo pipeline's
 * handedness gate — see `PhotoOverlay.handedness` in
 * `src/client/photo/pipeline.ts`) the moment a capture attempt detects one,
 * without a second detection pass.
 */

export type Hand = "left" | "right";

export interface HandChipState {
  readonly hand: Hand;
  /** True once the user has tapped the chip to override the inferred hand. */
  readonly locked: boolean;
}

export const INITIAL_HAND_CHIP_STATE: HandChipState = {
  hand: "right",
  locked: false,
};

/** A tap on the chip: flips the hand and locks it against future auto-updates. */
export function toggleHandChip(state: HandChipState): HandChipState {
  return { hand: state.hand === "right" ? "left" : "right", locked: true };
}

/**
 * Folds a freshly-detected handedness into the chip state. A no-op once the
 * user has locked the chip, when nothing was detected, or when the
 * detected hand already matches — so callers can call this unconditionally
 * after every capture attempt without checking those cases themselves.
 */
export function applyDetectedHandedness(
  state: HandChipState,
  detected: Hand | null | undefined,
): HandChipState {
  if (state.locked || !detected || detected === state.hand) return state;
  return { hand: detected, locked: false };
}

/**
 * The chip's text. "· auto" is only true while the hand is still inferred:
 * once the user has tapped the chip the hand is theirs, and the label says
 * just "Left hand" / "Right hand".
 */
export function handChipLabel(state: HandChipState): string {
  return `${state.hand === "left" ? "Left" : "Right"} hand${state.locked ? "" : " · auto"}`;
}

/**
 * The chip's accessible name. Its visible text changes with the hand and
 * with whether the user has chosen it, so it is a plain button (a button
 * whose label changes is not a toggle, and `aria-pressed` would misreport
 * it: it stays "pressed" after the first tap). The name starts with the
 * visible text, as it must, then says where the hand came from and what a
 * tap does.
 */
export function handChipAccessibleName(state: HandChipState): string {
  return `${handChipLabel(state)}, ${
    state.locked ? "set by you" : "set automatically"
  }. Change hand`;
}

/**
 * A tap while a photo is still being processed would change the hand after
 * the running pipeline already read it, so the result on screen would answer
 * a different question than the chip shows. The chip is disabled instead
 * (nothing to re-run: processing is short and the sheet that follows
 * offers the retry). `resultKind` is `EasyScanCamera`'s `result.kind`.
 */
export function canToggleHandChip(resultKind: string): boolean {
  return resultKind !== "processing";
}
