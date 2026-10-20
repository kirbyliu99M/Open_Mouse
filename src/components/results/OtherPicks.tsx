import Link from "next/link";
import type { FilteredCard } from "@/lib/results/filters";
import { RESULTS_PAGE_COPY } from "@/lib/copy/results-page";
import type { Locale } from "@/lib/contracts/locale";
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
  showScores = true,
  hrefFor,
  onSelect,
  onPick,
}: {
  cards: FilteredCard[];
  language: Locale;
  /** The list is filtered: the heading says so and each card shows its overall rank when it differs. */
  filtering?: boolean;
  /**
   * False while the hand is outside the catalogue's length range: the cards
   * keep their order but carry no score (the contract's hard rule).
   */
  showScores?: boolean;
  hrefFor?: (card: FilteredCard) => string;
  /** Called with the card's place in the list (the filtered one). */
  onSelect?: (displayRank: number) => void;
  /** Called when a card is clicked (analytics only; navigation is unchanged). */
  onPick?: (card: FilteredCard) => void;
}) {
  if (cards.length === 0) return null;
  const copy = RESULTS_PAGE_COPY[language];
  return (
    <section
      className="results-others"
      aria-labelledby="results-others-heading"
    >
      <div className="results-others-head">
        <h2 id="results-others-heading">
          {filtering ? copy.filter.othersHeading : copy.othersHeading}
        </h2>
        <p className="results-others-caption">{copy.othersCaption}</p>
      </div>
      <ul className="results-others-grid">
        {cards.map((card) => {
          const { entry } = card;
          const inner = (
            <>
              <MousePhoto imageUrl={entry.mouse.imageUrl} />
              {filtering && (
                <span className="results-card-place">
                  {copy.filter.place(card.displayRank)}
                </span>
              )}
              <span className="results-card-brand">{entry.mouse.brand}</span>
              <span className="results-card-model">{entry.mouse.model}</span>
              <VariantsLine variants={card.variants} language={language} />
              {(showScores ||
                (filtering && card.overallRank !== card.displayRank)) && (
                <span className="results-card-score results-tabularNum">
                  {showScores && (
                    <>
                      <strong>{entry.total}</strong>
                      <span> {copy.outOf}</span>
                    </>
                  )}
                  {filtering && card.overallRank !== card.displayRank && (
                    <span className="results-card-overall">
                      {" "}
                      {copy.filter.overallRank(card.overallRank)}
                    </span>
                  )}
                </span>
              )}
            </>
          );
          return (
            <li key={entry.mouse.slug}>
              {hrefFor ? (
                <Link
                  href={hrefFor(card)}
                  className="results-card"
                  data-rank={card.displayRank}
                  onClick={onPick ? () => onPick(card) : undefined}
                >
                  {inner}
                </Link>
              ) : (
                <button
                  type="button"
                  className="results-card"
                  data-rank={card.displayRank}
                  onClick={() => {
                    onPick?.(card);
                    onSelect?.(card.displayRank);
                  }}
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
