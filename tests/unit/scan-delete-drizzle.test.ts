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
  const db = drizzle(query as unknown as NeonQueryFunction<false, false>);
  return { repo: createDrizzleScanRepo(db as unknown as FakeDb), query };
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
    const { repo, query } = fixture([{ id: SCAN }]);
    expect(
      await repo.deleteOwnedScan(SCAN, {
        userId: "owner",
        cookieSessionId: "session-1",
        now: NOW,
      }),
    ).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    const statement = String(query.mock.calls[0][0]).toLowerCase();
    expect(statement).toMatch(/^delete from "scans"/);
    expect(statement).toContain("scan_sessions");
    expect(statement).toContain("user_id");
    expect(statement).toContain("expires_at");
    expect(statement).toContain("returning");
    expect(statement).not.toContain("delete from " + '"scan_sessions"');
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
