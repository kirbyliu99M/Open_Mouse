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
  fetchAnalysisResult,
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
  parseStoredManualEntry,
  parseStoredUserLength,
  resultLengthKey,
  resultManualEntryKey,
  type StoredManualEntry,
} from "@/components/results/userLengthDisclosure";
import { prefetchMouseLinks } from "@/components/results/mouseLinksStore";
import { sweepLegacyHandKeys } from "@/components/results/handDisclosure";
import { track } from "@/client/analytics/track";
import { POOR_FIT_THRESHOLD } from "@/components/results/fitNotice";
import { TopBar } from "@/components/nav/TopBar";
import { DeleteScanAction } from "@/components/results/DeleteScanAction";
import { useLocale } from "@/client/i18n/LocaleProvider";
import { resultsScreensCopy } from "@/lib/copy/results-screens";
import type { Locale } from "@/lib/contracts/locale";
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
  analysisState: AnalysisState;
  /**
   * Ask for the written analysis. Only the main page (rank 1) gets a request
   * out of this, and only the first time per scan (`shouldRequestAnalysis`):
   * moving to a detail page and back does not ask again.
   */
  requestAnalysis: (isMainPage: boolean) => void;
  retryAnalysis: () => void;
  analytics: {
    onRetake: () => void;
    onListOpened: (list: "ranked" | "excluded") => void;
    onViewerInteracted: () => void;
  };
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
  const language = useLocale();
  const copy = resultsScreensCopy(language);
  // The locale the next analysis request is made in (the server answers in the
  // visitor's cookie locale, so a request is "in" the locale current when sent).
  const languageRef = useRef(language);
  languageRef.current = language;
  // The locale the analysis on screen (or in flight) was asked for.
  const analysisLanguageRef = useRef(language);

  useEffect(() => {
    try {
      setEnteredLength(
        parseStoredUserLength(localStorage.getItem(resultLengthKey(scanId))),
      );
      // The hand is read from the fit response now. Builds before that
      // stored it here; drop every leftover, not just this scan's.
      sweepLegacyHandKeys(localStorage);
      setEnteredManual(
        parseStoredManualEntry(
          localStorage.getItem(resultManualEntryKey(scanId)),
        ),
      );
    } catch {
      setEnteredLength(null);
      setEnteredManual(null);
    }
  }, [scanId]);

  // Bumped by every analysis run and by the fit effect's cleanup (scan changed
  // or page unmounted): a run that finds it moved on is stale and reports
  // nothing.
  const analysisRunRef = useRef(0);
  // Whether the analysis was asked for already, for this fit.
  const analysisStartedRef = useRef(false);
  // `viewer_interacted` is once per page, even if the viewer re-adds its listeners.
  const viewerInteractedRef = useRef(false);

  const runAnalysis = useCallback(async () => {
    analysisStartedRef.current = true;
    analysisLanguageRef.current = languageRef.current;
    const run = ++analysisRunRef.current;
    setAnalysisState({ status: "loading" });
    const outcome = await fetchAnalysisResult(scanId, PREFERENCES);
    if (run !== analysisRunRef.current) return;
    if (outcome.status === "ready") {
      track("analysis_shown", {
        outcome: outcome.response.source === "fallback" ? "fallback" : "model",
      });
      setAnalysisState({ status: "ready", response: outcome.response });
    } else if (outcome.status === "rateLimited") {
      track("analysis_shown", { outcome: "error" });
      setAnalysisState({ status: "rateLimited" });
    } else {
      track("analysis_shown", { outcome: "error" });
      setAnalysisState({ status: "error" });
    }
  }, [scanId]);

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
    // Ask for the links of the mouse the page will show now, so they are
    // usually in the cache by the first paint: the detail page's mouse at once
    // (in parallel with the fit), the overall #1 as soon as the fit is here.
    if (routeSlugRef.current) prefetchMouseLinks(routeSlugRef.current);
    setPageState({ kind: "loading" });
    setAnalysisState({ status: "idle" });
    analysisStartedRef.current = false;

    void (async () => {
      const outcome = await fitRequests.getOrStart(
        fitRequestKey(scanId, attempt),
        () => fetchFitResult(scanId, PREFERENCES),
      );
      if (cancelled) return;
      if (outcome.status === "ready") {
        const top = outcome.response.results[0];
        if (top && !routeSlugRef.current) prefetchMouseLinks(top.mouse.slug);
        if (top)
          track("results_viewed", {
            state: "ready",
            topPick: top.mouse.slug,
            noGoodFit: top.total < POOR_FIT_THRESHOLD,
          });
        setPageState({ kind: "ready", response: outcome.response });
      } else {
        track("results_viewed", { state: outcome.status });
        setPageState({ kind: outcome.status });
      }
    })();

    return () => {
      cancelled = true;
      analysisRunRef.current += 1;
    };
    // `attempt` is part of the request's identity and retriggers this effect
  }, [scanId, attempt]);

  const onRetake = useCallback(
    () => track("retake_clicked", { from: "results" }),
    [],
  );
  const analytics = useMemo(
    () => ({
      onRetake,
      onListOpened: (list: "ranked" | "excluded") =>
        track("results_list_opened", { list }),
      onViewerInteracted: () => {
        if (viewerInteractedRef.current) return;
        viewerInteractedRef.current = true;
        track("viewer_interacted", {});
      },
    }),
    [onRetake],
  );

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const retryAnalysis = useCallback(() => {
    track("analysis_retry_clicked", {});
    void runAnalysis();
  }, [runAnalysis]);

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
            analysisState,
            requestAnalysis,
            retryAnalysis,
            analytics,
          }
        : null,
    [
      pageState,
      scanId,
      language,
      enteredLength,
      enteredManual,
      analysisState,
      requestAnalysis,
      retryAnalysis,
      analytics,
    ],
  );

  if (pageState.kind === "loading") {
    return (
      <main className="resultsMain">
        <TopBar
          backHref="/scan/easy"
          backLabel={copy.scanAgain}
          stepLabel={copy.stepLabel}
          onBackClick={onRetake}
        />
        <p className="results-page-status" role="status">
          {copy.loading}
        </p>
      </main>
    );
  }

  if (pageState.kind === "notFound") {
    return (
      <main className="resultsMain">
        <TopBar
          backHref="/scan/easy"
          backLabel={copy.scanAgain}
          stepLabel={copy.stepLabel}
          onBackClick={onRetake}
        />
        <div className="results-page-error" role="alert">
          <p className="results-eyebrow">{copy.eyebrow}</p>
          <h1>{copy.notFound.title}</h1>
          <p>{copy.notFound.body}</p>
          <Link
            href="/scan/easy"
            className="results-page-action"
            onClick={onRetake}
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
          backLabel={copy.scanAgain}
          stepLabel={copy.stepLabel}
          onBackClick={onRetake}
        />
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
          backLabel={copy.scanAgain}
          stepLabel={copy.stepLabel}
          onBackClick={onRetake}
        />
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
          backLabel={copy.scanAgain}
          stepLabel={copy.stepLabel}
          onBackClick={onRetake}
        />
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
            onClick={onRetake}
          >
            {copy.scanAgain}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <ResultsScanContext.Provider value={scan}>
      <main className="resultsMain">
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
