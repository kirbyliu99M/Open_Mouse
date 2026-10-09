import type { FitEntry } from "@/lib/contracts/fit";
import { RESULTS_PAGE_COPY } from "@/lib/copy/results-page";
import { uiLangAttribute, type UiLanguage } from "@/client/uiLanguage";

/**
 * "Also: <models>" on a card whose shell other catalogue entries share
 * (SHELL-1). Renders nothing when the entry has no variants. The models are
 * plain text: a variant has no score, no rank and no page of its own.
 */
export function VariantsLine({
  entry,
  language,
}: {
  entry: FitEntry;
  language: UiLanguage;
}) {
  const variants = entry.variants ?? [];
  if (variants.length === 0) return null;
  return (
    <span className="results-variants" lang={uiLangAttribute(language)}>
      {RESULTS_PAGE_COPY[language].variantsLine(variants.map((v) => v.model))}
    </span>
  );
}
