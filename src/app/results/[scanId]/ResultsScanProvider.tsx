"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { FitResponse } from "@/lib/contracts/fit";
import type { AnalysisState } from "@/components/results/analysisState";
import {
  fetchFitResult,
  type FitOutcome,
  type FitPreferencesInput,
} from "@/components/results/fetchResults";
import {
  createInflightRequests,
  fitRequestKey,
  shouldRequestAnalysis,
} from "@/lib/results/requests";
import {
  readScanDisclosures,
  type StoredManualEntry,
} from "@/components/results/userLengthDisclosure";
import { prefetchMouseLinks } from "@/components/results/mouseLinksStore";
import {
  shownRankingClient,
  refreshThenReanalyse,
  type ShownRankingRefs,
} from "@/components/results/shownRanking";
import { sweepLegacyHandKeys } from "@/components/results/handDisclosure";
import { rankingUpdatedNoticeDue } from "@/components/results/rankingUpdatedNotice";
import { ResultsUpdatedNotice } from "@/components/results/ResultsUpdatedNotice";
import { track } from "@/client/analytics/track";
import type { ResultsAnalytics } from "@/lib/results/analyticsEvents";
import { TopBar } from "@/components/nav/TopBar";
import { DeleteScanAction } from "@/components/results/DeleteScanAction";
import { useLocale } from "@/client/i18n/LocaleProvider";
import { resultsScreensCopy } from "@/lib/copy/results-screens";
import { loadingCopy } from "@/lib/copy/loading";
import { ParticleLoader } from "@/components/loading/ParticleLoader";
import {
  LOADING_TIMING,
  fitReveal,
  type LoaderInput,
} from "@/lib/particles/loading";
import type { Locale } from "@/lib/contracts/locale";
import type { RESCAN_STATES } from "@/lib/contracts/analytics";
import "@/components/results/results.css";

type PageState =
  | { kind: "loading" }
  | { kind: "notFound" }
  | { kind: "rateLimited" }
  | { kind: "networkError" }
  | { kind: "serverError" }
  | { kind: "ready"; response: FitResponse }
  | { kind: "deleted" };

/**
 * No preference UI exists yet (non-goal of issue #30) — both requests send
 * this same literal `{}` ("no preferences", per routes.ts's comment on
 * `fitPath`), satisfying the contract's "the SAME preferences the fit
 * request used" rule for the analysis request trivially.
 */
const PREFERENCES: FitPreferencesInput = {};

/** The real results pages send their events through `track`; the demo gets none. */
const RESULTS_ANALYTICS: ResultsAnalytics = { send: track };

/**
 * Fit requests in flight, shared by every run of the fit effect: React Strict
 * Mode (on by default in Next.js dev) runs the effect twice at mount, and both
 * runs must share one POST (`src/lib/results/requests.ts`).
 */
const fitRequests = createInflightRequests<FitOutcome>();

/** What a results page reads once the scan's fit has loaded. */
export interface ResultsScan {
  scanId: string;
  response: FitResponse;
  language: Locale;
  /** The hand length the user typed in, when the scan used no paper. */
  enteredLength: number | null;
  /** The hand length and width the user typed instead of scanning (manual entry), when that is how the scan was made. */
  enteredManual: StoredManualEntry | null;
  /** V3.2 F2 (candidate): the paper frame was placed or moved by hand (read from this browser). */
  paperAdjusted: boolean;
  /** V3.2 F13 (candidate): that frame followed a `PAPER_CURLED` result (read from this browser). */
  paperCurled: boolean;
  analysisState: AnalysisState;
  /**
   * Ask for the written analysis. Only the main page (rank 1) gets a request
   * out of this, and only the first time per scan (`shouldRequestAnalysis`):
   * moving to a detail page and back does not ask again.
   */
  requestAnalysis: (isMainPage: boolean) => void;
  retryAnalysis: () => void;
  /**
   * V3.2 F1 (candidate): fetch the fit again and put the new ranking on screen
   * in place (no loader), after the server said the one shown is stale (412).
   */
  refreshFit: () => void;
  /** The sender the results pages use for their events (`track`). */
  analytics: ResultsAnalytics;
}

const ResultsScanContext = createContext<ResultsScan | null>(null);

/** The loaded scan. Only valid below `ResultsScanProvider`, which renders its children once the fit is ready. */
export function useResultsScan(): ResultsScan {
  const scan = useContext(ResultsScanContext);
  if (!scan)
    throw new Error("useResultsScan must be used inside ResultsScanProvider");
  return scan;
}

/**
 * Holds one scan's results for every page under `/results/[scanId]`: the main
 * page and the detail pages share one layout, so the fit request is POSTed
 * once per scan and moving between them does not refetch. A reload fetches
 * again.
 *
 * It renders the ranking's children once the fit has loaded (the ranking never
 * waits on the written analysis — issue #30 acceptance criterion 2). The
 * analysis is requested separately, and only when the main page asks for it.
 *
 * Every non-happy path names the problem and gives the one action that fixes
 * it, per docs/design-guidelines.md's review checklist:
 *  - 404 (ownership rule in routes.ts: expired or foreign scans are 404,
 *    never 403) -> "scan again"
 *  - network error / 5xx -> "try again", which re-runs the fit request
 *  - 429 on the analysis alone -> handled inside `AnalysisSlot`; the
 *    ranking above stays visible and unaffected
 *
 * While the fit loads, the page shows the particle loader (V3.2 U1,
 * candidate) only when it is really waiting (F7, Kirby's phone test
 * 2026-10-21, `fitReveal`): an answer within `FIT_SHOW_AFTER_MS` (300 ms) is
 * shown at once (the page fades in) with no loader; a later one is shown by
 * the loader that appeared at 300 ms, with no minimum time: a result fills
 * the ring and fades, a failure stops the ring, dimmed, above the error and
 * its retry. The same on every way in: after a scan, a direct open, a reload.
 *
 * `anonymous` (issue #42) is decided server-side by `layout.tsx` (it calls
 * `auth()`), never guessed client-side: it gates the "Delete this scan now"
 * action, which a signed-in caller never sees at all — they manage scans on
 * `/account` instead.
 */
export function ResultsScanProvider({
  scanId,
  anonymous,
  children,
}: {
  scanId: string;
  anonymous: boolean;
  children: ReactNode;
}) {
  const [pageState, setPageState] = useState<PageState>({ kind: "loading" });
  const [analysisState, setAnalysisState] = useState<AnalysisState>({
    status: "idle",
  });
  const [attempt, setAttempt] = useState(0);
  const [enteredLength, setEnteredLength] = useState<number | null>(null);
  const [enteredManual, setEnteredManual] = useState<StoredManualEntry | null>(
    null,
  );
  const [paperAdjusted, setPaperAdjusted] = useState(false);
  const [paperCurled, setPaperCurled] = useState(false);
  // V3.2 F13 (candidate): 0 = no "results updated" line; each in-place
  // refresh that changed the ranking bumps it (a new line, a fresh timer).
  const [updatedNotice, setUpdatedNotice] = useState(0);
  const language = useLocale();
  const copy = resultsScreensCopy(language);
  const loaderWords = loadingCopy(language).fit;
  // The loader of the current fit request: when it appeared and, once it is
  // here, when the answer came and whether it was a result.
  // Whether the loader is on screen yet: only once the fit has taken
  // `FIT_SHOW_AFTER_MS` (`fitReveal`).
  const [loaderVisible, setLoaderVisible] = useState(false);
  const [loader, setLoader] = useState<LoaderInput>(() => ({
    // Replaced by the fit effect's own start; this only covers the frames
    // before it runs.
    startedAt: typeof performance === "undefined" ? 0 : performance.now(),
    minMs: LOADING_TIMING.MIN_DISPLAY_FIT_MS,
    steps: null,
    arrival: null,
  }));
  // The locale the next analysis request is made in (the server answers in the
  // visitor's cookie locale, so a request is "in" the locale current when sent).
  const languageRef = useRef(language);
  languageRef.current = language;
  // The locale the analysis on screen (or in flight) was asked for.
  const analysisLanguageRef = useRef(language);

  useEffect(() => {
    try {
      const notes = readScanDisclosures(localStorage, scanId);
      setEnteredLength(notes.enteredLength);
      // The hand is read from the fit response now. Builds before that
      // stored it here; drop every leftover, not just this scan's.
      sweepLegacyHandKeys(localStorage);
      setEnteredManual(notes.enteredManual);
      setPaperAdjusted(notes.paperAdjusted);
      setPaperCurled(notes.paperCurled);
    } catch {
      setEnteredLength(null);
      setEnteredManual(null);
      setPaperAdjusted(false);
      setPaperCurled(false);
    }
  }, [scanId]);

  // Bumped by every analysis run and by the fit effect's cleanup (scan changed
  // or page unmounted): a run that finds it moved on is stale and reports
  // nothing.
  const analysisRunRef = useRef(0);
  // Whether the analysis was asked for already, for this fit.
  const analysisStartedRef = useRef(false);
  // The fit on screen, read by requests that must say which ranking they are
  // about (V3.2 F1: the `x-result-fingerprint` header).
  const shownFitRef = useRef<FitResponse | null>(null);
  shownFitRef.current = pageState.kind === "ready" ? pageState.response : null;
  // Bumped by the fit effect's cleanup: an in-place refresh started for an
  // earlier scan or attempt must not put its answer on screen.
  const fitGenerationRef = useRef(0);
  // One in-place refresh at a time (analysis and feedback may both hear 412).
  const refreshInflightRef = useRef<Promise<FitResponse | null> | null>(null);

  /**
   * V3.2 F1 (candidate): the server says the ranking on screen is stale. Fetch
   * the fit again and, when it comes, show it in place (the page stays; no
   * loader). Resolves to the new fit, or null when it could not be fetched
   * (the old ranking stays on screen). `analyse` sends the fingerprint of the
   * fit on screen; both are tested with a fake fetch (`shownRankingClient`).
   */
  const rankingClient = useMemo(() => {
    const refs: ShownRankingRefs = {
      shown: shownFitRef,
      generation: fitGenerationRef,
      inflight: refreshInflightRef,
    };
    // The new ranking replaces the old in place; when it really changed, a
    // short "results updated" line says so (V3.2 F13, candidate).
    const show = (response: FitResponse, previous: FitResponse | null) => {
      setPageState({ kind: "ready", response });
      if (rankingUpdatedNoticeDue(previous, response))
        setUpdatedNotice((n) => n + 1);
    };
    return shownRankingClient({
      scanId,
      preferences: PREFERENCES,
      fetchImpl: fetch,
      refs,
      show,
    });
  }, [scanId]);
  const refreshFitNow = rankingClient.refreshNow;

  const runAnalysis = useCallback(async () => {
    analysisStartedRef.current = true;
    analysisLanguageRef.current = languageRef.current;
    const run = ++analysisRunRef.current;
    setAnalysisState({ status: "loading" });
    // Sent with the fingerprint of the ranking on screen; a 412 refetches the
    // fit once and asks again (V3.2 F1, `analyseShownRanking`).
    const outcome = await rankingClient.analyse(
      () => run === analysisRunRef.current,
    );
    if (outcome === null || run !== analysisRunRef.current) return;
    if (outcome.status === "ready") {
      track("analysis_shown", {
        outcome: outcome.response.source === "fallback" ? "fallback" : "model",
      });
      setAnalysisState({ status: "ready", response: outcome.response });
    } else if (outcome.status === "rateLimited") {
      track("analysis_shown", { outcome: "error" });
      setAnalysisState({ status: "rateLimited" });
    } else {
      // networkError, serverError, and a 412 that a refetch did not resolve.
      track("analysis_shown", { outcome: "error" });
      setAnalysisState({ status: "error" });
    }
  }, [rankingClient]);

  // The feedback sheet heard 412: show the new ranking, and when the written
  // analysis was already asked for, ask again so it is about that ranking.
  const refreshFit = useCallback(() => {
    void refreshThenReanalyse({
      refreshNow: refreshFitNow,
      analysisStarted: () => analysisStartedRef.current,
      reanalyse: () => void runAnalysis(),
    });
  }, [refreshFitNow, runAnalysis]);

  // The written analysis follows the language switch: once it was asked for,
  // a new locale asks again (the server keeps one per locale, so going back is
  // cheap). `runAnalysis` bumps `analysisRunRef`, so a response still on its
  // way for the old language is dropped when it arrives.
  useEffect(() => {
    if (analysisStartedRef.current && analysisLanguageRef.current !== language)
      void runAnalysis();
  }, [language, runAnalysis]);

  const requestAnalysis = useCallback(
    (isMainPage: boolean) => {
      if (
        !shouldRequestAnalysis({
          isMainPage,
          started: analysisStartedRef.current,
        })
      )
        return;
      void runAnalysis();
    },
    [runAnalysis],
  );

  // The mouse a detail page (`/m/<slug>`) is about, known from the URL before
  // the fit arrives. Kept in a ref so moving between detail pages (the layout
  // stays mounted) does not start the fit request again.
  const routeSlug = useParams<{ slug?: string }>().slug;
  const routeSlugRef = useRef(routeSlug);
  useEffect(() => {
    routeSlugRef.current = routeSlug;
  }, [routeSlug]);

  useEffect(() => {
    let cancelled = false;
    let reveal: ReturnType<typeof setTimeout> | undefined;
    const requestedAt = performance.now();
    // The loader's own start: when it appears, if the answer is not here yet.
    const shownAt = requestedAt + LOADING_TIMING.FIT_SHOW_AFTER_MS;
    setLoaderVisible(false);
    setLoader({
      startedAt: shownAt,
      minMs: LOADING_TIMING.MIN_DISPLAY_FIT_MS,
      steps: null,
      arrival: null,
    });
    const show = setTimeout(() => {
      if (!cancelled) setLoaderVisible(true);
    }, LOADING_TIMING.FIT_SHOW_AFTER_MS);
    // Ask for the links of the mouse the page will show now, so they are
    // usually in the cache by the first paint: the detail page's mouse at once
    // (in parallel with the fit), the overall #1 as soon as the fit is here.
    if (routeSlugRef.current) prefetchMouseLinks(routeSlugRef.current);
    setPageState({ kind: "loading" });
    setAnalysisState({ status: "idle" });
    setUpdatedNotice(0);
    analysisStartedRef.current = false;

    void (async () => {
      const outcome = await fitRequests.getOrStart(
        fitRequestKey(scanId, attempt),
        () => fetchFitResult(scanId, PREFERENCES),
      );
      if (cancelled) return;
      const arrivedAt = performance.now();
      const ok = outcome.status === "ready";
      if (ok) {
        const top = outcome.response.results[0];
        if (top && !routeSlugRef.current) prefetchMouseLinks(top.mouse.slug);
      }
      clearTimeout(show);
      // A quick answer is shown at once and no loader is drawn; a later one
      // goes through the loader that appeared at 300 ms (a result fills and
      // fades, a failure stops the ring), with no minimum time.
      const { loaderShownAt, revealAt } = fitReveal(requestedAt, arrivedAt, ok);
      if (loaderShownAt !== null) {
        setLoaderVisible(true);
        setLoader({
          startedAt: loaderShownAt,
          minMs: LOADING_TIMING.MIN_DISPLAY_FIT_MS,
          steps: null,
          arrival: { at: arrivedAt, ok },
        });
      }
      reveal = setTimeout(
        () => {
          if (cancelled) return;
          if (outcome.status === "ready") {
            // The ready `results_page_viewed` is sent by the page that renders
            // (`ResultsRankClient`): its fields need the header card.
            setPageState({ kind: "ready", response: outcome.response });
          } else {
            track("results_page_viewed", { state: outcome.status });
            setPageState({ kind: outcome.status });
          }
        },
        Math.max(0, revealAt - performance.now()),
      );
    })();

    return () => {
      cancelled = true;
      clearTimeout(show);
      if (reveal !== undefined) clearTimeout(reveal);
      analysisRunRef.current += 1;
      fitGenerationRef.current += 1;
      refreshInflightRef.current = null;
    };
    // `attempt` is part of the request's identity and retriggers this effect
  }, [scanId, attempt]);

  const analytics = RESULTS_ANALYTICS;

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const retryAnalysis = useCallback(() => {
    track("analysis_retry_clicked", {});
    void runAnalysis();
  }, [runAnalysis]);

  // 重新掃描 on a screen with no result: no list, so no page fields.
  const rescanFrom = (state: (typeof RESCAN_STATES)[number]) =>
    track("status_rescan_clicked", { state });

  const deletedHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (pageState.kind === "deleted") deletedHeadingRef.current?.focus();
  }, [pageState.kind]);

  const scan = useMemo<ResultsScan | null>(
    () =>
      pageState.kind === "ready"
        ? {
            scanId,
            response: pageState.response,
            language,
            enteredLength,
            enteredManual,
            paperAdjusted,
            paperCurled,
            analysisState,
            requestAnalysis,
            retryAnalysis,
            refreshFit,
            analytics,
          }
        : null,
    [
      pageState,
      scanId,
      language,
      enteredLength,
      enteredManual,
      paperAdjusted,
      paperCurled,
      analysisState,
      requestAnalysis,
      retryAnalysis,
      refreshFit,
      analytics,
    ],
  );

  // A failed fit: the loader's ring stays where it stopped, dimmed, above the
  // error (only after a real request that waited long enough to show it; a
  // quick failure and a scan deleted here have none).
  const failedLoader =
    loaderVisible && loader.arrival && !loader.arrival.ok ? (
      <ParticleLoader
        className="results-page-failedLoader"
        input={loader}
        status={loaderWords}
      />
    ) : null;

  if (pageState.kind === "loading") {
    return (
      <main className="resultsMain">
        <TopBar
          backHref="/scan/easy"
          onBackClick={() => rescanFrom("loading")}
          backLabel={copy.scanAgain}
          stepLabel={copy.stepLabel}
        />
        {/* Nothing until the fit has taken 300 ms (F7): a quick answer is
            shown at once, without a loader flashing up first. */}
        {loaderVisible ? (
          <ParticleLoader
            className="results-page-status"
            input={loader}
            status={loaderWords}
          />
        ) : (
          <div className="results-page-pending" aria-busy="true" />
        )}
      </main>
    );
  }

  if (pageState.kind === "notFound") {
    return (
      <main className="resultsMain">
        <TopBar
          backHref="/scan/easy"
          onBackClick={() => rescanFrom("notFound")}
          backLabel={copy.scanAgain}
          stepLabel={copy.stepLabel}
        />
        {failedLoader}
        <div className="results-page-error" role="alert">
          <p className="results-eyebrow">{copy.eyebrow}</p>
          <h1>{copy.notFound.title}</h1>
          <p>{copy.notFound.body}</p>
          <Link
            href="/scan/easy"
            className="results-page-action"
            onClick={() => rescanFrom("notFound")}
          >
            {copy.scanAgain}
          </Link>
        </div>
      </main>
    );
  }

  if (pageState.kind === "rateLimited") {
    // 429 from the fit route (M2 hardening's per-IP limit) — distinct from
    // `serverError`'s generic copy (PR #56 review, MEDIUM 2): this is
    // expected, honest behaviour, not a failure, and `retry` here is a
    // manual button the caller must press, never an automatic retry loop
    // that would just re-trip the same limit.
    return (
      <main className="resultsMain">
        <TopBar
          backHref="/scan/easy"
          onBackClick={() => rescanFrom("rateLimited")}
          backLabel={copy.scanAgain}
          stepLabel={copy.stepLabel}
        />
        {failedLoader}
        <div className="results-page-error" role="alert">
          <p className="results-eyebrow">{copy.eyebrow}</p>
          <h1>{copy.rateLimited.title}</h1>
          <p>{copy.rateLimited.body}</p>
          <button type="button" className="results-page-action" onClick={retry}>
            {copy.tryAgain}
          </button>
        </div>
      </main>
    );
  }

  if (pageState.kind === "networkError") {
    return (
      <main className="resultsMain">
        <TopBar
          backHref="/scan/easy"
          onBackClick={() => rescanFrom("networkError")}
          backLabel={copy.scanAgain}
          stepLabel={copy.stepLabel}
        />
        {failedLoader}
        <div className="results-page-error" role="alert">
          <p className="results-eyebrow">{copy.eyebrow}</p>
          <h1>{copy.networkError.title}</h1>
          <p>{copy.networkError.body}</p>
          <button type="button" className="results-page-action" onClick={retry}>
            {copy.tryAgain}
          </button>
        </div>
      </main>
    );
  }

  if (pageState.kind === "serverError") {
    return (
      <main className="resultsMain">
        <TopBar
          backHref="/scan/easy"
          onBackClick={() => rescanFrom("serverError")}
          backLabel={copy.scanAgain}
          stepLabel={copy.stepLabel}
        />
        {failedLoader}
        <div className="results-page-error" role="alert">
          <p className="results-eyebrow">{copy.eyebrow}</p>
          <h1>{copy.serverError.title}</h1>
          <p>{copy.serverError.body}</p>
          <button type="button" className="results-page-action" onClick={retry}>
            {copy.tryAgain}
          </button>
        </div>
      </main>
    );
  }

  if (pageState.kind === "deleted") {
    return (
      <main className="resultsMain">
        <div className="results-page-error" role="status">
          <p className="results-eyebrow">{copy.eyebrow}</p>
          {/* Focus lands here on mount (see the ref below) — the trigger
              button that opened the confirmation no longer exists once this
              renders, so this heading is the one place left to send focus
              (docs/design-guidelines.md — focus management). */}
          <h1 ref={deletedHeadingRef} tabIndex={-1}>
            {copy.deleted.title}
          </h1>
          <p>{copy.deleted.body}</p>
          <Link
            href="/scan/easy"
            className="results-page-action"
            onClick={() => rescanFrom("deleted")}
          >
            {copy.scanAgain}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <ResultsScanContext.Provider value={scan}>
      <main className="resultsMain results-entered">
        {updatedNotice > 0 && (
          <ResultsUpdatedNotice
            key={updatedNotice}
            language={language}
            onGone={() => setUpdatedNotice(0)}
          />
        )}
        {children}
        {anonymous && (
          <DeleteScanAction
            scanId={scanId}
            onDeleted={() => {
              track("scan_deleted", {});
              setPageState({ kind: "deleted" });
            }}
          />
        )}
      </main>
    </ResultsScanContext.Provider>
  );
}
