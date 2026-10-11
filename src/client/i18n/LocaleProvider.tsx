"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_LOCALE, type Locale } from "@/lib/contracts/locale";
import { localeCookieString } from "@/lib/i18n/localeCookie";

interface LocaleContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
});

/**
 * Holds the locale the server rendered in (`initialLocale`, so there is no
 * hydration mismatch). `setLocale` writes the cookie, sets `<html lang>`, and
 * refreshes the route so server components render again in the new language.
 */
export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<{ from: Locale; to: Locale } | null>(
    null,
  );
  // A fresh server render in another locale (after `router.refresh()`) wins
  // over the earlier local choice.
  const locale = chosen && chosen.from === initialLocale ? chosen.to : initialLocale;

  const setLocale = useCallback(
    (next: Locale) => {
      document.cookie = localeCookieString(
        next,
        window.location.protocol === "https:",
      );
      document.documentElement.lang = next;
      setChosen({ from: initialLocale, to: next });
      router.refresh();
    },
    [initialLocale, router],
  );

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): Locale {
  return useContext(LocaleContext).locale;
}

export function useSetLocale(): (next: Locale) => void {
  return useContext(LocaleContext).setLocale;
}
