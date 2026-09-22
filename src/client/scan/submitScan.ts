/**
 * POSTs an already-assembled `ScanSubmission` (src/lib/contracts/measurement.ts)
 * to `SCAN_SUBMIT_PATH` and classifies the outcome for the UI. Issue #29:
 * `ScanClient.tsx` already builds this object client-side
 * (`assembleScanSubmission` in src/client/photo/submission.ts) — this module
 * is the only place that puts it on the wire.
 *
 * Hard rule 5 ("photos never leave the browser"): the only thing this
 * function ever sends is the `ScanSubmission` object itself — a handful of
 * millimetre numbers and enum strings, never the photo, a `Blob`/`File`, or
 * a data URL. `ScanSubmission`'s own type makes an image-shaped field
 * impossible to construct here in the first place.
 *
 * Never trust the response body's shape: every non-2xx path is re-validated
 * with `errorResponseSchema` before its `error` string is surfaced, and a
 * body that fails that parse (or isn't JSON at all — an infra error page,
 * say) falls back to this module's own copy instead. Same for a 201 whose
 * body doesn't match `scanSubmitResponseSchema`.
 */
import {
  SCAN_SUBMIT_PATH,
  scanSubmitResponseSchema,
  errorResponseSchema,
} from "../../lib/contracts/routes";
import type { ScanSubmission } from "../../lib/contracts/measurement";

export type SubmitScanErrorKind = "invalid" | "tooLarge" | "network" | "server";

export type SubmitScanOutcome =
  | { readonly status: "success"; readonly scanId: string }
  | {
      readonly status: "error";
      readonly kind: SubmitScanErrorKind;
      /** Actionable, user-facing sentence — one instruction, per kind. */
      readonly message: string;
      /**
       * Supplementary detail from a response body that DID parse as
       * `errorResponseSchema` — shown alongside `message`, never in place
       * of it.
       */
      readonly detail?: string;
    };

/** One distinct, actionable sentence per error kind (design-guidelines.md). */
export const SUBMIT_ERROR_MESSAGES: Record<SubmitScanErrorKind, string> = {
  invalid:
    "This scan couldn't be saved — retake the top-down photo and try again.",
  tooLarge:
    "This scan didn't send correctly — reload the page and retake the photo.",
  network: "No connection — check your network, then try submitting again.",
  server: "Something went wrong on our end — wait a moment and try again.",
};

async function readErrorDetail(response: Response): Promise<string | undefined> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return undefined;
  }
  const parsed = errorResponseSchema.safeParse(body);
  return parsed.success ? parsed.data.error : undefined;
}

/**
 * `fetchImpl` is injectable for unit tests; the app always calls this with
 * the default (the browser's own `fetch`).
 */
export async function submitScan(
  submission: ScanSubmission,
  fetchImpl: typeof fetch = fetch,
): Promise<SubmitScanOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(SCAN_SUBMIT_PATH, {
      method: "POST",
      // Same-origin fetch, explicit: the server sets the session cookie on
      // the first submit and expects it back on later ones (issue #29 AC 6).
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(submission),
    });
  } catch {
    return {
      status: "error",
      kind: "network",
      message: SUBMIT_ERROR_MESSAGES.network,
    };
  }

  if (response.status === 201) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        status: "error",
        kind: "server",
        message: SUBMIT_ERROR_MESSAGES.server,
      };
    }
    const parsed = scanSubmitResponseSchema.safeParse(body);
    if (!parsed.success) {
      return {
        status: "error",
        kind: "server",
        message: SUBMIT_ERROR_MESSAGES.server,
      };
    }
    return { status: "success", scanId: parsed.data.scanId };
  }

  const detail = await readErrorDetail(response);
  if (response.status === 400) {
    return {
      status: "error",
      kind: "invalid",
      message: SUBMIT_ERROR_MESSAGES.invalid,
      detail,
    };
  }
  if (response.status === 413) {
    return {
      status: "error",
      kind: "tooLarge",
      message: SUBMIT_ERROR_MESSAGES.tooLarge,
      detail,
    };
  }
  return {
    status: "error",
    kind: "server",
    message: SUBMIT_ERROR_MESSAGES.server,
    detail,
  };
}
