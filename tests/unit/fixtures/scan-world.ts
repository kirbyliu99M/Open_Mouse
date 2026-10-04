/**
 * One interface over two stores for the scan-session tests: the in-memory
 * fake `ScanRepo` and the real `createDrizzleScanRepo` on PGlite (a real
 * Postgres with the repo's own migrations applied, so the CHECK and the
 * foreign keys are live). A test written against `ScanWorld` runs against
 * both, so the fake's session rules cannot quietly drift from the SQL's.
 *
 * `server-only` must be mocked by the importing test file
 * (`vi.mock("server-only", () => ({}))`); the real repos load lazily so the
 * mock is in place by then.
 */
import type { ScanRepo } from "../../../src/server/scans/repo";
import { createFakeRepo, type FakeSessionRow } from "./fake-scan-repo";
import { migratedDatabase } from "./pglite";

export type SessionState = FakeSessionRow;

export interface ScanWorld {
  readonly name: string;
  readonly repo: ScanRepo;
  addUser(id: string): Promise<void>;
  /** Inserts a session row exactly as given (a test's starting state). */
  addSession(row: SessionState): Promise<void>;
  getSession(id: string): Promise<SessionState | null>;
  sessionCount(): Promise<number>;
  /** The session a stored scan belongs to; null if the scan does not exist. */
  sessionOfScan(scanId: string): Promise<string | null>;
  scansInSession(sessionId: string): Promise<number>;
  /** The scan ids `/account` lists for this signed-in user. */
  accountScanIds(userId: string): Promise<string[]>;
  close(): Promise<void>;
}

export function createFakeWorld(): ScanWorld {
  const { repo, sessions, insertedScans } = createFakeRepo();
  return {
    name: "in-memory fake repo",
    repo,
    async addUser() {},
    async addSession(row) {
      sessions.set(row.id, { ...row });
    },
    async getSession(id) {
      const row = sessions.get(id);
      return row ? { ...row } : null;
    },
    async sessionCount() {
      return sessions.size;
    },
    async sessionOfScan(scanId) {
      return insertedScans.find((s) => s.scanId === scanId)?.sessionId ?? null;
    },
    async scansInSession(sessionId) {
      return insertedScans.filter((s) => s.sessionId === sessionId).length;
    },
    async accountScanIds(userId) {
      return insertedScans
        .filter((s) => sessions.get(s.sessionId)?.userId === userId)
        .map((s) => s.scanId);
    },
    async close() {},
  };
}

export async function createPgliteWorld(): Promise<ScanWorld> {
  const { createDrizzleScanRepo } =
    await import("../../../src/server/scans/drizzle-repo");
  const { createDrizzleAccountRepo } =
    await import("../../../src/server/account/drizzle-repo");
  type ScanDb = Parameters<typeof createDrizzleScanRepo>[0];

  const { pg, db } = await migratedDatabase();
  // PGlite's drizzle driver has no `db.batch` (neon-http's atomic multi-query
  // request). Run the batch's queries in order instead: these tests check
  // session rules against the real schema, not batch atomicity.
  const sequentialBatchDb = Object.assign(db, {
    batch: async (queries: PromiseLike<unknown>[]) => {
      const results: unknown[] = [];
      for (const query of queries) results.push(await query);
      return results;
    },
  }) as unknown as ScanDb;

  const count = async (sql: string, params: unknown[] = []) => {
    const { rows } = await pg.query<{ n: number }>(sql, params);
    return Number(rows[0]!.n);
  };

  return {
    name: "real repo on PGlite",
    repo: createDrizzleScanRepo(sequentialBatchDb),
    async addUser(id) {
      await pg.query(`INSERT INTO users (id) VALUES ($1)`, [id]);
    },
    async addSession(row) {
      await pg.query(
        `INSERT INTO scan_sessions (id, user_id, expires_at) VALUES ($1, $2, $3)`,
        [row.id, row.userId, row.expiresAt?.toISOString() ?? null],
      );
    },
    async getSession(id) {
      const { rows } = await pg.query<{
        id: string;
        user_id: string | null;
        expires_at: Date | null;
      }>(`SELECT id, user_id, expires_at FROM scan_sessions WHERE id = $1`, [
        id,
      ]);
      const row = rows[0];
      return row
        ? { id: row.id, userId: row.user_id, expiresAt: row.expires_at }
        : null;
    },
    sessionCount: () => count(`SELECT count(*)::int AS n FROM scan_sessions`),
    async sessionOfScan(scanId) {
      const { rows } = await pg.query<{ session_id: string }>(
        `SELECT session_id FROM scans WHERE id = $1`,
        [scanId],
      );
      return rows[0]?.session_id ?? null;
    },
    scansInSession: (sessionId) =>
      count(`SELECT count(*)::int AS n FROM scans WHERE session_id = $1`, [
        sessionId,
      ]),
    async accountScanIds(userId) {
      const listed =
        await createDrizzleAccountRepo(sequentialBatchDb).listScans(userId);
      return listed.map((s) => s.scanId);
    },
    close: () => pg.close(),
  };
}
