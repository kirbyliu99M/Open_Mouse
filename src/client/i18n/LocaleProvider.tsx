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
  // The visitor's own choice, shown at once while `router.refresh()` is in
  // flight. Whenever the server renders a (new) locale, that render is the
  // truth again and the choice is dropped, so a stale choice can never come
  // back (adjusting state while rendering, as React documents).
  const [chosen, setChosen] = useState<Locale | null>(null);
  const [seenInitial, setSeenInitial] = useState(initialLocale);
  if (seenInitial !== initialLocale) {
    setSeenInitial(initialLocale);
    setChosen(null);
  }
  const locale = chosen ?? initialLocale;

  const setLocale = useCallback(
    (next: Locale) => {
      document.cookie = localeCookieString(
        next,
        window.location.protocol === "https:",
      );
      document.documentElement.lang = next;
      setChosen(next);
      router.refresh();
    },
    [router],
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
