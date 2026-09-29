"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { FitResponse } from "@/lib/contracts/fit";
import type { AnalysisState } from "@/components/results/analysisState";
import {
  fetchAnalysisResult,
  fetchFitResult,
  type FitPreferencesInput,
} from "@/components/results/fetchResults";
import { ResultsView } from "@/components/results/ResultsView";
import { resultLengthKey } from "@/components/results/userLengthDisclosure";
import { resultHandKey } from "@/components/results/handDisclosure";
import { TopBar } from "@/components/nav/TopBar";
import { DeleteScanAction } from "@/components/results/DeleteScanAction";
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
 * The real `/results/[scanId]` page. On mount it POSTs the fit route,
 * renders `ResultsView` as soon as that resolves (the ranking never waits on
 * the analysis — issue #30 acceptance criterion 2), then separately POSTs
 * the analysis route with the identical preferences and feeds its state into
 * `ResultsView`'s optional slot.
 *
 * Every non-happy path names the problem and gives the one action that fixes
 * it, per docs/design-guidelines.md's review checklist:
 *  - 404 (ownership rule in routes.ts: expired or foreign scans are 404,
 *    never 403) -> "scan again"
 *  - network error / 5xx -> "try again", which re-runs the fit request
 *  - 429 on the analysis alone -> handled inside `ResultsView`'s slot; the
 *    ranking above stays visible and unaffected
 *
 * `anonymous` (issue #42) is decided server-side by `page.tsx` (it calls
 * `auth()`), never guessed client-side: it gates the "Delete this scan now"
 * action, which a signed-in caller never sees at all — they manage scans on
 * `/account` instead.
 */
export function ResultsPageClient({
  scanId,
  anonymous,
}: {
  scanId: string;
  anonymous: boolean;
}) {
  const [pageState, setPageState] = useState<PageState>({ kind: "loading" });
  const [analysisState, setAnalysisState] = useState<AnalysisState>({
    status: "idle",
  });
  const [attempt, setAttempt] = useState(0);
  const [enteredLength, setEnteredLength] = useState<number | null>(null);
  const [scanHand, setScanHand] = useState<"left" | "right" | null>(null);

  useEffect(() => {
    try {
      const length = Number(localStorage.getItem(resultLengthKey(scanId)));
      setEnteredLength(
        Number.isFinite(length) && length >= 100 && length <= 280
          ? length
          : null,
      );
      const hand = localStorage.getItem(resultHandKey(scanId));
      setScanHand(hand === "left" || hand === "right" ? hand : null);
    } catch {
      setScanHand(null);
      setEnteredLength(null);
    }
  }, [scanId]);

  const runAnalysis = useCallback(async () => {
    setAnalysisState({ status: "loading" });
    const outcome = await fetchAnalysisResult(scanId, PREFERENCES);
    if (outcome.status === "ready") {
      setAnalysisState({ status: "ready", response: outcome.response });
    } else if (outcome.status === "rateLimited") {
      setAnalysisState({ status: "rateLimited" });
    } else {
      setAnalysisState({ status: "error" });
    }
  }, [scanId]);

  useEffect(() => {
    let cancelled = false;
    setPageState({ kind: "loading" });
    setAnalysisState({ status: "idle" });

    void (async () => {
      const outcome = await fetchFitResult(scanId, PREFERENCES);
      if (cancelled) return;
      if (outcome.status === "ready") {
        setPageState({ kind: "ready", response: outcome.response });
        void runAnalysis();
      } else {
        setPageState({ kind: outcome.status });
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `attempt` exists only to retrigger this effect
  }, [scanId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const deletedHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (pageState.kind === "deleted") deletedHeadingRef.current?.focus();
  }, [pageState.kind]);

  if (pageState.kind === "loading") {
    return (
      <main className="resultsMain">
        <TopBar
          backHref="/scan/easy"
          backLabel="Scan again"
          stepLabel="Your matches"
        />
        <p className="results-page-status" role="status">
          Loading your results&hellip;
        </p>
      </main>
    );
  }

  if (pageState.kind === "notFound") {
    return (
      <main className="resultsMain">
        <TopBar
          backHref="/scan/easy"
          backLabel="Scan again"
          stepLabel="Your matches"
        />
        <div className="results-page-error" role="alert">
          <p className="results-eyebrow">Results</p>
          <h1>We couldn&apos;t find this scan</h1>
          <p>
            It may have expired, or the link isn&apos;t yours. Scans without an
            account are only kept for 24 hours.
          </p>
          <Link href="/scan/easy" className="results-page-action">
            Scan again
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
          backLabel="Scan again"
          stepLabel="Your matches"
        />
        <div className="results-page-error" role="alert">
          <p className="results-eyebrow">Results</p>
          <h1>Too many tries in a short time</h1>
          <p>Wait a few minutes, then try again.</p>
          <button type="button" className="results-page-action" onClick={retry}>
            Try again
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
          backLabel="Scan again"
          stepLabel="Your matches"
        />
        <div className="results-page-error" role="alert">
          <p className="results-eyebrow">Results</p>
          <h1>We couldn&apos;t reach the server</h1>
          <p>Check your connection and try again.</p>
          <button type="button" className="results-page-action" onClick={retry}>
            Try again
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
          backLabel="Scan again"
          stepLabel="Your matches"
        />
        <div className="results-page-error" role="alert">
          <p className="results-eyebrow">Results</p>
          <h1>Something went wrong</h1>
          <p>We couldn&apos;t load your results. Try again.</p>
          <button type="button" className="results-page-action" onClick={retry}>
            Try again
          </button>
        </div>
      </main>
    );
  }

  if (pageState.kind === "deleted") {
    return (
      <main className="resultsMain">
        <div className="results-page-error" role="status">
          <p className="results-eyebrow">Results</p>
          {/* Focus lands here on mount (see the ref below) — the trigger
              button that opened the confirmation no longer exists once this
              renders, so this heading is the one place left to send focus
              (docs/design-guidelines.md — focus management). */}
          <h1 ref={deletedHeadingRef} tabIndex={-1}>
            This scan has been deleted
          </h1>
          <p>Its measurements have been permanently removed.</p>
          <Link href="/scan/easy" className="results-page-action">
            Scan again
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="resultsMain">
      <ResultsView
        scanHand={scanHand}
        enteredLengthMm={enteredLength}
        response={pageState.response}
        analysisState={analysisState}
        onRetryAnalysis={() => void runAnalysis()}
      />
      <p className="results-previewNotice">
        Early preview · measurements still being validated.
      </p>
      {anonymous && (
        <DeleteScanAction
          scanId={scanId}
          onDeleted={() => setPageState({ kind: "deleted" })}
        />
      )}
    </main>
  );
}
