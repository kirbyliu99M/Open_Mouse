import { isCronAuthorized } from "../cron/auth";
import { log, shortHash } from "../log";
import { INACTIVE_WINDOW_DAYS, type PurgeRepo } from "./purge";

/**
 * `GET /api/cron/purge-inactive` (candidate, spec 2026-10-11, section 3.4).
 * Deletes accounts that have not been used for 90 days, with everything they
 * own. Switched by `RETENTION_PURGE_MODE`: `off` | `dry-run` | `delete`.
 *
 * Safety properties, each with a test:
 *  - no `CRON_SECRET` configured, or a wrong or missing bearer: 401, and the
 *    repo is never called;
 *  - a missing or unknown mode is `off`; `off` touches nothing;
 *  - `?dryRun=1` forces `dry-run` whatever the variable says; no query value
 *    can force `delete`;
 *  - per run at most `MAX_ACCOUNTS_PER_RUN` accounts, in chunks of
 *    `CHUNK_SIZE` per DELETE statement, and no new chunk starts after
 *    `TIME_BUDGET_MS`;
 *  - the response and the log line carry counts only; a sample id is the first
 *    8 hex characters of its SHA-256, never an email, a name or a full id;
 *  - a failure is a 500 that names only the error's class.
 */

export const MAX_ACCOUNTS_PER_RUN = 200;
export const CHUNK_SIZE = 25;
export const TIME_BUDGET_MS = 20_000;
/** How many hashed ids a dry-run shows. */
export const DRY_RUN_SAMPLE_SIZE = 20;
export const PURGE_ROUTE = "/api/cron/purge-inactive";

export type PurgeMode = "off" | "dry-run" | "delete";

/**
 * The mode for one request. The environment value must be exactly `dry-run` or
 * `delete`; anything else (unset, empty, a typo, another case) is `off`, the
 * safe side. A `dryRun=1` query can only lower the mode to `dry-run`; no query
 * value ever produces `delete`.
 */
export function resolvePurgeMode(
  envValue: string | undefined,
  query: URLSearchParams,
): PurgeMode {
  if (query.get("dryRun") === "1") return "dry-run";
  if (envValue === "delete") return "delete";
  if (envValue === "dry-run") return "dry-run";
  return "off";
}

export interface PurgeStats {
  mode: PurgeMode;
  candidates: number;
  usersDeleted: number;
  scansDeleted: number;
  chunks: number;
  remaining: boolean;
}

export interface PurgeLimits {
  maxAccounts: number;
  chunkSize: number;
  budgetMs: number;
  windowDays: number;
}

export const DEFAULT_LIMITS: PurgeLimits = {
  maxAccounts: MAX_ACCOUNTS_PER_RUN,
  chunkSize: CHUNK_SIZE,
  budgetMs: TIME_BUDGET_MS,
  windowDays: INACTIVE_WINDOW_DAYS,
};

export interface PurgeCronDeps {
  repo: PurgeRepo;
  /** `undefined` (unset env var) always fails the check: never open by default. */
  cronSecret: string | undefined;
  /** `process.env.RETENTION_PURGE_MODE`. */
  modeEnv: string | undefined;
  /** Milliseconds, for the time budget and the log's `ms`. */
  nowMs?: () => number;
  limits?: PurgeLimits;
  logger?: Pick<typeof log, "info" | "error">;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** An error reduced to its class name; its message may hold anything. */
function errorClass(error: unknown): string {
  if (error instanceof Error && /^[A-Za-z0-9_]{1,60}$/.test(error.name)) {
    return error.name;
  }
  return "Error";
}

/**
 * The counts as log fields. The log's redaction treats a field named
 * `candidates` as model output (Gemini's response candidates) and replaces its
 * value, so the log calls the same number `eligible`; the response keeps
 * `candidates`.
 */
function logCounts(stats: PurgeStats) {
  const { candidates, ...rest } = stats;
  return { ...rest, eligible: candidates };
}

async function dryRun(
  repo: PurgeRepo,
  limits: PurgeLimits,
  stats: PurgeStats,
): Promise<{ sample: string[]; scansInRun: number }> {
  stats.candidates = await repo.countInactiveUsers(limits.windowDays);
  const ids = await repo.selectInactiveUserIds(
    limits.windowDays,
    Math.min(limits.maxAccounts, Math.max(stats.candidates, 1)),
  );
  stats.remaining = stats.candidates > limits.maxAccounts;
  const scansInRun = await repo.countScansOfUsers(ids);
  return {
    sample: ids.slice(0, DRY_RUN_SAMPLE_SIZE).map(shortHash),
    scansInRun,
  };
}

async function deleteRun(
  repo: PurgeRepo,
  limits: PurgeLimits,
  stats: PurgeStats,
  nowMs: () => number,
  startMs: number,
): Promise<void> {
  let processed = 0;
  // True only when a SELECT found nothing more to take.
  let exhausted = false;
  while (processed < limits.maxAccounts) {
    // No new chunk after the time budget: a chunk already running finishes.
    if (nowMs() - startMs >= limits.budgetMs) break;
    const take = Math.min(limits.chunkSize, limits.maxAccounts - processed);
    const ids = await repo.selectInactiveUserIds(limits.windowDays, take);
    if (ids.length === 0) {
      exhausted = true;
      break;
    }
    stats.candidates += ids.length;
    const scansBefore = await repo.countScansOfUsers(ids);
    // One statement; the eligibility is repeated inside it (the guard).
    const deleted = await repo.deleteUserAccounts(ids, {
      windowDays: limits.windowDays,
    });
    stats.chunks += 1;
    stats.usersDeleted += deleted.length;
    // Counted before the delete, for the log only; it can differ from what the
    // statement removed if an account was skipped by the guard.
    if (deleted.length > 0) stats.scansDeleted += scansBefore;
    processed += ids.length;
    // Nothing deleted although something was selected: the guard disagreed with
    // the select. Stop instead of selecting the same ids again.
    if (deleted.length === 0) break;
  }
  // `remaining: false` only when a SELECT found no more candidates. Every other
  // way out of the loop (cap, time budget, a chunk the guard blocked) asks the
  // database once more, so a blocked chunk cannot hide other eligible accounts.
  if (!exhausted) {
    const more = await repo.selectInactiveUserIds(limits.windowDays, 1);
    stats.remaining = more.length > 0;
  }
}

export async function handlePurgeInactive(
  request: Request,
  deps: PurgeCronDeps,
): Promise<Response> {
  if (
    !isCronAuthorized(request.headers.get("authorization"), deps.cronSecret)
  ) {
    return json(401, { error: "Unauthorized" });
  }
  const logger = deps.logger ?? log;
  const nowMs = deps.nowMs ?? Date.now;
  const limits = deps.limits ?? DEFAULT_LIMITS;
  const mode = resolvePurgeMode(
    deps.modeEnv,
    new URL(request.url).searchParams,
  );
  if (mode === "off") return json(200, { mode: "off" });

  const startMs = nowMs();
  const stats: PurgeStats = {
    mode,
    candidates: 0,
    usersDeleted: 0,
    scansDeleted: 0,
    chunks: 0,
    remaining: false,
  };
  try {
    if (mode === "dry-run") {
      const { sample, scansInRun } = await dryRun(deps.repo, limits, stats);
      const ms = nowMs() - startMs;
      logger.info("retention.purge", {
        route: PURGE_ROUTE,
        ms,
        ...logCounts(stats),
      });
      return json(200, {
        mode,
        candidates: stats.candidates,
        scansInRun,
        remaining: stats.remaining,
        sample,
        ms,
      });
    }
    await deleteRun(deps.repo, limits, stats, nowMs, startMs);
    const ms = nowMs() - startMs;
    logger.info("retention.purge", {
      route: PURGE_ROUTE,
      ms,
      ...logCounts(stats),
    });
    return json(200, {
      mode,
      candidates: stats.candidates,
      usersDeleted: stats.usersDeleted,
      scansDeleted: stats.scansDeleted,
      chunks: stats.chunks,
      remaining: stats.remaining,
      ms,
    });
  } catch (error) {
    // The counts so far go to the log; the response names only the class.
    logger.error("retention.purge_failed", {
      route: PURGE_ROUTE,
      ms: nowMs() - startMs,
      errorClass: errorClass(error),
      ...logCounts(stats),
    });
    return json(500, { error: errorClass(error) });
  }
}
