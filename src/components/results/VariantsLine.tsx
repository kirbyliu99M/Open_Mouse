import { RESULTS_PAGE_COPY } from "@/lib/copy/results-page";
import { uiLangAttribute, type UiLanguage } from "@/client/uiLanguage";

/**
 * "Same modeling: <models>" on a card whose shell other catalogue entries share
 * (SHELL-1). Renders nothing when there are no variants. The models are plain
 * text: a variant has no score, no rank and no page of its own. While the
 * results are filtered, the caller passes only the members that match
 * (FILTER-1, B3).
 */
export function VariantsLine({
  variants,
  language,
}: {
  variants: readonly { model: string }[];
  language: UiLanguage;
}) {
  if (variants.length === 0) return null;
  return (
    <span className="results-variants" lang={uiLangAttribute(language)}>
      {RESULTS_PAGE_COPY[language].variantsLine(variants.map((v) => v.model))}
    </span>
  );
}
