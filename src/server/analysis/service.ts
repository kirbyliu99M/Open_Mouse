import { analysisResponseSchema } from "../../lib/contracts/analysis";
import { fitPreferencesSchema } from "../../lib/contracts/fit";
import { BodyTooLargeError, readLimitedBody } from "../scans/body-limit";
import { readSessionCookie } from "../scans/cookies";
import type { ScanRepo } from "../scans/repo";
import { loadOwnedFit, type LoadOwnedFitResult } from "../fit/core";
import type { FitRepo } from "../fit/repo";
import type { AnalysisRequestDeps } from "./handler";
import { handleAnalysisRequest } from "./handler";
import { resolveClientIp } from "./ip";

// `no-store`: every response here carries personal hand-measurement data,
// a ranking derived from it, or prose written about that ranking (same
// finding as #24/M6, mirrored from `../fit/service.ts`).
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

export interface AnalysisServiceDeps {
  scanRepo: ScanRepo;
  fitRepo: FitRepo;
  client: AnalysisRequestDeps["client"];
  cache: AnalysisRequestDeps["cache"];
  limiter: AnalysisRequestDeps["limiter"];
  /** Site-wide daily cap on real model calls — see `./handler.ts`. */
  globalLimiter: AnalysisRequestDeps["globalLimiter"];
  /** Resolves the signed-in caller's user id, or null. Wraps `auth()` in the
   * real route; tests inject a fake so no NextAuth machinery runs here. */
  getUserId: () => Promise<string | null>;
  /** Injectable clock; defaults to `new Date()`. Passed through to
   * `loadOwnedFit`, which needs it for session-expiry checks. */
  now?: () => Date;
}

/**
 * `POST /api/scans/{scanId}/analysis`. Thin HTTP adapter composing two
 * pieces that already own their own logic: `loadOwnedFit` (`../fit/core.ts`)
 * for scan-id validation, ownership and the fit itself, and
 * `handleAnalysisRequest` (`./handler.ts`) for the rate limit → cache →
 * analyse pipeline. This layer only reads the body-size cap, parses and
 * validates `fitPreferencesSchema` (the SAME preferences the fit request
 * used, so the server analyses exactly the ranking the user is looking
 * at — `routes.ts`), resolves the caller's identity (signed-in user id +
 * anonymous session cookie for ownership, caller IP for the rate limit),
 * and maps the result to 200 / 400 / 404 / 413 / 429 / 500 — every response
 * carrying `cache-control: no-store`.
 *
 * Order: oversized body (413) → invalid preferences (400) → ownership via
 * `loadOwnedFit` (404, or an internal failure → 500) → rate limit + cache +
 * analyse via `handleAnalysisRequest` (429, or 200) → a final
 * `analysisResponseSchema` check on any 200 body before it is returned
 * (hard rule: a schema failure is a 500, never a malformed 200 — AGENTS.md
 * hard rule 2 is enforced upstream in `./analyse.ts`; this check is the
 * last line of defense for this HTTP layer specifically).
 *
 * The rate-limit key is the caller's IP (`resolveClientIp`, `./ip.ts`), not
 * the scan id — a caller cannot dodge the limit by rotating scan ids.
 */
export async function computeAnalysisForScan(
  request: Request,
  scanId: string,
  deps: AnalysisServiceDeps,
): Promise<Response> {
  let bodyText: string;
  try {
    bodyText = await readLimitedBody(request);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return json(413, { error: "Request body too large." });
    }
    throw error;
  }

  let payload: unknown;
  try {
    // An empty body means "no preferences" — the same thing `{}` means
    // (fitPreferencesSchema, contract header) — rather than a parse error.
    payload = bodyText.length > 0 ? JSON.parse(bodyText) : {};
  } catch {
    return json(400, { error: "Request body must be valid JSON." });
  }

  const parsedPrefs = fitPreferencesSchema.safeParse(payload);
  if (!parsedPrefs.success) {
    return json(400, {
      error: "Invalid fit preferences.",
      issues: parsedPrefs.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const userId = await deps.getUserId();
  const cookieSessionId = readSessionCookie(request.headers.get("cookie"));

  let fitResult: LoadOwnedFitResult;
  try {
    fitResult = await loadOwnedFit(
      scanId,
      { userId, cookieSessionId },
      parsedPrefs.data,
      { scanRepo: deps.scanRepo, fitRepo: deps.fitRepo, now: deps.now },
    );
  } catch {
    return json(500, { error: "Failed to compute fit results." });
  }

  if (fitResult.status === "not_found") {
    return json(404, { error: "Scan not found." });
  }

  const rateLimitKey = resolveClientIp(request.headers);

  const result = await handleAnalysisRequest(
    {
      scanId,
      fit: fitResult.fit,
      measurements: fitResult.measurements,
      rateLimitKey,
    },
    {
      client: deps.client,
      cache: deps.cache,
      limiter: deps.limiter,
      globalLimiter: deps.globalLimiter,
      now: deps.now,
    },
  );

  if (result.status === 200) {
    const validated = analysisResponseSchema.safeParse(result.body);
    if (!validated.success) {
      return json(500, { error: "Failed to generate analysis." });
    }
    return json(200, validated.data);
  }

  return json(result.status, result.body);
}
