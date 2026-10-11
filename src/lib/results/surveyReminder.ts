/**
 * The questionnaire reminder in the results top bar (candidate, Kirby
 * 2026-10-12): a small icon that leads to `/account`, with a blue dot while the
 * person has not answered. The rule that decides the dot (a candidate, Claude's
 * proposal):
 *   - signed in (`GET /api/survey` answers 200): the dot shows when the answers
 *     are empty, that is no ratings and no other mice;
 *   - signed out (`GET /api/survey` answers 401): the dot shows unless the
 *     device carries the "answered" flag (`SURVEY_ANSWERED_KEY`), which the
 *     anonymous submit sets after the server accepted it;
 *   - any other answer, a network error or a body the schema refuses: no dot
 *     ("unknown"), because a dot on a guess would nag for nothing.
 * The flag lives in `localStorage`, which can be missing or throw (a private
 * window, blocked site data): every read and write is guarded, and the page is
 * the same without it (signed-out people then see the dot).
 */
import {
  surveyMineResponseSchema,
  type SurveyMineResponse,
} from "@/lib/contracts/survey";
import { SURVEY_PATH } from "@/lib/contracts/routes";

/** The flag an anonymous submit leaves on the device once the server stored it. */
export const SURVEY_ANSWERED_KEY = "palmate.survey.answered";

export type ReminderStatus = "unknown" | "unanswered" | "answered";

/** Has a signed-in person answered? No ratings and no other mice is "not yet". */
export function surveyIsAnswered(mine: SurveyMineResponse): boolean {
  return mine.ratings.length > 0 || mine.otherMice.length > 0;
}

/** The part of `Storage` the reminder uses, so a test can pass a plain object. */
export type FlagStorage = Pick<Storage, "getItem" | "setItem">;

/** Is the "answered" flag on this device? `false` when storage is missing or throws. */
export function readAnsweredFlag(
  getStorage: () => FlagStorage | null,
): boolean {
  try {
    const storage = getStorage();
    return storage !== null && storage.getItem(SURVEY_ANSWERED_KEY) !== null;
  } catch {
    return false;
  }
}

/** Leave the flag. Returns whether it was written; never throws. */
export function markSurveyAnswered(
  getStorage: () => FlagStorage | null,
): boolean {
  try {
    const storage = getStorage();
    if (storage === null) return false;
    storage.setItem(SURVEY_ANSWERED_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

/** The browser's `localStorage`, or `null` where even touching it throws. */
export function browserStorage(): FlagStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

type FetchImpl = (
  input: string,
  init?: { signal?: AbortSignal; cache?: "no-store" },
) => Promise<{
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
}>;

/** Decide the dot. Never throws. `fetchImpl` and `getStorage` are for tests. */
export async function fetchReminderStatus(
  signal?: AbortSignal,
  fetchImpl: FetchImpl = (input, init) => fetch(input, init),
  getStorage: () => FlagStorage | null = browserStorage,
): Promise<ReminderStatus> {
  try {
    const res = await fetchImpl(SURVEY_PATH, { signal, cache: "no-store" });
    if (res.status === 401) {
      return readAnsweredFlag(getStorage) ? "answered" : "unanswered";
    }
    if (!res.ok) return "unknown";
    const parsed = surveyMineResponseSchema.safeParse(await res.json());
    if (!parsed.success) return "unknown";
    return surveyIsAnswered(parsed.data) ? "answered" : "unanswered";
  } catch {
    return "unknown";
  }
}
