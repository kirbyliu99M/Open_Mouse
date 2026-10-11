import type { HandFix, HandSurface } from "../../lib/copy/scan-issues";

/**
 * What an issue's English `message` says that its `code` does not, as data, so
 * a screen in another language can say it without reading it back out of the
 * English sentence (`issueText.ts`). Set where the message is built; the
 * message itself is unchanged.
 */
export type IssueDetail =
  /** `checkHandedness`: the hand seen, the hand chosen, how it is fixed. */
  | {
      readonly kind: "handedness";
      readonly detected: "left" | "right";
      readonly stated: "left" | "right";
      readonly fix: HandFix;
    }
  /** No hand found: on the printed sheet, on a blank paper, or neither (a typed hand length). */
  | { readonly kind: "handNotDetected"; readonly on: HandSurface }
  /** The palm does not fit the hand length the person typed. */
  | { readonly kind: "typedLength"; readonly typedMm: number };

/** The fix text the easy scan passes to `checkHandedness` (a button on its sheet). */
export const HAND_BUTTON_FIX_INSTRUCTION = "tap the hand button below";
