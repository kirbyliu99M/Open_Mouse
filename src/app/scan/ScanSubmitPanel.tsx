"use client";

/**
 * The primary action on `/scan` once a scan has reached "ok" (issue #29):
 * submit `ScanSubmission` to `SCAN_SUBMIT_PATH` and, on success, open its
 * results. All the actual request/response handling lives in
 * `src/client/scan/submitScan.ts` — this component is only the UI state
 * machine on top of it (press feedback, a visible status while the request
 * runs, one disabled action so a double tap can't submit twice, and
 * distinct, actionable copy per error kind).
 *
 * Kept as its own component (rather than inline in ScanClient.tsx) so it
 * can be exercised directly — with a fixed, schema-valid `ScanSubmission` —
 * from `/scan/submit-demo` (mirrors `/results/demo`). That route exists
 * because no e2e fixture can make MediaPipe detect a hand in a synthetic
 * image (see tests/e2e/fixtures/synthetic-photo.ts's own comment), so it's
 * the only way to reach "ok" deterministically in CI and exercise the real
 * submit fetch, its error handling, and the navigation it performs.
 */
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { ScanSubmission } from "@/lib/contracts/measurement";
import { resultsPagePath } from "@/lib/contracts/routes";
import { submitScan } from "@/client/scan/submitScan";

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success" }
  | { kind: "error"; message: string; detail?: string };

export interface ScanSubmitPanelProps {
  readonly submission: ScanSubmission;
}

export default function ScanSubmitPanel({ submission }: ScanSubmitPanelProps) {
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const router = useRouter();

  const onSubmit = useCallback(() => {
    if (state.kind === "submitting" || state.kind === "success") return;
    setState({ kind: "submitting" });
    void submitScan(submission).then((outcome) => {
      if (outcome.status === "success") {
        setState({ kind: "success" });
        router.push(resultsPagePath(outcome.scanId));
        return;
      }
      setState({
        kind: "error",
        message: outcome.message,
        detail: outcome.detail,
      });
    });
  }, [state.kind, submission, router]);

  const busy = state.kind === "submitting" || state.kind === "success";
  const statusText =
    state.kind === "submitting"
      ? "Sending your measurements…"
      : state.kind === "success"
        ? "Measured — opening your results…"
        : "";

  return (
    <div className="submitPanel">
      <button
        type="button"
        className="primaryButton"
        onClick={onSubmit}
        disabled={busy}
        data-testid="submit-scan-button"
      >
        {state.kind === "submitting"
          ? "Submitting…"
          : state.kind === "success"
            ? "Opening your results…"
            : "Get my results"}
      </button>
      <div
        aria-live="polite"
        className="submitStatus"
        data-testid="submit-status"
      >
        {statusText}
      </div>
      {state.kind === "error" && (
        <div className="feedback feedback-error" role="alert">
          <p className="feedbackTitle">{state.message}</p>
          {state.detail && <p className="feedbackDetail">{state.detail}</p>}
        </div>
      )}
    </div>
  );
}
