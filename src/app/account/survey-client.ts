/**
 * The browser's calls to `/api/survey` for the questionnaire form and the edit
 * sheet (`POST` first answers, `PUT` a whole replacement). A call never throws:
 * it answers with what the page should say, from the status the route
 * documents (`SURVEY_PATH` in `src/lib/contracts/routes.ts`).
 */
import { SURVEY_PATH } from "@/lib/contracts/routes";
import {
  surveyEditSchema,
  surveySubmissionSchema,
  type SurveyEdit,
  type SurveySubmission,
} from "@/lib/contracts/survey";

/** What went wrong, in the page's terms. */
export type SurveyFailure =
  /** 409 (POST): this scan has already contributed. */
  | "conflict"
  /** 404: the scan is gone (POST), or there is nothing to edit yet (PUT). */
  | "not_found"
  /** 429: try again later. */
  | "rate_limited"
  /** 401: not signed in (PUT). */
  | "unauthorized"
  /** 400 or 413, or the body did not pass the contract in the browser. */
  | "invalid"
  /** The comment holds an email address or a phone-like run of digits. */
  | "invalid_feedback"
  /** No answer at all, or a server error. */
  | "network";

export type SurveyCallResult =
  { ok: true } | { ok: false; reason: SurveyFailure };

type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    credentials?: "same-origin";
    cache?: "no-store";
  },
) => Promise<{ ok: boolean; status: number }>;

/** Map a status the route documents to the page's failure. */
export function failureFromStatus(status: number): SurveyFailure {
  switch (status) {
    case 409:
      return "conflict";
    case 404:
      return "not_found";
    case 429:
      return "rate_limited";
    case 401:
      return "unauthorized";
    case 400:
    case 413:
      return "invalid";
    default:
      return "network";
  }
}

/** The failure to show when the contract itself refuses the body in the browser. */
function failureFromIssues(
  issues: readonly { path: PropertyKey[] }[],
): SurveyFailure {
  return issues.some((i) => i.path[0] === "feedback")
    ? "invalid_feedback"
    : "invalid";
}

async function send(
  method: "POST" | "PUT",
  body: unknown,
  fetchImpl: FetchLike,
): Promise<SurveyCallResult> {
  try {
    const res = await fetchImpl(SURVEY_PATH, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
    if (res.ok) return { ok: true };
    return { ok: false, reason: failureFromStatus(res.status) };
  } catch {
    return { ok: false, reason: "network" };
  }
}

/**
 * `POST /api/survey`: the first answers for one scan. The body is checked
 * against the contract first, so a comment with an email address says so
 * instead of coming back as an unexplained 400.
 */
export async function postSurvey(
  body: SurveySubmission,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): Promise<SurveyCallResult> {
  const checked = surveySubmissionSchema.safeParse(body);
  if (!checked.success) {
    return { ok: false, reason: failureFromIssues(checked.error.issues) };
  }
  return send("POST", checked.data, fetchImpl);
}

/** `PUT /api/survey`: the whole new set of answers. Checked against the contract first. */
export async function putSurvey(
  body: SurveyEdit,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): Promise<SurveyCallResult> {
  const checked = surveyEditSchema.safeParse(body);
  if (!checked.success) {
    return { ok: false, reason: failureFromIssues(checked.error.issues) };
  }
  return send("PUT", checked.data, fetchImpl);
}
