/**
 * The hand-type block of the results page: a kicker, a title and one sentence.
 * It describes the MOUSE that suits the person (size class, grip, width), never
 * the hand, and never compares anyone with anyone else (Kirby, 2026-10-09).
 *
 * `fit.handType` is optional and the default engine (fit-v0) does not send it:
 * with no hand type there is no label, and nothing is guessed. Pure.
 */
import type { HandType } from "../contracts/fit";
import type { UiLanguage } from "../../client/uiLanguage";
import { RESULTS_PAGE_COPY } from "../copy/results-page";

export interface HandTypeLabel {
  kicker: string;
  title: string;
  sentence: string;
}

/** The label for `handType`, or `null` when the response carried none. */
export function handTypeLabel(
  handType: HandType | null | undefined,
  language: UiLanguage,
): HandTypeLabel | null {
  if (!handType) return null;
  const copy = RESULTS_PAGE_COPY[language];
  return {
    kicker: copy.handKicker,
    title: [
      copy.handSize[handType.size],
      copy.handGrip[handType.grip],
      copy.handWidth[handType.width],
    ].join(copy.handTitleSeparator),
    sentence: copy.handSentence.build({
      length: copy.handSentence.length[handType.size],
      width: copy.handSentence.width[handType.width],
      grip: copy.handSentence.grip[handType.grip],
    }),
  };
}
