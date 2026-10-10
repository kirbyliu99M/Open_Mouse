import Link from "next/link";
import type { FilteredCard } from "@/lib/results/filters";
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
  cards,
  language,
  filtering = false,
  hrefFor,
  onSelect,
}: {
  cards: FilteredCard[];
  language: UiLanguage;
  /** The list is filtered: the heading says so and each card shows its overall rank when it differs. */
  filtering?: boolean;
  hrefFor?: (card: FilteredCard) => string;
  /** Called with the card's place in the list (the filtered one). */
  onSelect?: (displayRank: number) => void;
}) {
  if (cards.length === 0) return null;
  const copy = RESULTS_PAGE_COPY[language];
  const lang = uiLangAttribute(language);
  return (
    <section
      className="results-others"
      aria-labelledby="results-others-heading"
    >
      <div className="results-others-head">
        <h2 id="results-others-heading" lang={lang}>
          {filtering ? copy.filter.othersHeading : copy.othersHeading}
        </h2>
        <p className="results-others-caption" lang={lang}>
          {copy.othersCaption}
        </p>
      </div>
      <ul className="results-others-grid">
        {cards.map((card) => {
          const { entry } = card;
          const inner = (
            <>
              <MousePhoto imageUrl={entry.mouse.imageUrl} />
              {filtering && (
                <span className="results-card-place" lang={lang}>
                  {copy.filter.place(card.displayRank)}
                </span>
              )}
              <span className="results-card-brand">{entry.mouse.brand}</span>
              <span className="results-card-model">{entry.mouse.model}</span>
              <VariantsLine variants={card.variants} language={language} />
              <span className="results-card-score results-tabularNum">
                <strong>{entry.total}</strong>
                <span lang={lang}> {copy.outOf}</span>
                {filtering && card.overallRank !== card.displayRank && (
                  <span className="results-card-overall" lang={lang}>
                    {" "}
                    {copy.filter.overallRank(card.overallRank)}
                  </span>
                )}
              </span>
            </>
          );
          return (
            <li key={entry.mouse.slug}>
              {hrefFor ? (
                <Link
                  href={hrefFor(card)}
                  className="results-card"
                  data-rank={card.displayRank}
                >
                  {inner}
                </Link>
              ) : (
                <button
                  type="button"
                  className="results-card"
                  data-rank={card.displayRank}
                  onClick={() => onSelect?.(card.displayRank)}
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
