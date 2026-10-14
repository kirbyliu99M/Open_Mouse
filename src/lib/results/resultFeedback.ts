/**
 * The logic of the results page's feedback sheet (Kirby, 2026-10-14), kept
 * pure so it is tested without a browser:
 *   - `shouldShowSheet`: when the sheet may appear;
 *   - `buildSubmission`: the body of `POST resultFeedbackPath`, parsed with
 *     the contract's schema before it is sent;
 *   - `fetchAnswered` / `sendFeedback`: the two calls, which never throw;
 *   - a per-scan memory in `localStorage` (guarded, as in `surveyReminder.ts`)
 *     so a sheet that was closed or sent does not come back on this device.
 */
import {
  RESULT_FEEDBACK_NOTICE_VERSION,
  resultFeedbackStatusResponseSchema,
  resultFeedbackSubmissionSchema,
  resultFeedbackSubmitResponseSchema,
  type ResultFeedbackSubmission,
} from "@/lib/contracts/result-feedback";
import { resultFeedbackPath } from "@/lib/contracts/routes";
import type { Locale } from "@/lib/contracts/locale";
import { browserStorage, type FlagStorage } from "./surveyReminder";

/** How long the person has been on the page before the sheet may show. */
export const RESULT_FEEDBACK_DWELL_MS = 20_000;

const STORAGE_PREFIX = "palmate.resultFeedback.";

export interface ShowSheetInput {
  /** `GET` said this scan was rated; `null` while unknown or when the call failed. */
  answered: boolean | null;
  dismissedLocally: boolean;
  scrolledToEnd: boolean;
  elapsedMs: number;
  isDemo: boolean;
}

/**
 * Show the sheet when the status is known to be "not answered", it was not
 * closed on this device, it is not the demo, and either the end of the list
 * has been reached or the dwell time has passed.
 */
export function shouldShowSheet(input: ShowSheetInput): boolean {
  if (input.isDemo || input.dismissedLocally) return false;
  if (input.answered !== false) return false;
  return input.scrolledToEnd || input.elapsedMs >= RESULT_FEEDBACK_DWELL_MS;
}

export type BuildResult =
  | { ok: true; body: ResultFeedbackSubmission }
  | { ok: false; reason: "invalid" | "invalid_feedback" };

/** The body to send: trimmed comment (omitted when empty), parsed by the contract. */
export function buildSubmission(input: {
  stars: number | null;
  comment: string;
  locale: Locale;
}): BuildResult {
  const comment = input.comment.trim();
  const parsed = resultFeedbackSubmissionSchema.safeParse({
    notice: RESULT_FEEDBACK_NOTICE_VERSION,
    stars: input.stars,
    ...(comment === "" ? {} : { comment }),
    locale: input.locale,
  });
  if (parsed.success) return { ok: true, body: parsed.data };
  const onComment = parsed.error.issues.some((i) => i.path[0] === "comment");
  return { ok: false, reason: onComment ? "invalid_feedback" : "invalid" };
}

export type SendFailure =
  "conflict" | "rate_limited" | "invalid" | "invalid_feedback" | "network";

export type SendResult =
  { ok: true; withdrawable: boolean } | { ok: false; reason: SendFailure };

/**
 * Map the status of a refused `POST`. A 400 with a comment in the body is
 * taken to be the contact-details refusal (the stars cannot be wrong: the page
 * only offers 1 to 5); 404 and anything else is "network".
 */
export function failureFromStatus(
  status: number,
  hadComment: boolean,
): SendFailure {
  switch (status) {
    case 409:
      return "conflict";
    case 429:
      return "rate_limited";
    case 400:
      return hadComment ? "invalid_feedback" : "invalid";
    case 413:
      return "invalid";
    default:
      return "network";
  }
}

type FetchImpl = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    credentials?: "same-origin";
    cache?: "no-store";
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const defaultFetch: FetchImpl = (input, init) => fetch(input, init);

/** Was this scan already rated? `null` when it cannot be known (fail quiet). */
export async function fetchAnswered(
  scanId: string,
  signal?: AbortSignal,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<boolean | null> {
  try {
    const res = await fetchImpl(resultFeedbackPath(scanId), {
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
    if (!res.ok) return null;
    const parsed = resultFeedbackStatusResponseSchema.safeParse(
      await res.json(),
    );
    return parsed.success ? parsed.data.answered : null;
  } catch {
    return null;
  }
}

/** Send the body. Never throws. */
export async function sendFeedback(
  scanId: string,
  body: ResultFeedbackSubmission,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<SendResult> {
  try {
    const res = await fetchImpl(resultFeedbackPath(scanId), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        reason: failureFromStatus(res.status, body.comment !== undefined),
      };
    }
    const parsed = resultFeedbackSubmitResponseSchema.safeParse(
      await res.json().catch(() => null),
    );
    // The row is stored once the status is 201, whatever the body says.
    return {
      ok: true,
      withdrawable: parsed.success && parsed.data.withdrawable,
    };
  } catch {
    return { ok: false, reason: "network" };
  }
}

export const feedbackStorageKey = (scanId: string): string =>
  `${STORAGE_PREFIX}${scanId}`;

/** Was the sheet closed or sent for this scan on this device? */
export function readFeedbackDone(
  scanId: string,
  getStorage: () => FlagStorage | null = browserStorage,
): boolean {
  try {
    const storage = getStorage();
    return (
      storage !== null && storage.getItem(feedbackStorageKey(scanId)) !== null
    );
  } catch {
    return false;
  }
}

/** Remember it. Returns whether it was written; never throws. */
export function markFeedbackDone(
  scanId: string,
  getStorage: () => FlagStorage | null = browserStorage,
): boolean {
  try {
    const storage = getStorage();
    if (storage === null) return false;
    storage.setItem(feedbackStorageKey(scanId), "1");
    return true;
  } catch {
    return false;
  }
}
