"use client";

/**
 * The state machine behind every "send this scan" button: POST a
 * `ScanSubmission` through `submitScan`, track the outcome, remember a typed
 * hand length for the results page, and open the results on success. Shared by
 * `ScanSubmitPanel` (the printed-sheet flow and the demos) and the easy scan's
 * last question page, so the lock, the analytics and the error kinds live in
 * one place.
 *
 * The double-submit guard is a `useRef`, not `state.kind`: two clicks
 * dispatched in the same task (a double tap, or Enter held/repeated) both
 * run their handler before React commits the first `setState`, so a closure
 * reading `state.kind` sees "idle" for both and a second `fetch` goes out. A
 * ref is read and written synchronously, so the second call sees the first
 * call's write immediately — no render in between required.
 */
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ScanSubmission } from "@/lib/contracts/measurement";
import { resultsPagePath } from "@/lib/contracts/routes";
import type { ScanFlow } from "@/lib/contracts/analytics";
import { track } from "@/client/analytics/track";
import { submitScan, type SubmitScanErrorKind } from "@/client/scan/submitScan";
import { resultLengthKey } from "@/components/results/userLengthDisclosure";

export type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success" }
  | { kind: "error"; errorKind: SubmitScanErrorKind };

export function useScanSubmit(flow?: ScanFlow) {
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const router = useRouter();
  // Synchronous lock — see the file-level comment for why `state.kind`
  // alone can't guard against two clicks in the same task.
  const submittingRef = useRef(false);

  const submit = useCallback(
    (submission: ScanSubmission) => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      setState({ kind: "submitting" });
      void submitScan(submission).then((outcome) => {
        if (flow) {
          if (outcome.status === "success") track("scan_submitted", { flow });
          else track("scan_submit_failed", { flow, kind: outcome.kind });
        }
        if (outcome.status === "success") {
          try {
            if (
              "method" in submission.calibration &&
              submission.calibration.method === "user-length"
            ) {
              localStorage.setItem(
                resultLengthKey(outcome.scanId),
                String(submission.calibration.referenceMm),
              );
            }
          } catch {
            // Storage may be disabled; results remain available without the
            // no-paper disclosure.
          }
          setState({ kind: "success" });
          router.push(resultsPagePath(outcome.scanId));
          return;
        }
        // Release the lock on failure so the user can retry.
        submittingRef.current = false;
        setState({ kind: "error", errorKind: outcome.kind });
      });
    },
    [router, flow],
  );

  /** Hides a failure that no longer describes what is on screen (the person went back or changed an answer). */
  const clearError = useCallback(
    () => setState((prev) => (prev.kind === "error" ? { kind: "idle" } : prev)),
    [],
  );

  const busy = state.kind === "submitting" || state.kind === "success";
  return { state, submit, busy, clearError };
}
