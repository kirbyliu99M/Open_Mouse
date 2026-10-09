"use client";

import { useEffect, useState } from "react";
import { pickUiLanguage, type UiLanguage } from "@/client/uiLanguage";

/**
 * The language the results page is shown in (`pickUiLanguage`). It is English
 * on the server and on the first client render, then switches to the browser's
 * preferred language once mounted, so the server and client markup agree and
 * there is no hydration mismatch. The results content only appears after a
 * client-side fetch, so a real scan never shows the English first.
 */
export function useUiLanguage(): UiLanguage {
  const [language, setLanguage] = useState<UiLanguage>("en");
  useEffect(() => {
    setLanguage(pickUiLanguage(navigator.languages, navigator.language));
  }, []);
  return language;
}
