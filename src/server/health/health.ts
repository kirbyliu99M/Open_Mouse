/**
 * `GET /api/health`: is the deployed build up, which commit is it, and can it
 * reach its database. Written as a pure handler with injected dependencies
 * (like `src/server/scans/submit.ts`) so the timeout, the failure paths and
 * the "nothing secret in the response" rule are tested without a network.
 *
 * The response is exactly `{ status, version, db }`:
 *
 *  - `version` is the first 7 characters of `VERCEL_GIT_COMMIT_SHA`, or
 *    `"dev"` when it is unset or is not a commit hash. A commit hash is public
 *    in the repository; nothing else from the environment is ever read.
 *  - `db` is `"ok"` when `select 1` returned within `HEALTH_DB_TIMEOUT_MS`,
 *    otherwise `"unavailable"`. Why it failed (a timeout, a bad URL, a
 *    refused connection) is never put in the response: driver errors quote
 *    hostnames and parts of the connection string. The reason class
 *    (`timeout` | `error`) goes to the server log only.
 *  - 200 when the database is fine, 503 otherwise; always `no-store`, so a
 *    CDN or browser can not report a stale "ok".
 *
 * Abuse: each call spends a Neon round trip, so the route is rate limited per
 * caller with the same DB-backed limiter the other routes use (a shared
 * `rate_limits` row per hashed IP, never the address itself; see
 * `src/server/analysis/drizzle-rate-limiter.ts`), 30 calls a minute. That is
 * generous for an uptime monitor (one call a minute) and stops a loop from
 * running up the database's compute. Two consequences are handled on
 * purpose:
 *
 *  - The limiter lives in the same database this route reports on. When the
 *    database is down the limiter fails too, and a health check that goes
 *    silent exactly when it is needed is worse than an unlimited one, so a
 *    limiter that throws or takes longer than `HEALTH_LIMITER_TIMEOUT_MS`
 *    fails OPEN (the request proceeds to the database check, which then
 *    reports `unavailable`). The incident is logged.
 *  - A request with no usable client IP (local development) is not limited,
 *    the same carve-out as `POST /api/scans`.
 */
import { resolveClientIp, UNKNOWN_IP_KEY } from "../analysis/ip";
import { LOG_ROUTES, log } from "../log";

export const HEALTH_DB_TIMEOUT_MS = 2000;
export const HEALTH_LIMITER_TIMEOUT_MS = 1000;
export const HEALTH_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const HEALTH_RATE_LIMIT_MAX = 30;

export interface HealthBody {
  status: "ok" | "degraded";
  version: string;
  db: "ok" | "unavailable";
}

export interface HealthLimiter {
  allow(key: string): boolean | Promise<boolean>;
}

export interface HealthDeps {
  /** Resolves when `select 1` succeeded; may reject or never settle. */
  checkDb: () => Promise<unknown>;
  /**
   * Builds the limiter on demand: constructing the real one needs the
   * database, which may be the very thing that is broken. Omit for no limit.
   */
  createLimiter?: () => HealthLimiter;
  /** Only `VERCEL_GIT_COMMIT_SHA` is ever read, and only its first 7 characters used. */
  env: { VERCEL_GIT_COMMIT_SHA?: string | undefined };
  dbTimeoutMs?: number;
  limiterTimeoutMs?: number;
  /** Injectable clock for the logged duration. */
  now?: () => number;
}

class TimeoutError extends Error {
  constructor() {
    super("timeout");
    this.name = "TimeoutError";
  }
}

/** Rejects with `TimeoutError` after `ms`; never leaves a timer or an unhandled rejection behind. */
async function withTimeout<T>(
  start: () => Promise<T> | T,
  ms: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = Promise.resolve().then(start);
  // If the timeout wins, the work may still reject later: that must not
  // surface as an unhandled rejection.
  work.catch(() => {});
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new TimeoutError()), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** First 7 characters of a git commit hash; `"dev"` for anything else. */
export function resolveVersion(sha: string | undefined | null): string {
  const value = sha?.trim() ?? "";
  return /^[0-9a-f]{7,64}$/i.test(value)
    ? value.slice(0, 7).toLowerCase()
    : "dev";
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function handleHealth(
  request: Request,
  deps: HealthDeps,
): Promise<Response> {
  const now = deps.now ?? (() => Date.now());
  const startedAt = now();
  const dbTimeoutMs = deps.dbTimeoutMs ?? HEALTH_DB_TIMEOUT_MS;
  const limiterTimeoutMs = deps.limiterTimeoutMs ?? HEALTH_LIMITER_TIMEOUT_MS;

  const clientIp = resolveClientIp(request.headers);
  if (deps.createLimiter && clientIp !== UNKNOWN_IP_KEY) {
    try {
      const limiter = deps.createLimiter();
      const allowed = await withTimeout(
        () => limiter.allow(clientIp),
        limiterTimeoutMs,
      );
      if (!allowed) {
        return json(429, { error: "Too many requests. Try again shortly." });
      }
    } catch (error) {
      // Fail open, see the header comment. The class name only, never the message.
      log.warn("health.rate_limiter_unavailable", {
        route: LOG_ROUTES.health,
        ms: now() - startedAt,
        reason: error instanceof TimeoutError ? "timeout" : "error",
        action: "proceed_without_limit",
      });
    }
  }

  const version = resolveVersion(deps.env.VERCEL_GIT_COMMIT_SHA);
  const dbStartedAt = now();
  try {
    await withTimeout(deps.checkDb, dbTimeoutMs);
  } catch (error) {
    log.warn("health.db_unavailable", {
      route: LOG_ROUTES.health,
      ms: now() - dbStartedAt,
      reason: error instanceof TimeoutError ? "timeout" : "error",
    });
    const body: HealthBody = { status: "degraded", version, db: "unavailable" };
    return json(503, body);
  }
  const body: HealthBody = { status: "ok", version, db: "ok" };
  return json(200, body);
}
