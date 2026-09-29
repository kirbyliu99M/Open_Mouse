import { TYPED_HAND_LENGTH_ENTRY_ENABLED } from "../../lib/flags";

export const NO_PAPER_ENTRY_LABEL = "No paper? Use a ruler instead";
export const EDIT_HAND_LENGTH_LABEL = "Edit hand length";

/**
 * The label of the "type in your hand length" entry, or `null` when the entry
 * must not be shown. Every place that offers the entry renders it only when
 * this returns a label, so the feature flag hides all of them together.
 * `enabled` is a parameter only so tests can exercise both states of the
 * build-time flag.
 */
export function noPaperEntryLabel(
  hasEnteredLength: boolean,
  enabled: boolean = TYPED_HAND_LENGTH_ENTRY_ENABLED,
): string | null {
  if (!enabled) return null;
  return hasEnteredLength ? EDIT_HAND_LENGTH_LABEL : NO_PAPER_ENTRY_LABEL;
}
