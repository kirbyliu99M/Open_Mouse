/**
 * The five annotations of the home page's particle story (Home v3.1; the Pencil
 * demo of 2026-10-05). Each is a two-line block: a large line (what is
 * measured) and a small line (why it matters). The order is the order they
 * appear in while the hand is measured.
 *
 * English small lines: confirmed by Kirby (relayed by Claude, 2026-10-05), with
 * only spelling and grammar touched here and the meaning unchanged. The large
 * lines and the zh-TW lines are unchanged: the English titles are the first
 * translations, and the zh-TW lines are the ones in the demo. Anything not yet
 * decided in a formal meeting stays 未拍板 (candidate).
 *
 * No numbers anywhere in these lines, or on the stage: the template hand is an
 * illustration, and a demo value must never read as a user's result. A unit
 * test (tests/unit/home-story-copy.test.ts) holds both languages to the same
 * keys, no empty string and no digit.
 *
 * There is no i18n framework in the repo yet, so the page shows English for
 * now (the rest of the home page is English) and does not touch `<html lang>`.
 * When the framework lands, `HOME_STORY_COPY["zh-TW"]` is what it picks up.
 */

/** The annotations, in the order they appear. */
export const HOME_STORY_NOTE_KEYS = [
  "length",
  "width",
  "knuckles",
  "fingertips",
  "thumb",
] as const;

export type HomeStoryNoteKey = (typeof HOME_STORY_NOTE_KEYS)[number];

export interface HomeStoryNote {
  /** The large line: what is measured. */
  readonly title: string;
  /** The small line: why it matters. */
  readonly why: string;
}

export type HomeStoryCopy = Readonly<Record<HomeStoryNoteKey, HomeStoryNote>>;

export type HomeStoryLanguage = "en" | "zh-TW";

/** The language the page shows today. */
export const HOME_STORY_LANGUAGE: HomeStoryLanguage = "en";

export const HOME_STORY_COPY: Readonly<
  Record<HomeStoryLanguage, HomeStoryCopy>
> = {
  en: {
    length: {
      title: "Hand length",
      why: "The right length can reduce hand fatigue.",
    },
    width: {
      title: "Palm width",
      why: "A close match with the palm means a better grip.",
    },
    knuckles: {
      title: "Knuckles",
      why: "A pressing force at the best intensity reduces stiff fingers.",
    },
    fingertips: {
      title: "Fingertips",
      why: "Easier clicking, with less strain.",
    },
    thumb: {
      title: "Thumb",
      why: "Better control and grip.",
    },
  },
  "zh-TW": {
    length: {
      title: "手長",
      why: "長度剛好，降低手部疲勞",
    },
    width: {
      title: "掌寬",
      why: "掌心服貼，握姿更舒適",
    },
    knuckles: {
      title: "指根關節",
      why: "正確發力，遠離手指僵硬",
    },
    fingertips: {
      title: "指尖",
      why: "輕鬆點擊，毫無負擔",
    },
    thumb: {
      title: "拇指",
      why: "抓握張弛有度，滑動更流暢",
    },
  },
};

/** The five annotations in the language the page shows, in order. */
export function homeStoryNotes(
  language: HomeStoryLanguage = HOME_STORY_LANGUAGE,
): readonly (HomeStoryNote & { readonly key: HomeStoryNoteKey })[] {
  const copy = HOME_STORY_COPY[language];
  return HOME_STORY_NOTE_KEYS.map((key) => ({ key, ...copy[key] }));
}
