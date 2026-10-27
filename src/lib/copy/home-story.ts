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
 * The page shows the visitor's locale (`homeStoryNotes(locale)`, 2026-10-11).
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

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

export const en: HomeStoryCopy = {
  length: {
    title: "Hand length",
    why: "A length that fits your whole hand.",
  },
  width: {
    title: "Palm width",
    why: "A close match with the palm means a better grip.",
  },
  knuckles: {
    title: "Knuckles",
    why: "Support under your knuckles, so the buttons are easy to press.",
  },
  fingertips: {
    title: "Fingertips",
    why: "Easy clicks, fingers rest where they fall.",
  },
  thumb: {
    title: "Thumb",
    why: "Better control and grip.",
  },
};

export const zhTW: HomeStoryCopy = {
  length: {
    title: "手長",
    why: "長度剛好，手掌放得完整",
  },
  width: {
    title: "掌寬",
    why: "掌心服貼，握姿更舒適",
  },
  knuckles: {
    title: "指根關節",
    why: "指根有支撐，按鍵好施力",
  },
  fingertips: {
    title: "指尖",
    why: "輕鬆點擊，手指自然落位",
  },
  thumb: {
    title: "拇指",
    why: "抓握張弛有度，滑動更流暢",
  },
};

/** Both tables by locale, for tests that walk every language. */
export const HOME_STORY_COPY: Readonly<Record<Locale, HomeStoryCopy>> = {
  en,
  "zh-TW": zhTW,
};

export function homeStoryCopy(locale: Locale): HomeStoryCopy {
  return pickCopy(locale, { zhTW, en });
}

/** The five annotations in the visitor's locale, in order. */
export function homeStoryNotes(
  locale: Locale,
): readonly (HomeStoryNote & { readonly key: HomeStoryNoteKey })[] {
  const copy = homeStoryCopy(locale);
  return HOME_STORY_NOTE_KEYS.map((key) => ({ key, ...copy[key] }));
}
