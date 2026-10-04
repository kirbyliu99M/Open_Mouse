/**
 * In-memory `ScanRepo` fake for the scan-API handler tests. No real database:
 * every handler test injects this instead of `drizzle-repo.ts`.
 *
 * Its session rules mirror `drizzle-repo.ts` exactly (issue #52) — see
 * `findValidSession` and `claimSession` there — and
 * `scan-session-ownership.test.ts` runs the same behaviour matrix against this
 * fake and against the real repo on PGlite, so the two cannot drift apart
 * without a test failing.
 */
import { vi } from "vitest";
import type {
  ScanInsertInput,
  ScanRepo,
  SessionRecord,
  UsableSession,
} from "../../../src/server/scans/repo";

export interface FakeSessionRow {
  id: string;
  userId: string | null;
  expiresAt: Date | null;
}

export function createFakeRepo() {
  const sessions = new Map<string, FakeSessionRow>();
  const insertedScans: ({ scanId: string } & ScanInsertInput)[] = [];
  let counter = 0;

  const isAnonymousAndLive = (row: FakeSessionRow, now: Date) =>
    row.userId === null &&
    row.expiresAt !== null &&
    row.expiresAt.getTime() > now.getTime();

  const repo: ScanRepo = {
    findValidSession: vi.fn(
      async (
        sessionId: string,
        userId: string | null,
        now: Date,
      ): Promise<UsableSession | null> => {
        const row = sessions.get(sessionId);
        if (!row) return null;
        const usable =
          isAnonymousAndLive(row, now) ||
          (userId !== null && row.userId === userId);
        return usable ? { id: row.id, userId: row.userId } : null;
      },
    ),
    createAnonymousSession: vi.fn(
      async (expiresAt: Date): Promise<SessionRecord> => {
        const id = `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
        sessions.set(id, { id, userId: null, expiresAt });
        return { id };
      },
    ),
    createClaimedSession: vi.fn(
      async (userId: string): Promise<SessionRecord> => {
        const id = `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
        sessions.set(id, { id, userId, expiresAt: null });
        return { id };
      },
    ),
    insertScanWithMeasurements: vi.fn(async (input: ScanInsertInput) => {
      const scanId = `scan-${++counter}`;
      insertedScans.push({ scanId, ...input });
      return { scanId };
    }),
    deleteSession: vi.fn(async (sessionId: string) => {
      // Mirrors drizzle-repo.ts's own guard: never deletes a session a
      // signed-in user has claimed.
      const row = sessions.get(sessionId);
      if (!row || row.userId !== null) return;
      sessions.delete(sessionId);
    }),
    deleteExpiredAnonymousSessions: vi.fn(async (now: Date) => {
      let removed = 0;
      for (const [id, row] of sessions) {
        if (
          row.userId === null &&
          row.expiresAt &&
          row.expiresAt.getTime() <= now.getTime()
        ) {
          sessions.delete(id);
          removed++;
        }
      }
      return removed;
    }),
    // Not exercised here — covered against a real Postgres in
    // tests/unit/rate-limit-db.test.ts (L2 hardening).
    deleteEndedRateLimitWindows: vi.fn(async () => 0),
    claimSession: vi.fn(
      async (sessionId: string, userId: string, now: Date) => {
        const row = sessions.get(sessionId);
        if (!row) return;
        if (row.userId !== null) return;
        if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return;
        sessions.set(sessionId, { ...row, userId, expiresAt: null });
      },
    ),
    // Not exercised by the scan-submission/session/expiry tests — covered on
    // its own in tests/unit/fit-service.test.ts and
    // tests/unit/scan-ownership.test.ts. Kept here only so this fake keeps
    // satisfying ScanRepo's shape.
    findOwnedScan: vi.fn(async () => null),
    deleteOwnedScan: vi.fn(async () => false),
  };
  return { repo, sessions, insertedScans };
}
