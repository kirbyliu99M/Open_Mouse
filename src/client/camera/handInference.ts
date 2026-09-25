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
