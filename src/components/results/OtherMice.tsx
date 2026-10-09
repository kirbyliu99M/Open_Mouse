"use client";

import type { FitResponse } from "@/lib/contracts/fit";
import { RESULTS_PAGE_COPY } from "@/lib/copy/results-page";
import { otherMice } from "@/lib/results/rankRoutes";
import { uiLangAttribute, type UiLanguage } from "@/client/uiLanguage";
import { MousePhoto } from "./MousePhoto";

/**
 * "Other mice (N)": a details element, closed by default, listing every mouse
 * past the top five as a small picture, its model and its score. These rows
 * have no page of their own. Mice left out of the ranking (`excluded`) come
 * last, each with the reason in words. Renders nothing when there is nothing
 * to list.
 */
export function OtherMice({
  response,
  language,
  onOpened,
}: {
  response: FitResponse;
  language: UiLanguage;
  /** Called each time the section is opened (not closed). */
  onOpened?: () => void;
}) {
  const { ranked, excluded, count } = otherMice(response);
  if (count === 0) return null;
  const copy = RESULTS_PAGE_COPY[language];
  const lang = uiLangAttribute(language);
  return (
    <details
      className="results-disclosure results-otherMice"
      onToggle={(event) => {
        if (event.currentTarget.open) onOpened?.();
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
            {ranked.map((entry) => (
              <li key={entry.mouse.slug} className="results-otherMice-row">
                <MousePhoto
                  imageUrl={entry.mouse.imageUrl}
                  className="results-photo--small"
                />
                <span className="results-otherMice-name">
                  {entry.mouse.brand} {entry.mouse.model}
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
                  <span className="results-excluded-reason" lang={lang}>
                    {copy.excludedReason[item.reason]}
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
