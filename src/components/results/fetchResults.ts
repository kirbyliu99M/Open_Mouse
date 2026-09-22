/**
 * Fetch + validate the fit and analysis routes for the real results page
 * (`/results/[scanId]`).
 *
 * Kept as plain, injectable-fetch functions (rather than inline in the
 * client component) so they can be unit-tested with a mocked `fetch` in
 * vitest, per issue #30 ("test the page with mocked fetch") — there is no
 * React Testing Library in this repo, so component-level behaviour is
 * covered by the Playwright spec's `page.route` stubs instead.
 *
 * Every response is validated against the real contract schemas before
 * anything is rendered; a response that doesn't match the contract is
 * treated the same as a 5xx (`serverError`) rather than trusted. Server
 * `error` text (`errorResponseSchema`) is never shown to the user — the UI's
 * own copy is chosen to satisfy docs/design-guidelines.md, not whatever the
 * server happened to say.
 */
import type { z } from "zod";
import {
  fitPreferencesSchema,
  fitResponseSchema,
  type FitResponse,
} from "@/lib/contracts/fit";
import { analysisPath, fitPath } from "@/lib/contracts/routes";
import {
  analysisResponseSchema,
  type AnalysisResponse,
} from "@/lib/contracts/analysis";

/**
 * The *input* type of `fitPreferencesSchema` — every field optional or
 * defaulted, so `{}` (the literal body issue #30 asks the page to send) is a
 * valid value. `FitPreferences` (`z.infer`, the *output* type) fills in
 * `includeVertical` and would reject a bare `{}` at the type level even
 * though the schema itself accepts it.
 */
export type FitPreferencesInput = z.input<typeof fitPreferencesSchema>;

export type FitOutcome =
  | { status: "ready"; response: FitResponse }
  | { status: "notFound" }
  | { status: "networkError" }
  | { status: "serverError" };

export type AnalysisOutcome =
  | { status: "ready"; response: AnalysisResponse }
  | { status: "rateLimited" }
  | { status: "networkError" }
  | { status: "serverError" };

type FetchImpl = typeof fetch;

async function postJson(
  path: string,
  body: unknown,
  fetchImpl: FetchImpl,
): Promise<Response | "networkError"> {
  try {
    return await fetchImpl(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return "networkError";
  }
}

export async function fetchFitResult(
  scanId: string,
  preferences: FitPreferencesInput,
  fetchImpl: FetchImpl = fetch,
): Promise<FitOutcome> {
  const res = await postJson(fitPath(scanId), preferences, fetchImpl);
  if (res === "networkError") return { status: "networkError" };
  if (res.status === 404) return { status: "notFound" };
  if (!res.ok) return { status: "serverError" };

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { status: "serverError" };
  }
  const parsed = fitResponseSchema.safeParse(json);
  if (!parsed.success) return { status: "serverError" };
  return { status: "ready", response: parsed.data };
}

export async function fetchAnalysisResult(
  scanId: string,
  preferences: FitPreferencesInput,
  fetchImpl: FetchImpl = fetch,
): Promise<AnalysisOutcome> {
  const res = await postJson(analysisPath(scanId), preferences, fetchImpl);
  if (res === "networkError") return { status: "networkError" };
  if (res.status === 429) return { status: "rateLimited" };
  if (!res.ok) return { status: "serverError" };

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { status: "serverError" };
  }
  const parsed = analysisResponseSchema.safeParse(json);
  if (!parsed.success) return { status: "serverError" };
  return { status: "ready", response: parsed.data };
}
