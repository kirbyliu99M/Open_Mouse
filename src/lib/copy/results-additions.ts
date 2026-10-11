/**
 * Words of two additions to the results page (Kirby, 2026-10-12): the block
 * "People with a similar hand size rated these" and the reminder icon in the
 * top bar that leads to the profile page. Every zh-TW string is a CANDIDATE
 * (未拍板) until Kirby has read it, Claude's Taiwan wording.
 *
 * The numbers in these sentences (a count, a mean) are made in TypeScript
 * (`src/lib/results/similarHands.ts`) and only placed here (hard rule 2).
 * Nothing in this module says "more accurate" or compares the person's own fit
 * score with the ratings: they are different things.
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

export interface ResultsAdditionsCopy {
  /** The block's heading (candidate). */
  similarHeading: string;
  /** The line under the heading: how many people stand behind the list. */
  similarNeighbours: (people: number) => string;
  /** After each mouse: how many of them rated it. */
  similarRaters: (people: number) => string;
  /** The block when the data is not enough yet (candidate). */
  similarUnavailable: string;
  /** The accessible name of the top bar's reminder link (candidate). */
  reminderName: string;
  /** The same, while the person has not answered: the dot is never the only cue. */
  reminderNameUnanswered: string;
}

export const zhTW: ResultsAdditionsCopy = {
  similarHeading: "手掌大小相近的人這樣評價",
  similarNeighbours: (people) => `${people} 位手掌大小相近的人評分`,
  similarRaters: (people) => `${people} 人評分`,
  similarUnavailable: "目前資料還不夠，暫時無法顯示。",
  reminderName: "回答問卷",
  reminderNameUnanswered: "回答問卷（尚未填答）",
};

export const en: ResultsAdditionsCopy = {
  similarHeading: "How people with a similar hand size rated these",
  similarNeighbours: (people) =>
    `Rated by ${people} people with a similar hand size`,
  similarRaters: (people) => `${people} ratings`,
  similarUnavailable: "Not enough data yet, so this is not shown for now.",
  reminderName: "Answer the questionnaire",
  reminderNameUnanswered: "Answer the questionnaire (not answered yet)",
};

/** The table for a locale. */
export const resultsAdditionsCopy = (locale: Locale): ResultsAdditionsCopy =>
  pickCopy(locale, { zhTW, en });
