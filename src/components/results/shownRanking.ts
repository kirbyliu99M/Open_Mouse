/**
 * V3.2 F1 result fingerprint (candidate, 未拍板): how `ResultsScanProvider`
 * keeps the requests about "the ranking on screen" honest, kept pure (no
 * React) so the wiring is tested without a browser:
 *   - `refreshShownFit`: fetch the fit again after a 412 and show it in place,
 *     one refresh at a time, dropped when the scan or attempt moved on;
 *   - `analyseOnScreen`: ask for the analysis with the fingerprint of the fit
 *     on screen (412 → refresh → ask once more, `analyseShownRanking`);
 *   - `refreshThenReanalyse`: what the feedback sheet's 412 does: refresh, and
 *     ask for the analysis again only when it was asked for already.
 * The provider holds the boxes below in `useRef`s.
 */
import type { FitResponse } from "@/lib/contracts/fit";
import {
  analyseShownRanking,
  type AnalysisOutcome,
  type FitOutcome,
} from "./fetchResults";

/** A mutable box, the shape of a React ref. */
export interface Box<T> {
  current: T;
}

export interface ShownRankingRefs {
  /** The fit on screen (null while none is). */
  shown: Box<FitResponse | null>;
  /** Bumped when the scan or attempt changes: older refreshes are dropped. */
  generation: Box<number>;
  /** The refresh in flight, shared by analysis and feedback. */
  inflight: Box<Promise<FitResponse | null> | null>;
}

/**
 * Fetch the fit again and, when it is ready and still wanted, make it the
 * one on screen (`show`). Resolves to the new fit, or null when it could not
 * be fetched or the page moved on (the old ranking stays).
 */
export function refreshShownFit(
  refs: ShownRankingRefs,
  fetchFit: () => Promise<FitOutcome>,
  show: (fit: FitResponse) => void,
): Promise<FitResponse | null> {
  if (refs.inflight.current) return refs.inflight.current;
  const generation = refs.generation.current;
  const request = (async () => {
    const outcome = await fetchFit();
    if (generation !== refs.generation.current) return null;
    if (outcome.status !== "ready") return null;
    refs.shown.current = outcome.response;
    show(outcome.response);
    return outcome.response;
  })();
  refs.inflight.current = request;
  const forget = () => {
    if (refs.inflight.current === request) refs.inflight.current = null;
  };
  request.then(forget, forget);
  return request;
}

/** Ask for the analysis of the fit on screen, with its fingerprint. */
export function analyseOnScreen(input: {
  shown: Box<FitResponse | null>;
  fetchAnalysis: (
    resultFingerprint: string | undefined,
  ) => Promise<AnalysisOutcome>;
  refreshFit: () => Promise<FitResponse | null>;
  stillWanted: () => boolean;
}): Promise<AnalysisOutcome | null> {
  return analyseShownRanking({
    resultFingerprint: input.shown.current?.resultFingerprint,
    fetchAnalysis: input.fetchAnalysis,
    refreshFit: input.refreshFit,
    stillWanted: input.stillWanted,
  });
}

/**
 * The feedback sheet heard 412: show the new ranking and, when the written
 * analysis was already asked for, ask again so it is about that ranking.
 */
export async function refreshThenReanalyse(input: {
  refreshNow: () => Promise<FitResponse | null>;
  analysisStarted: () => boolean;
  reanalyse: () => void;
}): Promise<void> {
  const fresh = await input.refreshNow();
  if (fresh && input.analysisStarted()) input.reanalyse();
}
