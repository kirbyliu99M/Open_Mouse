import { describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/neon-http";
import type { NeonQueryFunction } from "@neondatabase/serverless";

vi.mock("server-only", () => ({}));

import { createDrizzleScanRepo } from "../../src/server/scans/drizzle-repo";

type FakeDb = Parameters<typeof createDrizzleScanRepo>[0];
const SCAN = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-09-23T12:00:00Z");

function fixture(rows: unknown[]) {
  const query = vi.fn(async (statement: string) => {
    void statement;
    return { rows };
  });
  // `db.batch` hands the built statements to `transaction` (one request).
  const transaction = vi.fn(async (statements: unknown[]) =>
    statements.map(() => ({ rows })),
  );
  const client = Object.assign(query, { transaction });
  const db = drizzle(client as unknown as NeonQueryFunction<false, false>);
  return {
    repo: createDrizzleScanRepo(db as unknown as FakeDb),
    query,
    transaction,
  };
}

describe("createDrizzleScanRepo().deleteOwnedScan", () => {
  it("skips the database when no ownership credential exists", async () => {
    const { repo, query } = fixture([{ id: SCAN }]);
    expect(
      await repo.deleteOwnedScan(SCAN, {
        userId: null,
        cookieSessionId: null,
        now: NOW,
      }),
    ).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it("uses a single scan-row DELETE with signed-in or unexpired cookie ownership", async () => {
    const { repo, query, transaction } = fixture([{ id: SCAN }]);
    expect(
      await repo.deleteOwnedScan(SCAN, {
        userId: "owner",
        cookieSessionId: "session-1",
        now: NOW,
      }),
    ).toBe(true);
    // One batch (one request) of two statements: the DELETE of the scan's
    // anonymous copy, matched in SQL under the same ownership condition
    // (hand-sample-delete.ts), then the single scan-row DELETE.
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
    const copy = String(query.mock.calls[0][0]).toLowerCase();
    expect(copy).toContain('delete from "hand_samples"');
    expect(copy).toContain("scan_sessions");
    expect(copy).toContain("user_id");
    expect(copy).toContain("expires_at");
    const statement = String(query.mock.calls[1][0]).toLowerCase();
    expect(statement).toMatch(/^delete from "scans"/);
    expect(statement).toContain("scan_sessions");
    expect(statement).toContain("user_id");
    expect(statement).toContain("expires_at");
    expect(statement).toContain("returning");
    expect(statement).not.toContain("delete from " + '"scan_sessions"');
  });

  // SQL-shape checks: there is no database in CI, so these assert the
  // generated WHERE clause, not database behaviour. The behaviour (a stale
  // cookie on a claimed session could delete the account's scan) was
  // reproduced on real Postgres in the #45 review.
  const COOKIE_BRANCH =
    /"scan_sessions"\."id" = \$\d+ and "scan_sessions"\."user_id" is null and "scan_sessions"\."expires_at" > \$\d+/;

  it("generates a cookie branch that requires an unclaimed, unexpired session for delete", async () => {
    const { repo, query } = fixture([]);
    await repo.deleteOwnedScan(SCAN, {
      userId: null,
      cookieSessionId: "session-1",
      now: NOW,
    });
    const statement = String(query.mock.calls[0][0]).toLowerCase();
    expect(statement).toMatch(COOKIE_BRANCH);
    expect(statement).not.toContain('"expires_at" is null');
  });

  it("generates the same cookie branch for find, so read and delete agree", async () => {
    const { repo, query } = fixture([]);
    await repo.findOwnedScan(SCAN, {
      userId: null,
      cookieSessionId: "session-1",
      now: NOW,
    });
    const statement = String(query.mock.calls[0][0]).toLowerCase();
    expect(statement).toMatch(COOKIE_BRANCH);
    expect(statement).not.toContain('"expires_at" is null');
  });

  it("reports false when no row was deleted", async () => {
    const { repo } = fixture([]);
    expect(
      await repo.deleteOwnedScan(SCAN, {
        userId: null,
        cookieSessionId: "session-1",
        now: NOW,
      }),
    ).toBe(false);
  });
});
