// src/client/uiLanguage.ts
/**
 * UI language until the site has an i18n framework (2026-10-09): zh-TW for a
 * browser whose first preferred language is Chinese, English otherwise. Same
 * rule as `pickCaptureFailureLanguage` (#144). Client-only input.
 */
export type UiLanguage = "zh-TW" | "en";

export function pickUiLanguage(
  languages: readonly string[] | null | undefined,
  language?: string | null,
): UiLanguage {
  const first = languages?.length ? languages[0] : language;
  return typeof first === "string" && /^zh(?![a-z])/i.test(first.trim())
    ? "zh-TW"
    : "en";
}

/** `lang` for an element showing UI text: the page is `lang="en"` (WCAG 3.1.2). */
export function uiLangAttribute(language: UiLanguage): string | undefined {
  return language === "zh-TW" ? "zh-TW" : undefined;
}
