/**
 * Words of the language switcher. The two option labels are not here: each
 * language is always named in its own language (中文, English), whatever the
 * page is shown in. The group's accessible name below is a CANDIDATE (未拍板),
 * Claude's wording.
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

export interface LanguageSwitcherCopy {
  /** The accessible name of the group of two options. */
  groupLabel: string;
}

export const zhTW: LanguageSwitcherCopy = { groupLabel: "語言" };

export const en: LanguageSwitcherCopy = { groupLabel: "Language" };

export function languageSwitcherCopy(locale: Locale): LanguageSwitcherCopy {
  return pickCopy(locale, { zhTW, en });
}

/** Each option, named in its own language (with the `lang` to mark it). */
export const LANGUAGE_OPTIONS: readonly {
  readonly locale: Locale;
  readonly label: string;
  readonly lang: string;
}[] = [
  { locale: "zh-TW", label: "中文", lang: "zh-TW" },
  { locale: "en", label: "English", lang: "en" },
];
