import { fitPreferencesSchema } from "../../lib/contracts/fit";
import { UNKNOWN_IP_KEY, resolveClientIp } from "../analysis/ip";
import { BodyTooLargeError, readLimitedBody } from "../scans/body-limit";
import { readSessionCookie } from "../scans/cookies";
import type { RateLimiter } from "../scans/rate-limit-config";
import type { ScanRepo } from "../scans/repo";
import { loadOwnedFit, type LoadOwnedFitResult } from "./core";
import type { FitRepo } from "./repo";

/** Same role as `submit.ts`'s constant of the same name: a no-DB, always-
 * allow default so tests that don't care about rate limiting don't have to
 * inject one. The real route always injects the DB-backed limiter. */
const ALWAYS_ALLOW_LIMITER: RateLimiter = { allow: () => true };

// `no-store`: every response here carries personal hand-measurement data or
// a ranking derived from it (same finding as #24/M6).
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

export interface FitServiceDeps {
  scanRepo: ScanRepo;
  fitRepo: FitRepo;
  /** Resolves the signed-in caller's user id, or null. Wraps `auth()` in the
   * real route; tests inject a fake so no NextAuth machinery runs here. */
  getUserId: () => Promise<string | null>;
  /** Injectable clock; defaults to `new Date()`. */
  now?: () => Date;
  /** Per-IP fit limit (M2 hardening); defaults to an always-allow no-op —
   * see `ALWAYS_ALLOW_LIMITER` above. */
  limiter?: RateLimiter;
}

/**
 * `POST /api/scans/{scanId}/fit`. Thin HTTP adapter over `loadOwnedFit`
 * (`./core.ts`), which owns scan-id validation, the ownership check,
 * scoring and persistence. This layer only reads the body-size cap, parses
 * and validates `fitPreferencesSchema`, resolves the caller's identity, and
 * maps the core's result to 200 / 400 / 404 / 413 / 429 / 500 — every
 * response carrying `cache-control: no-store`.
 *
 * Order: oversized body (413) → invalid preferences (400) → per-IP rate
 * limit (429, M2 hardening) → the core (ownership 404, or an internal
 * failure → 500) → 200. Route handlers
 * (`src/app/api/scans/[scanId]/fit/route.ts`) call this with real repos;
 * tests call it with fakes — no real database or clock required.
 */
export async function computeFitForScan(
  request: Request,
  scanId: string,
  deps: FitServiceDeps,
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

  // Per-IP rate limit (M2 hardening). No usable IP (local dev) is never
  // limited — same carve-out as the scan-submission route.
  const clientIp = resolveClientIp(request.headers);
  if (clientIp !== UNKNOWN_IP_KEY) {
    const limiter = deps.limiter ?? ALWAYS_ALLOW_LIMITER;
    const allowed = await limiter.allow(clientIp);
    if (!allowed) {
      return json(429, { error: "Too many fit requests. Try again shortly." });
    }
  }

  const userId = await deps.getUserId();
  const cookieSessionId = readSessionCookie(request.headers.get("cookie"));

  let result: LoadOwnedFitResult;
  try {
    result = await loadOwnedFit(
      scanId,
      { userId, cookieSessionId },
      parsedPrefs.data,
      { scanRepo: deps.scanRepo, fitRepo: deps.fitRepo, now: deps.now },
    );
  } catch {
    return json(500, { error: "Failed to compute fit results." });
  }

  if (result.status === "not_found") {
    return json(404, { error: "Scan not found." });
  }

  return json(200, result.fit);
}
