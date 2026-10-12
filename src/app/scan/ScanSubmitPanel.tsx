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
 * The double-submit guard, the analytics and the error kinds live in
 * `useScanSubmit`, which the easy scan's last question page shares.
 *
 * Kept as its own component (rather than inline in ScanClient.tsx) so it
 * can be exercised directly — with a fixed, schema-valid `ScanSubmission` —
 * from `/scan/submit-demo` (mirrors `/results/demo`). That route exists
 * because no e2e fixture can make MediaPipe detect a hand in a synthetic
 * image (see tests/e2e/fixtures/synthetic-photo.ts's own comment), so it's
 * the only way to reach "ok" deterministically in CI and exercise the real
 * submit fetch, its error handling, and the navigation it performs.
 */
import type { ScanSubmission } from "@/lib/contracts/measurement";
import { useLocale } from "@/client/i18n/LocaleProvider";
import { scanCommonCopy } from "@/lib/copy/scan-common";
import type { ScanFlow } from "@/lib/contracts/analytics";
import { useScanSubmit } from "@/client/scan/useScanSubmit";

export interface ScanSubmitPanelProps {
  readonly submission: ScanSubmission;
  /** Which scan flow this is, for analytics. Left out by the demo page, which then sends nothing. */
  readonly flow?: ScanFlow;
}

export default function ScanSubmitPanel({
  submission,
  flow,
}: ScanSubmitPanelProps) {
  const { state, submit, busy } = useScanSubmit(flow);
  const locale = useLocale();
  const words = scanCommonCopy(locale);

  const statusText =
    state.kind === "submitting"
      ? words.submitSending
      : state.kind === "success"
        ? words.submitSuccessStatus
        : "";

  return (
    <div className="submitPanel">
      <button
        type="button"
        className="primaryButton"
        onClick={() => submit(submission)}
        disabled={busy}
        data-testid="submit-scan-button"
      >
        {state.kind === "submitting"
          ? words.submitButtonSubmitting
          : state.kind === "success"
            ? words.submitButtonOpening
            : words.submitButton}
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
          <p className="feedbackTitle">{words.submitErrors[state.errorKind]}</p>
        </div>
      )}
    </div>
  );
}
