import { describe, expect, it, vi } from "vitest";
import { SCAN_SESSION_COOKIE } from "../../src/server/scans/cookies";
import {
  claimAnonymousSession,
  deriveClaimSessionId,
} from "../../src/server/auth/claim";

/**
 * Claiming (issue #17): "Claiming an anonymous session must be impossible
 * for a session that isn't the caller's cookie." These tests prove it two
 * ways: (1) the function that decides *which* session id to claim reads
 * only the httpOnly Cookie header, never a client-supplied field such as a
 * JSON body or query string, even when one is present and names a
 * different, real session; and (2) the repo-level guard (mirrored here by
 * an in-memory fake, matching `drizzle-repo.ts`'s single UPDATE ... WHERE)
 * never reassigns a session that already belongs to someone else, and never
 * claims one that has already expired.
 */

describe("deriveClaimSessionId — session id comes only from the cookie", () => {
  it("reads the session id from the Cookie header", () => {
    const request = new Request("http://localhost/api/auth/callback/google", {
      headers: { cookie: `${SCAN_SESSION_COOKIE}=my-session` },
    });
    expect(deriveClaimSessionId(request)).toBe("my-session");
  });

  it("ignores a spoofed session id carried anywhere but the cookie", () => {
    // An attacker who doesn't hold victim-session's cookie tries to name it
    // via a body field, a query string, and a custom header instead.
    const request = new Request(
      "http://localhost/api/auth/callback/google?sessionId=victim-session",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-session-id": "victim-session",
          cookie: `${SCAN_SESSION_COOKIE}=attacker-own-session`,
        },
        body: JSON.stringify({ sessionId: "victim-session" }),
      },
    );
    expect(deriveClaimSessionId(request)).toBe("attacker-own-session");
    expect(deriveClaimSessionId(request)).not.toBe("victim-session");
  });

  it("is null with no cookie at all, never falling back to another field", () => {
    const request = new Request(
      "http://localhost/api/auth/callback/google?sessionId=victim-session",
      { headers: { "x-session-id": "victim-session" } },
    );
    expect(deriveClaimSessionId(request)).toBeNull();
  });
});

interface FakeRow {
  id: string;
  userId: string | null;
  expiresAt: Date | null;
}

function fakeClaimRepo(rows: FakeRow[]) {
  const table = new Map(rows.map((r) => [r.id, { ...r }]));
  const claimSession = vi.fn(
    async (sessionId: string, userId: string, now: Date) => {
      const row = table.get(sessionId);
      if (!row) return; // unknown id — no-op, never creates a row
      if (row.userId !== null) return; // already claimed — never reassigned
      if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return; // expired means gone
      table.set(sessionId, { ...row, userId, expiresAt: null });
    },
  );
  return { repo: { claimSession }, table };
}

describe("claimAnonymousSession", () => {
  it("does nothing when there is no anonymous cookie", async () => {
    const { repo } = fakeClaimRepo([]);
    await claimAnonymousSession(null, "user-1", { repo });
    expect(repo.claimSession).not.toHaveBeenCalled();
  });

  it("claims exactly the session named by the cookie, for that user", async () => {
    const { repo, table } = fakeClaimRepo([
      { id: "mine", userId: null, expiresAt: new Date(Date.now() + 1000) },
    ]);
    await claimAnonymousSession("mine", "user-1", { repo });
    expect(repo.claimSession).toHaveBeenCalledWith(
      "mine",
      "user-1",
      expect.any(Date),
    );
    expect(table.get("mine")).toMatchObject({
      userId: "user-1",
      expiresAt: null,
    });
  });

  it("never reassigns a session someone else already claimed", async () => {
    const { repo, table } = fakeClaimRepo([
      { id: "victim", userId: "victim-user", expiresAt: null },
    ]);
    // Attacker somehow gets "victim" into their own cookie (e.g. a stolen
    // or shared browser) and signs in as themselves.
    await claimAnonymousSession("victim", "attacker-user", { repo });
    expect(table.get("victim")!.userId).toBe("victim-user");
  });

  it("does not claim an already-expired anonymous session", async () => {
    const { repo, table } = fakeClaimRepo([
      {
        id: "stale",
        userId: null,
        expiresAt: new Date("2020-01-01T00:00:00Z"),
      },
    ]);
    await claimAnonymousSession("stale", "user-1", {
      repo,
      now: () => new Date("2026-09-22T00:00:00Z"),
    });
    expect(table.get("stale")).toMatchObject({ userId: null });
  });

  it("is idempotent — claiming twice is harmless", async () => {
    const { repo, table } = fakeClaimRepo([
      { id: "mine", userId: null, expiresAt: null },
    ]);
    await claimAnonymousSession("mine", "user-1", { repo });
    await claimAnonymousSession("mine", "user-1", { repo });
    expect(table.get("mine")).toMatchObject({ userId: "user-1" });
  });
});
