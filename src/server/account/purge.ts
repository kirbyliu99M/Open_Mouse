import type { SQL } from "drizzle-orm";
import { and, inArray, sql } from "drizzle-orm";
import type { getDb } from "../../db/client";
import { authSessions, scanSessions, scans, users } from "../../db/schema";

/**
 * Inactive-account purge (candidate, spec 2026-10-11; decisions confirmed
 * 2026-10-12). One module, one copy of the delete SQL.
 *
 * Eligibility, stated once and evaluated by the DATABASE in every query below:
 *
 *   users.last_active_at < now() - W days                       (strictly older)
 *   AND no auth_sessions row of the user with expires > now()    (safety net 1)
 *   AND no scans row, under any of the user's scan_sessions, with
 *       created_at >= now() - W days                             (safety net 2)
 *
 * The clock is the database's (`now()`), never a timestamp the application
 * passes in: an app server running ahead of the database would otherwise
 * delete accounts early. A `last_active_at` in the future is never eligible
 * (it is not `< now() - W days`). Rows with `user_id IS NULL` (anonymous
 * sessions) cannot match: every statement here starts from `users`.
 *
 * The delete is ONE statement per chunk (`DELETE FROM users ... RETURNING id`).
 * Every user-owned table cascades from `users`, so Postgres applies the delete
 * and all cascades atomically; the neon-http driver has no interactive
 * transaction, and none is needed. The eligibility predicate is repeated in
 * that same statement (the guard), so an account that became active between the
 * SELECT and the DELETE is skipped.
 */

/** The window the cron uses. Fixed in code, not configurable by environment. */
export const INACTIVE_WINDOW_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The database handle the purge runs on (neon-http in production, PGlite in tests). */
export type PurgeDb = ReturnType<typeof getDb>;

export interface InactiveAccountRow {
  /** `users.last_active_at`. Null or invalid never counts as inactive. */
  lastActiveAt: Date | null;
  /** Newest `scans.created_at` under any of the user's scan sessions. */
  latestScanAt?: Date | null;
  /** Latest `auth_sessions.expires` of the user. */
  latestSessionExpiresAt?: Date | null;
}

/**
 * The eligibility rule as a pure function, mirroring the SQL in `eligibleSql`
 * (the same split as `isExpiredAnonymousSession` and its SQL). `now` is an
 * argument only so tests can exercise the boundaries; the purge itself never
 * passes an application clock to the database.
 *
 * Strictly older: exactly `windowMs` is not eligible, one millisecond more is.
 */
export function isInactiveAccount(
  row: InactiveAccountRow,
  now: Date,
  windowMs: number,
): boolean {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(windowMs) || windowMs <= 0) {
    return false;
  }
  const last = row.lastActiveAt?.getTime();
  if (last === undefined || !Number.isFinite(last)) return false;
  // `last < now - window`; a future `last` fails this naturally.
  if (!(last < nowMs - windowMs)) return false;
  // Safety net 2: a scan created within the window (or in the future) blocks.
  const scan = row.latestScanAt?.getTime();
  if (scan !== undefined && Number.isFinite(scan) && scan >= nowMs - windowMs) {
    return false;
  }
  // Safety net 1: a session that has not expired yet blocks.
  const sessionEnds = row.latestSessionExpiresAt?.getTime();
  if (
    sessionEnds !== undefined &&
    Number.isFinite(sessionEnds) &&
    sessionEnds > nowMs
  ) {
    return false;
  }
  return true;
}

export const windowMsOf = (windowDays: number): number => windowDays * DAY_MS;

function assertWindowDays(windowDays: number): void {
  // A window of 0 (or a non-integer, NaN, negative) would make every account
  // eligible: refuse rather than guess.
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 3650) {
    throw new RangeError("windowDays must be an integer from 1 to 3650");
  }
}

function assertCount(value: number, name: string, max: number): void {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new RangeError(`${name} must be an integer from 1 to ${max}`);
  }
}

/**
 * The eligibility predicate over `users`, every comparison on the database
 * clock. Column references render qualified (`"users"."id"`), so the
 * correlated subqueries can never bind to their own table by accident.
 */
function eligibleSql(windowDays: number): SQL {
  assertWindowDays(windowDays);
  // Hours, not days: `timestamptz - interval 'N days'` is calendar arithmetic in
  // the session's TimeZone, so across a DST change 90 days would be 2159 or 2161
  // hours. The spec wants a day to be exactly 24 hours, whatever the session zone.
  const window = sql`make_interval(hours => ${windowDays * 24}::int)`;
  return sql`(
    ${users.lastActiveAt} < now() - ${window}
    AND NOT EXISTS (
      SELECT 1 FROM ${authSessions}
      WHERE ${authSessions.userId} = ${users.id}
        AND ${authSessions.expires} > now()
    )
    AND NOT EXISTS (
      SELECT 1 FROM ${scanSessions}
      INNER JOIN ${scans} ON ${scans.sessionId} = ${scanSessions.id}
      WHERE ${scanSessions.userId} = ${users.id}
        AND ${scans.createdAt} >= now() - ${window}
    )
  )`;
}

export interface PurgeGuard {
  /** Repeats the eligibility predicate in the DELETE itself. */
  windowDays: number;
}

/**
 * Deletes the given users, and by cascade everything they own, in one
 * statement. With `guard` the eligibility predicate is repeated in that
 * statement, so an account that became active since it was selected is
 * skipped. Without `guard` it deletes exactly the ids given (the caller has
 * already decided); the cron always passes a guard.
 *
 * Returns the ids that were actually deleted (`RETURNING id`).
 */
export async function deleteUserAccounts(
  db: PurgeDb,
  userIds: readonly string[],
  guard?: PurgeGuard,
): Promise<string[]> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return [];
  const condition = guard
    ? and(inArray(users.id, ids), eligibleSql(guard.windowDays))
    : inArray(users.id, ids);
  const deleted = await db
    .delete(users)
    .where(condition)
    .returning({ id: users.id });
  return deleted.map((row) => row.id);
}

/**
 * The oldest eligible accounts, oldest first, at most `limit`. A read: no side
 * effect. The interval is built in SQL from `windowDays`.
 */
export async function selectInactiveUserIds(
  db: PurgeDb,
  windowDays: number,
  limit: number,
): Promise<string[]> {
  assertCount(limit, "limit", 1000);
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eligibleSql(windowDays))
    .orderBy(users.lastActiveAt, users.id)
    .limit(limit);
  return rows.map((row) => row.id);
}

/** How many accounts are eligible right now (the dry-run's headline number). */
export async function countInactiveUsers(
  db: PurgeDb,
  windowDays: number,
): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(eligibleSql(windowDays));
  return Number(rows[0]?.n ?? 0);
}

/** Scans under the given users' scan sessions (for the log and dry-run only). */
export async function countScansOfUsers(
  db: PurgeDb,
  userIds: readonly string[],
): Promise<number> {
  if (userIds.length === 0) return 0;
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(scans)
    .innerJoin(scanSessions, sql`${scans.sessionId} = ${scanSessions.id}`)
    .where(inArray(scanSessions.userId, [...userIds]));
  return Number(rows[0]?.n ?? 0);
}

/** What the cron run needs from the database; the handler is tested on a fake. */
export interface PurgeRepo {
  selectInactiveUserIds(windowDays: number, limit: number): Promise<string[]>;
  countInactiveUsers(windowDays: number): Promise<number>;
  countScansOfUsers(userIds: readonly string[]): Promise<number>;
  deleteUserAccounts(
    userIds: readonly string[],
    guard: PurgeGuard,
  ): Promise<string[]>;
}

/**
 * `db` may be a factory: the route passes `getDb`, so nothing touches the
 * database (or needs `DATABASE_URL`) before the bearer check and the mode have
 * let a request through.
 */
export function createDrizzlePurgeRepo(
  db: PurgeDb | (() => PurgeDb),
): PurgeRepo {
  const handle = () => (typeof db === "function" ? db() : db);
  return {
    selectInactiveUserIds: (windowDays, limit) =>
      selectInactiveUserIds(handle(), windowDays, limit),
    countInactiveUsers: (windowDays) =>
      countInactiveUsers(handle(), windowDays),
    countScansOfUsers: (userIds) => countScansOfUsers(handle(), userIds),
    deleteUserAccounts: (userIds, guard) =>
      deleteUserAccounts(handle(), userIds, guard),
  };
}
