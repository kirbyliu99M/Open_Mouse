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
import { looksLikeContactDetails } from "@/lib/learning/session";
import { browserStorage, type FlagStorage } from "./surveyReminder";

/**
 * The fallback timer (v2, Kirby 2026-10-15): the sheet used to appear after 20
 * s on the page, which covered people who were still reading. It is now 45 s
 * of the tab being VISIBLE (a tab in the background does not count), and only
 * once the person has scrolled for real, or the page cannot scroll at all.
 */
export const RESULT_FEEDBACK_DWELL_MS = 45_000;

/** How often the visible-time clock ticks. */
export const RESULT_FEEDBACK_TICK_MS = 1_000;

/** The thanks panel closes by itself after this long. */
export const RESULT_FEEDBACK_AUTOCLOSE_MS = 3_000;

/** A downward drag of the handle longer than this (px) closes the sheet. */
export const RESULT_FEEDBACK_DRAG_CLOSE_PX = 64;

const STORAGE_PREFIX = "palmate.resultFeedback.";

/**
 * Has the person scrolled to the end of the list? `markerInView` means the end
 * marker is in view or already above the window. Only a real scroll counts:
 * the end marker already in view on load (a short list, a tall window, a
 * restored scroll position) is not it, and a page that cannot scroll has only
 * the dwell time.
 */
export function reachedEnd(input: {
  markerInView: boolean;
  scrollMovedPx: number;
}): boolean {
  return input.markerInView && input.scrollMovedPx > 0;
}

/**
 * Add one tick to the visible-time clock. A tick that lands while the tab is
 * hidden adds nothing, and a negative or non-finite step is ignored.
 */
export function addVisibleTime(
  visibleMs: number,
  stepMs: number,
  tabVisible: boolean,
): number {
  if (!tabVisible || !Number.isFinite(stepMs) || stepMs <= 0) return visibleMs;
  return visibleMs + stepMs;
}

/** Can the page scroll at all? (Its content is taller than the window.) */
export function canPageScroll(input: {
  scrollHeight: number;
  viewportHeight: number;
}): boolean {
  return input.scrollHeight > input.viewportHeight + 1;
}

/** Does a handle drag of `dyPx` (positive is downward) close the sheet? */
export function dragClosesSheet(dyPx: number): boolean {
  return dyPx > RESULT_FEEDBACK_DRAG_CLOSE_PX;
}

export interface ShowSheetInput {
  /** `GET` said this scan was rated; `null` while unknown or when the call failed. */
  answered: boolean | null;
  dismissedLocally: boolean;
  scrolledToEnd: boolean;
  /** Milliseconds the tab has been visible on this page. */
  visibleElapsedMs: number;
  /** The person has scrolled at least once (a real scroll event). */
  hasScrolled: boolean;
  /** The page is taller than the window, so scrolling is possible. */
  canScroll: boolean;
  isDemo: boolean;
}

/**
 * Show the sheet when the status is known to be "not answered", it was not
 * closed on this device, it is not the demo, and either the end of the list
 * has been scrolled to, or the visible dwell time has passed AND the person
 * has scrolled (or the page cannot scroll, so there is nothing to scroll to).
 */
export function shouldShowSheet(input: ShowSheetInput): boolean {
  if (input.isDemo || input.dismissedLocally) return false;
  if (input.answered !== false) return false;
  if (input.scrolledToEnd) return true;
  const engaged = input.hasScrolled || !input.canScroll;
  return engaged && input.visibleElapsedMs >= RESULT_FEEDBACK_DWELL_MS;
}

export type SheetPhase = "form" | "sending" | "thanks" | "already";

export type PrimaryLabel = "send" | "sending" | "retry";

/**
 * Does Escape close the sheet? Not while an input method is composing (that
 * Escape belongs to the IME), and not while the form holds a typed comment
 * (it would throw the words away silently; the X still closes it).
 */
export function escapeCloses(input: {
  phase: SheetPhase;
  composing: boolean;
  comment: string;
}): boolean {
  if (input.composing) return false;
  if (input.phase === "form" && input.comment.trim() !== "") return false;
  return true;
}

/** The submit button is not drawn until a star is chosen. */
export function showSubmit(stars: number | null): boolean {
  return stars !== null;
}

/** Which word the primary button carries. */
export function primaryLabel(
  phase: SheetPhase,
  failure: SendFailure | null,
): PrimaryLabel {
  if (phase === "sending") return "sending";
  return failure === null ? "send" : "retry";
}

/**
 * The comment box shows once a star is chosen, and stays (changing the star
 * later does not fold it away).
 */
export function commentVisible(stars: number | null): boolean {
  return stars !== null;
}

export type BuildResult =
  | { ok: true; body: ResultFeedbackSubmission }
  | {
      ok: false;
      reason: "invalid" | "invalid_feedback" | "invalid_comment";
    };

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
  if (!onComment) return { ok: false, reason: "invalid" };
  return {
    ok: false,
    reason: looksLikeContactDetails(comment)
      ? "invalid_feedback"
      : "invalid_comment",
  };
}

export type SendFailure =
  | "conflict"
  | "rate_limited"
  | "invalid"
  | "invalid_feedback"
  | "invalid_comment"
  | "network";

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

// Analytics (the contract's `result_feedback_*` events). The page fields are
// added by the results page's emitter; only the extra props are made here.

/** `result_feedback_shown`: which came first, the end of the list or the dwell. */
export function shownEvent(scrolledToEnd: boolean) {
  return {
    name: "result_feedback_shown" as const,
    props: {
      trigger: scrolledToEnd ? ("scrolled" as const) : ("dwell" as const),
    },
  };
}

/** `result_feedback_submitted`: the stars and whether a comment was sent, never its text. */
export function submittedEvent(input: { stars: number; comment?: string }) {
  return {
    name: "result_feedback_submitted" as const,
    props: {
      stars: input.stars,
      commented: (input.comment ?? "").trim() !== "",
    },
  };
}

/** `result_feedback_dismissed` is sent only while the form is open (not after thanks or 409). */
export function dismissedEventDue(phase: SheetPhase): boolean {
  return phase === "form";
}
