"use client";

import { useLocale, useSetLocale } from "@/client/i18n/LocaleProvider";
import {
  LANGUAGE_OPTIONS,
  languageSwitcherCopy,
} from "@/lib/copy/language-switcher";
import "./language-switcher.css";

/**
 * Two buttons, 中文 and English, each named in its own language. The current
 * one carries `aria-pressed="true"`; choosing the other writes the cookie and
 * re-renders the page in that language (`useSetLocale`).
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const locale = useLocale();
  const setLocale = useSetLocale();
  const copy = languageSwitcherCopy(locale);
  return (
    <div
      className={`languageSwitcher${className ? ` ${className}` : ""}`}
      role="group"
      aria-label={copy.groupLabel}
      data-testid="language-switcher"
    >
      {LANGUAGE_OPTIONS.map((option) => (
        <button
          key={option.locale}
          type="button"
          lang={option.lang}
          className="languageSwitcher-option"
          aria-pressed={locale === option.locale}
          aria-current={locale === option.locale ? "true" : undefined}
          onClick={() => {
            if (locale !== option.locale) setLocale(option.locale);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
