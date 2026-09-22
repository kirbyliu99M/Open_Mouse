/**
 * Which `scan_sessions` rows the hourly cron (`GET /api/cron/expire-sessions`)
 * removes. Pure predicate so the rule is unit-tested without a database;
 * `drizzle-repo.ts` builds a SQL WHERE clause that mirrors it exactly.
 */

export interface SessionRow {
  id: string;
  userId: string | null;
  expiresAt: Date | null;
}

/**
 * A signed-in session (`userId` set) never expires here — that's M6.
 * An anonymous session with no `expiresAt` is malformed (the DB CHECK
 * constraint should prevent it) and is left alone rather than guessed at.
 */
export function isExpiredAnonymousSession(row: SessionRow, now: Date): boolean {
  return (
    row.userId === null &&
    row.expiresAt !== null &&
    row.expiresAt.getTime() <= now.getTime()
  );
}

export function selectExpiredAnonymousSessionIds(
  rows: readonly SessionRow[],
  now: Date,
): string[] {
  return rows
    .filter((row) => isExpiredAnonymousSession(row, now))
    .map((row) => row.id);
}
