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
import {
  RESULT_FINGERPRINT_HEADER,
  resultFeedbackPath,
} from "@/lib/contracts/routes";
import type { Locale } from "@/lib/contracts/locale";
import { looksLikeContactDetails } from "@/lib/learning/session";
import {
  browserStorage,
  type FlagStorage,
  type ReminderStatus,
} from "./surveyReminder";

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

/**
 * V3.2 F11 (Kirby's phone test, 2026-10-21: "the questionnaire pops up too
 * early, and again on every repeated scan"; the numbers are candidates):
 *   - no sheet in the first 20 s of the tab being visible, even when the end of
 *     the list is reached at once (before, reaching the end showed it at once);
 *   - after one prompt on this device (shown, then closed or sent), no other
 *     prompt for 30 days, whatever the scan, unless the notice version changes;
 *   - never for a person whose questionnaire is answered (signed in: the
 *     server's answers; signed out: this device's flag), and never while that
 *     is not known (still asking, or the answer could not be read: "unknown"),
 *     the same caution as the cool-down's unreadable storage.
 */
export const RESULT_FEEDBACK_MIN_DWELL_MS = 20_000;

/** How long one prompt keeps the next one away on this device (candidate). */
export const RESULT_FEEDBACK_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

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
  /** The person opened the Details section of the first place (V3.2 F11). */
  openedDetails: boolean;
  /** This device was prompted within the cool-down (`promptCoolingDown`), V3.2 F11. */
  coolingDown: boolean;
  /**
   * The questionnaire's status (`fetchReminderStatus`), V3.2 F11: only
   * "unanswered" lets the sheet show; "answered", "unknown" (the session or the
   * survey could not be read) and `null` (not back yet) keep it away.
   */
  questionnaire: ReminderStatus | null;
}

/**
 * Show the sheet when the status is known to be "not answered", it was not
 * closed on this device, it is not the demo, this device is not cooling down
 * after an earlier prompt, the questionnaire is known to be unanswered, and either
 *   - the tab has been visible 20 s and the person has looked at the result
 *     (scrolled to the end of the list, or opened the Details section), or
 *   - the tab has been visible 45 s and the person has scrolled (or the page
 *     cannot scroll, so there is nothing to scroll to).
 */
export function shouldShowSheet(input: ShowSheetInput): boolean {
  if (input.isDemo || input.dismissedLocally) return false;
  if (input.coolingDown || input.questionnaire !== "unanswered") return false;
  if (input.answered !== false) return false;
  const looked = input.scrolledToEnd || input.openedDetails;
  if (looked && input.visibleElapsedMs >= RESULT_FEEDBACK_MIN_DWELL_MS)
    return true;
  const engaged = input.hasScrolled || !input.canScroll;
  return engaged && input.visibleElapsedMs >= RESULT_FEEDBACK_DWELL_MS;
}

/** The device-wide memory of the last prompt (V3.2 F11). */
export const FEEDBACK_PROMPT_KEY = "palmate.resultFeedback.lastPrompt";

/**
 * What this device remembers of the last prompt: when it was shown and under
 * which notice version, `null` when there was none (or the value cannot be
 * read as one: it is then overwritten by the next prompt), and "unreadable"
 * when storage is missing or throws.
 */
export type LastPrompt = { at: number; notice: string } | null | "unreadable";

/** Read the last prompt. Never throws. */
export function readLastPrompt(
  getStorage: () => FlagStorage | null = browserStorage,
): LastPrompt {
  let raw: string | null;
  try {
    const storage = getStorage();
    if (storage === null) return "unreadable";
    raw = storage.getItem(FEEDBACK_PROMPT_KEY);
  } catch {
    return "unreadable";
  }
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { at?: unknown }).at === "number" &&
      Number.isFinite((parsed as { at: number }).at) &&
      typeof (parsed as { notice?: unknown }).notice === "string"
    ) {
      const { at, notice } = parsed as { at: number; notice: string };
      return { at, notice };
    }
  } catch {
    // Not JSON: as if there were none.
  }
  return null;
}

/** Remember that the sheet was shown now. Returns whether it was written; never throws. */
export function markPromptShown(
  nowMs: number,
  getStorage: () => FlagStorage | null = browserStorage,
): boolean {
  try {
    const storage = getStorage();
    if (storage === null) return false;
    storage.setItem(
      FEEDBACK_PROMPT_KEY,
      JSON.stringify({ at: nowMs, notice: RESULT_FEEDBACK_NOTICE_VERSION }),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Is this device still cooling down after the last prompt? Storage that
 * cannot be read counts as "prompted just now", so a private window or blocked
 * site data never means a prompt on every scan. A new notice version ends the
 * cool-down; a time in the future (a clock set back) counts as cooling down.
 */
export function promptCoolingDown(
  last: LastPrompt,
  nowMs: number,
  notice: string = RESULT_FEEDBACK_NOTICE_VERSION,
): boolean {
  if (last === "unreadable") return true;
  if (last === null) return false;
  if (last.notice !== notice) return false;
  return nowMs - last.at < RESULT_FEEDBACK_COOLDOWN_MS;
}

/**
 * What the sheet knows about this device before it has read anything (V3.2
 * F11): cooling down, so no clock runs and nothing is asked until the memory
 * says otherwise. `ResultFeedbackSheet` starts from this.
 */
export const INITIAL_SHEET_GATE = {
  localDone: false,
  coolingDown: true,
} as const;

/**
 * What the sheet does when it mounts for `scanId` (V3.2 F11): this scan was
 * closed or sent on this device ("done"), this device was prompted within the
 * cool-down ("cooling"), or it may ask the server ("ask"). Never throws.
 */
export function sheetGateOnMount(
  scanId: string,
  nowMs: number,
  getStorage: () => FlagStorage | null = browserStorage,
): "done" | "cooling" | "ask" {
  if (readFeedbackDone(scanId, getStorage)) return "done";
  if (promptCoolingDown(readLastPrompt(getStorage), nowMs)) return "cooling";
  return "ask";
}

/**
 * The sheet has just appeared for the first time on this page (V3.2 F11):
 * remember the prompt for the device-wide cool-down, and say which
 * `result_feedback_shown` event to send.
 */
export function recordFirstShow(
  nowMs: number,
  scrolledToEnd: boolean,
  getStorage: () => FlagStorage | null = browserStorage,
) {
  markPromptShown(nowMs, getStorage);
  return shownEvent(scrolledToEnd);
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
  /** 412 (V3.2 F1, candidate): the ranking changed; nothing was stored. */
  | "stale"
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
    case 412:
      return "stale";
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

/**
 * Send the body. Never throws. `resultFingerprint` is the one of the ranking
 * on screen (V3.2 F1, candidate); without it no header is sent and the server
 * behaves as before.
 */
export async function sendFeedback(
  scanId: string,
  body: ResultFeedbackSubmission,
  fetchImpl: FetchImpl = defaultFetch,
  resultFingerprint?: string,
): Promise<SendResult> {
  try {
    const res = await fetchImpl(resultFeedbackPath(scanId), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(resultFingerprint
          ? { [RESULT_FINGERPRINT_HEADER]: resultFingerprint }
          : {}),
      },
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

/**
 * What the sheet does after a send. Pure, so the rules are tested:
 *   - stored: remember it on this device, thank the person;
 *   - 409 (rated already): remember it, say so;
 *   - 412 (V3.2 F1, candidate: the ranking changed): nothing was stored; stay
 *     on the form with the stars and the comment, say why (`resultChanged`),
 *     fetch the new ranking, and wait for the person to send again; never send
 *     by itself;
 *   - anything else: stay on the form and say what went wrong.
 */
export function afterSend(result: SendResult): {
  phase: SheetPhase;
  failure: SendFailure | null;
  markDone: boolean;
  refetchFit: boolean;
} {
  if (result.ok)
    return {
      phase: "thanks",
      failure: null,
      markDone: true,
      refetchFit: false,
    };
  if (result.reason === "conflict")
    return {
      phase: "already",
      failure: null,
      markDone: true,
      refetchFit: false,
    };
  return {
    phase: "form",
    failure: result.reason,
    markDone: false,
    refetchFit: result.reason === "stale",
  };
}

/** What `submitFeedback` touches: the sheet's state setters and the outside world. */
/**
 * The sheet's `send`: forwards the fingerprint of the ranking on screen to
 * `sendFeedback`, which puts it in the `x-result-fingerprint` header (V3.2 F1,
 * candidate). A factory so the forwarding is tested with a fake fetch.
 */
export function feedbackSender(
  fetchImpl: FetchImpl = defaultFetch,
): FeedbackSubmitIo["send"] {
  return (scanId, body, resultFingerprint) =>
    sendFeedback(scanId, body, fetchImpl, resultFingerprint);
}

export interface FeedbackSubmitIo {
  send: (
    scanId: string,
    body: ResultFeedbackSubmission,
    resultFingerprint: string | undefined,
  ) => Promise<SendResult>;
  markDone: (scanId: string) => void;
  setFailure: (failure: SendFailure | null) => void;
  setPhase: (phase: SheetPhase) => void;
  /** `result_feedback_submitted`, only once the rating is stored. */
  emitSubmitted?: (event: ReturnType<typeof submittedEvent>) => void;
  /** The page refetches the fit (V3.2 F1, candidate: after a 412). */
  onResultChanged?: () => void;
}

/**
 * The sheet's submit button, wired (kept here so it is tested without a
 * browser): build the body, send it with the fingerprint of the ranking on
 * screen, then apply `afterSend`. A 412 calls `onResultChanged` once and
 * leaves the sheet on the form; nothing sends again until the person presses
 * the button again. Does nothing while a send is in flight.
 */
export async function submitFeedback(
  input: {
    scanId: string;
    phase: SheetPhase;
    stars: number | null;
    comment: string;
    locale: Locale;
    resultFingerprint: string | undefined;
  },
  io: FeedbackSubmitIo,
): Promise<void> {
  if (input.phase === "sending") return;
  const built = buildSubmission({
    stars: input.stars,
    comment: input.comment,
    locale: input.locale,
  });
  if (!built.ok) {
    io.setFailure(built.reason);
    return;
  }
  io.setFailure(null);
  io.setPhase("sending");
  const result = await io.send(
    input.scanId,
    built.body,
    input.resultFingerprint,
  );
  const next = afterSend(result);
  if (next.markDone) io.markDone(input.scanId);
  if (result.ok) {
    io.emitSubmitted?.(
      submittedEvent({ stars: built.body.stars, comment: built.body.comment }),
    );
  }
  io.setFailure(next.failure);
  io.setPhase(next.phase);
  // 412: nothing was stored. Fetch the ranking that is now true and let the
  // person look at it before sending again (never sent automatically).
  if (next.refetchFit) io.onResultChanged?.();
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

/**
 * `result_feedback_shown`: "scrolled" when the end of the list had been
 * reached when the sheet appeared, "dwell" otherwise.
 *
 * Since V3.2 F11 the sheet can also appear 20 s after Details was opened
 * without the end of the list being reached; the contract
 * (`src/lib/contracts/analytics.ts`) has only "scrolled" and "dwell", so that
 * case is sent as "dwell" and cannot be told apart from the 45 s rule. And
 * "scrolled" now means "the end was reached and the tab was visible 20 s",
 * not "shown as the end was reached". Whether the contract gets a value of its
 * own for Details is not decided (candidate; only Claude edits contracts).
 */
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
