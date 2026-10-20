/**
 * Words of the particle loader (V3.2 U1), zh-TW and English, same keys. The
 * loader shows no text: these are read by screen readers only, from one
 * `role="status"` region (no percentage is ever announced).
 *
 * Every string here is a CANDIDATE (未拍板) until Kirby has read it.
 */
import type { Locale } from "../contracts/locale";

export interface LoaderCopy {
  /** While waiting. */
  working: string;
  /** The answer arrived; said once, just before the page changes. */
  done: string;
}

export interface LoadingCopy {
  /** Reading the recommendations (the results page). */
  fit: LoaderCopy;
  /** Analysing the photo that was just taken. */
  photo: LoaderCopy;
}

const zhTW: LoadingCopy = {
  fit: { working: "正在比對", done: "完成" },
  photo: { working: "正在測量你的手", done: "測量完成" },
};

const en: LoadingCopy = {
  fit: { working: "Matching", done: "Done" },
  photo: { working: "Measuring your hand", done: "Measured" },
};

const TABLES: Record<Locale, LoadingCopy> = { "zh-TW": zhTW, en };

export function loadingCopy(locale: Locale): LoadingCopy {
  return TABLES[locale];
}
