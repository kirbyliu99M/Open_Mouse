"use client";

import { useEffect, useRef, useState } from "react";
import type { UiLanguage } from "@/client/uiLanguage";
import { uiLangAttribute } from "@/client/uiLanguage";
import { RESULTS_PAGE_COPY } from "@/lib/copy/results-page";

/** A screen reader hears the new count this long after the last change. */
export const ANNOUNCE_DELAY_MS = 300;

/**
 * The filter's one live region: says 「找到 N 款」 about 300 ms after the count
 * changes (so a run of quick changes is read once). It says nothing at first
 * and nothing when the count has not changed. Visually hidden.
 */
export function FilterStatus({
  count,
  language,
}: {
  count: number;
  language: UiLanguage;
}) {
  const [text, setText] = useState("");
  const seen = useRef(count);
  useEffect(() => {
    if (seen.current === count) return;
    seen.current = count;
    const id = window.setTimeout(
      () => setText(RESULTS_PAGE_COPY[language].filter.found(count)),
      ANNOUNCE_DELAY_MS,
    );
    return () => window.clearTimeout(id);
  }, [count, language]);
  return (
    <p
      role="status"
      className="results-visuallyHidden"
      lang={uiLangAttribute(language)}
      data-testid="filter-status"
    >
      {text}
    </p>
  );
}
