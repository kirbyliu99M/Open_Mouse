import Link from "next/link";
import type { FitEntry } from "@/lib/contracts/fit";
import { RESULTS_PAGE_COPY } from "@/lib/copy/results-page";
import { uiLangAttribute, type UiLanguage } from "@/client/uiLanguage";
import { MousePhoto } from "./MousePhoto";
import { VariantsLine } from "./VariantsLine";

/**
 * "Other picks": the rest of the top five as cards (photo or silhouette,
 * brand, model, score). On a real scan each card links to that mouse's detail
 * page (or the main page for rank 1). The demo has no routes, so it passes
 * `onSelect` and the cards are buttons.
 */
export function OtherPicks({
  entries,
  language,
  hrefFor,
  onSelect,
}: {
  entries: FitEntry[];
  language: UiLanguage;
  hrefFor?: (entry: FitEntry) => string;
  onSelect?: (rank: number) => void;
}) {
  if (entries.length === 0) return null;
  const copy = RESULTS_PAGE_COPY[language];
  const lang = uiLangAttribute(language);
  return (
    <section
      className="results-others"
      aria-labelledby="results-others-heading"
    >
      <div className="results-others-head">
        <h2 id="results-others-heading" lang={lang}>
          {copy.othersHeading}
        </h2>
        <p className="results-others-caption" lang={lang}>
          {copy.othersCaption}
        </p>
      </div>
      <ul className="results-others-grid">
        {entries.map((entry) => {
          const inner = (
            <>
              <MousePhoto imageUrl={entry.mouse.imageUrl} />
              <span className="results-card-brand">{entry.mouse.brand}</span>
              <span className="results-card-model">{entry.mouse.model}</span>
              <VariantsLine entry={entry} language={language} />
              <span className="results-card-score results-tabularNum">
                <strong>{entry.total}</strong>
                <span lang={lang}> {copy.outOf}</span>
              </span>
            </>
          );
          return (
            <li key={entry.mouse.slug}>
              {hrefFor ? (
                <Link
                  href={hrefFor(entry)}
                  className="results-card"
                  data-rank={entry.rank}
                >
                  {inner}
                </Link>
              ) : (
                <button
                  type="button"
                  className="results-card"
                  data-rank={entry.rank}
                  onClick={() => onSelect?.(entry.rank)}
                >
                  {inner}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
