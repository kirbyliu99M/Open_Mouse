/**
 * The questionnaire reminder in the results top bar (candidate, Kirby
 * 2026-10-12): a small icon that leads to `/account`, with a blue dot while the
 * person has not answered. The rule that decides the dot (a candidate, Claude's
 * proposal):
 *   - first ask `GET /api/auth/session` (it answers 200 for everyone, so a
 *     signed-out visit or a demo leaves no error line in the console);
 *   - signed in: `GET /api/survey` decides: the dot shows when the answers are
 *     empty, that is no ratings and no other mice;
 *   - signed out: the dot shows unless the device carries the "answered" flag
 *     (`SURVEY_ANSWERED_KEY`), which the anonymous submit sets after the server
 *     accepted it. `/api/survey` is not called at all;
 *   - any other answer, a network error or a body that cannot be read: no dot
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
import { parseSessionBody } from "@/components/nav/account-nav";

/** The session route the nav reads too (`AccountNavLink`). */
const SESSION_PATH = "/api/auth/session";

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

/**
 * Is anyone signed in? Asked of `GET /api/auth/session`, as the nav's
 * `AccountNavLink` does, because that route answers 200 for everyone (`null`
 * when signed out) and so leaves no error line in the browser console, which a
 * 401 from `/api/survey` would. `"unknown"` when the session cannot be read.
 */
async function readSession(
  signal: AbortSignal | undefined,
  fetchImpl: FetchImpl,
): Promise<"signedIn" | "signedOut" | "unknown"> {
  const res = await fetchImpl(SESSION_PATH, { signal, cache: "no-store" });
  if (!res.ok) return "unknown";
  const body: unknown = await res.json();
  if (parseSessionBody(body) !== null) return "signedIn";
  const empty =
    body === null ||
    (typeof body === "object" &&
      !Array.isArray(body) &&
      Object.keys(body).length === 0);
  return empty ? "signedOut" : "unknown";
}

/**
 * Decide the dot. Never throws. Signed out: the device flag decides and
 * `/api/survey` is not called at all. Signed in: `/api/survey` decides.
 * `fetchImpl` and `getStorage` are for tests.
 */
export async function fetchReminderStatus(
  signal?: AbortSignal,
  fetchImpl: FetchImpl = (input, init) => fetch(input, init),
  getStorage: () => FlagStorage | null = browserStorage,
): Promise<ReminderStatus> {
  try {
    const session = await readSession(signal, fetchImpl);
    if (session === "unknown") return "unknown";
    if (session === "signedOut") {
      return readAnsweredFlag(getStorage) ? "answered" : "unanswered";
    }
    const res = await fetchImpl(SURVEY_PATH, { signal, cache: "no-store" });
    if (!res.ok) return "unknown";
    const parsed = surveyMineResponseSchema.safeParse(await res.json());
    if (!parsed.success) return "unknown";
    return surveyIsAnswered(parsed.data) ? "answered" : "unanswered";
  } catch {
    return "unknown";
  }
}
