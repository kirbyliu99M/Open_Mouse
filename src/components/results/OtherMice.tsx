"use client";

import type { FitResponse } from "@/lib/contracts/fit";
import type { FilteredCard } from "@/lib/results/filters";
import { RESULTS_PAGE_COPY } from "@/lib/copy/results-page";
import {
  isPersonOpening,
  PRINT_OPENED_ATTRIBUTE,
} from "@/lib/results/disclosure";
import { uiLangAttribute, type UiLanguage } from "@/client/uiLanguage";
import { MousePhoto } from "./MousePhoto";

/**
 * "Other mice (N)": a details element, closed by default, listing every mouse
 * past the top five as a small picture, its model and its score. These rows
 * have no page of their own. Mice left out of the ranking (`excluded`) come
 * last, each with the reason in words. Renders nothing when there is nothing
 * to list. While the results are filtered (`filtering`), `ranked` is the
 * filtered list from the sixth place on, each row also gives its overall rank
 * when that differs, and `excluded` is empty (the page says they are hidden).
 */
export function OtherMice({
  ranked,
  excluded,
  hand,
  language,
  filtering = false,
  onOpened,
}: {
  ranked: readonly FilteredCard[];
  excluded: FitResponse["excluded"];
  /** The hand the scan measured, for the excluded reasons. */
  hand: FitResponse["hand"];
  language: UiLanguage;
  filtering?: boolean;
  /** Called each time the section is opened (not closed). */
  onOpened?: () => void;
}) {
  const count = ranked.length + excluded.length;
  if (count === 0) return null;
  const copy = RESULTS_PAGE_COPY[language];
  const lang = uiLangAttribute(language);
  return (
    <details
      className="results-disclosure results-otherMice"
      onToggle={(event) => {
        const details = event.currentTarget;
        if (
          isPersonOpening({
            open: details.open,
            printOpened: details.hasAttribute(PRINT_OPENED_ATTRIBUTE),
          })
        )
          onOpened?.();
      }}
    >
      <summary>
        <span className="results-disclosure-text" lang={lang}>
          <span className="results-disclosure-title">
            {copy.otherMiceTitle(count)}
          </span>
          <span className="results-disclosure-hint">{copy.otherMiceHint}</span>
        </span>
        <span className="results-chevron" aria-hidden="true" />
      </summary>
      <div className="results-disclosure-body">
        {ranked.length > 0 && (
          <ol className="results-otherMice-list">
            {ranked.map(({ entry, displayRank, overallRank }) => (
              <li key={entry.mouse.slug} className="results-otherMice-row">
                <MousePhoto
                  imageUrl={entry.mouse.imageUrl}
                  className="results-photo--small"
                />
                <span className="results-otherMice-name">
                  {entry.mouse.brand} {entry.mouse.model}
                  {filtering && overallRank !== displayRank && (
                    <span className="results-otherMice-overall" lang={lang}>
                      {" "}
                      {copy.filter.overallRank(overallRank)}
                    </span>
                  )}
                </span>
                <span className="results-otherMice-score results-tabularNum">
                  {entry.total}
                  <span lang={lang}> {copy.outOf}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
        {excluded.length > 0 && (
          <section className="results-excluded">
            <h3 className="results-excluded-heading" lang={lang}>
              {copy.excludedHeading}
            </h3>
            <ul className="results-excluded-list">
              {excluded.map((item) => (
                <li key={item.slug}>
                  <span className="results-excluded-name">
                    {item.brand} {item.model}
                  </span>
                  {/* Reason first, then (when there is one) the number with its
                      label: it is the score of the mouse's mirror image for
                      this hand, not a score of this mouse. */}
                  <span className="results-excluded-detail" lang={lang}>
                    <span className="results-excluded-reason">
                      {copy.excludedReason(item.reason, hand)}
                    </span>
                    {item.total !== undefined && (
                      <>
                        <span aria-hidden="true">{copy.excludedSeparator}</span>
                        <span className="results-excluded-mirror">
                          <span className="results-excluded-mirror-label">
                            {copy.excludedMirrorLabel(hand)}
                          </span>
                          {" "}
                          <span className="results-excluded-score results-tabularNum">
                            {item.total}
                            <span> {copy.outOf}</span>
                          </span>
                        </span>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </details>
  );
}
