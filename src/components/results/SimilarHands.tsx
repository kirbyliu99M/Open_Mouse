"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@/lib/contracts/locale";
import { resultsAdditionsCopy } from "@/lib/copy/results-additions";
import {
  fetchSimilar,
  formatSatisfaction,
  type SimilarState,
} from "@/lib/results/similarHands";

/**
 * What the block draws for a state (no fetching, so it renders on the server
 * and is tested as markup). Plain rows: no link, no rank badge, no "best", and
 * not a word about the person's own fit score, which is a different thing.
 * "loading" and "hidden" draw nothing at all: the block is an extra, so it
 * neither flashes a placeholder nor shows a failure.
 */
export function SimilarHandsView({
  state,
  language,
}: {
  state: SimilarState;
  language: Locale;
}) {
  if (state.status === "loading" || state.status === "hidden") return null;
  const copy = resultsAdditionsCopy(language);
  return (
    <section
      className="results-similar"
      aria-labelledby="results-similar-heading"
    >
      <h2 id="results-similar-heading" className="results-similar-heading">
        {copy.similarHeading}
      </h2>
      {state.status === "unavailable" ? (
        <p className="results-similar-note">{copy.similarUnavailable}</p>
      ) : (
        <>
          <p className="results-similar-note">
            {copy.similarNeighbours(state.neighbours)}
          </p>
          <ul className="results-similar-list">
            {state.mice.map((mouse) => (
              <li key={mouse.slug} className="results-similar-row">
                <span className="results-similar-name">
                  <span className="results-similar-brand">{mouse.brand}</span>
                  <span className="results-similar-model">{mouse.model}</span>
                </span>
                <span className="results-similar-figures results-tabularNum">
                  <span className="results-similar-mean">
                    {formatSatisfaction(mouse.meanSatisfaction)}
                  </span>
                  <span className="results-similar-raters">
                    {copy.similarRaters(mouse.raters)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * Settled answers of this page's life, so a remount (the filter layout, a
 * back-and-forth between the pages of one scan) does not ask again. Only an
 * answer about the scan is kept; a failure is not, so a later visit asks again.
 */
const settled = new Map<string, SimilarState>();

/** Forget every kept answer (tests). */
export function resetSimilarHands(): void {
  settled.clear();
}

/**
 * The block of one real scan: asks `GET /api/scans/{scanId}/similar` once and
 * draws `SimilarHandsView`. A scan id is what the real results page has and the
 * demo does not, so the demo does not mount it.
 */
export function SimilarHands({
  scanId,
  language,
}: {
  scanId: string;
  language: Locale;
}) {
  const [state, setState] = useState<SimilarState>(
    () => settled.get(scanId) ?? { status: "loading" },
  );

  useEffect(() => {
    const known = settled.get(scanId);
    if (known) {
      setState(known);
      return;
    }
    const controller = new AbortController();
    void fetchSimilar(scanId, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      if (next.status !== "hidden") settled.set(scanId, next);
      setState(next);
    });
    return () => controller.abort();
  }, [scanId]);

  return <SimilarHandsView state={state} language={language} />;
}
