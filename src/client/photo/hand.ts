export type Hand = "left" | "right";

/**
 * The one decision every pipeline (printed sheet, blank paper, typed hand
 * length) makes about the hand: what, if anything, to compare the detected
 * hand against, and which hand the scan is submitted as.
 */
export interface HandDecision {
  /**
   * The hand the detected hand is compared against. `undefined` means there
   * is nothing to compare: the user never chose a hand, so nothing they said
   * can be contradicted, and no mismatch can be raised.
   */
  readonly stated: Hand | undefined;
  /** The hand the scan is submitted as. */
  readonly submitted: Hand;
}

/**
 * Pure. `selected` is the hand button / picker value. `explicit` is true only
 * when the user chose it (easy scan: the hand button was tapped; the printed
 * sheet page: always). While it is false, `selected` is only a default, so
 * the detected hand is submitted (falling back to `selected` when no hand
 * label came back) and it is never compared. A hand the user chose is always
 * submitted as chosen, and a disagreeing photo is caught by the handedness
 * gate through `stated`.
 */
export function resolvePipelineHand(input: {
  readonly selected: Hand;
  readonly detected: Hand | null;
  readonly explicit: boolean;
}): HandDecision {
  if (input.explicit) {
    return { stated: input.selected, submitted: input.selected };
  }
  return { stated: undefined, submitted: input.detected ?? input.selected };
}
