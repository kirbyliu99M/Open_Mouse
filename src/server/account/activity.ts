import { and, eq, sql } from "drizzle-orm";
import type { getDb } from "../../db/client";
import { users } from "../../db/schema";
import { log } from "../log";

/**
 * Keeps `users.last_active_at` current (candidate, inactive-retention spec
 * 2026-10-11, section 3.2, rule P2): written on sign-in, and at most once per
 * 24 hours whenever a signed-in request reads its session. Every value is the
 * DATABASE's `now()`, never an application timestamp.
 *
 * A failed write must never break a sign-in or a session read, so both entry
 * points swallow errors (and log only the error's class name). The cost of a
 * missed write is a skipped purge, not a wrong one: the purge also checks that
 * the person has no recent scan and no unexpired session.
 */

export const ACTIVITY_THROTTLE_MS = 24 * 60 * 60 * 1000;

type ActivityDb = Pick<ReturnType<typeof getDb>, "update">;
export type ActivityDbSource = ActivityDb | (() => ActivityDb);
type DbSource = ActivityDbSource;

const resolve = (db: DbSource): ActivityDb =>
  typeof db === "function" ? db() : db;

/**
 * Whether the value the adapter returned is old enough to be worth a write:
 * strictly more than `throttleMs` before `now`. Anything that is not a valid
 * Date (a missing field, a string) counts as stale, so a surprise in the row's
 * shape errs toward recording activity, never toward missing it.
 */
export function isActivityStale(
  lastActiveAt: unknown,
  now: Date,
  throttleMs: number = ACTIVITY_THROTTLE_MS,
): boolean {
  if (!(lastActiveAt instanceof Date)) return true;
  const last = lastActiveAt.getTime();
  if (!Number.isFinite(last)) return true;
  return now.getTime() - last > throttleMs;
}

function errorClass(error: unknown): string {
  return error instanceof Error && /^[A-Za-z0-9_]{1,60}$/.test(error.name)
    ? error.name
    : "Error";
}

/** `events.signIn`: one UPDATE, no throttle. Never throws. */
export async function recordSignIn(
  db: DbSource,
  userId: string | null | undefined,
): Promise<void> {
  if (!userId) return;
  try {
    await resolve(db)
      .update(users)
      .set({ lastActiveAt: sql`now()` })
      .where(eq(users.id, userId));
  } catch (error) {
    log.warn("auth.last_active_write_failed", {
      op: "sign_in",
      errorClass: errorClass(error),
    });
  }
}

/**
 * The `session` callback: when the row the adapter handed over says the last
 * write was more than 24 hours ago, run the UPDATE, with the 24-hour condition
 * repeated in SQL so several simultaneous requests cost at most a few
 * redundant writes. Never throws.
 */
export async function recordSessionActivity(
  db: DbSource,
  user: { id?: string | null; lastActiveAt?: unknown } | null | undefined,
  now: Date = new Date(),
): Promise<void> {
  if (!user?.id) return;
  if (!isActivityStale(user.lastActiveAt, now)) return;
  try {
    await resolve(db)
      .update(users)
      .set({ lastActiveAt: sql`now()` })
      .where(
        and(
          eq(users.id, user.id),
          sql`${users.lastActiveAt} < now() - make_interval(secs => ${ACTIVITY_THROTTLE_MS / 1000})`,
        ),
      );
  } catch (error) {
    log.warn("auth.last_active_write_failed", {
      op: "session",
      errorClass: errorClass(error),
    });
  }
}
