import { describe, expect, it, vi } from "vitest";
import {
  SCAN_SESSION_COOKIE,
  parseSessionId,
  readSessionCookie,
} from "../../src/server/scans/cookies";
import {
  claimAnonymousSession,
  claimOnSignIn,
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
      headers: {
        cookie: `${SCAN_SESSION_COOKIE}=11111111-1111-4111-8111-111111111111`,
      },
    });
    expect(deriveClaimSessionId(request)).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("ignores a spoofed session id carried anywhere but the cookie", () => {
    // An attacker who doesn't hold bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb's cookie tries to name it
    // via a body field, a query string, and a custom header instead.
    const request = new Request(
      "http://localhost/api/auth/callback/google?sessionId=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-session-id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          cookie: `${SCAN_SESSION_COOKIE}=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
        },
        body: JSON.stringify({
          sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        }),
      },
    );
    expect(deriveClaimSessionId(request)).toBe(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    expect(deriveClaimSessionId(request)).not.toBe(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
  });

  it("is null with no cookie at all, never falling back to another field", () => {
    const request = new Request(
      "http://localhost/api/auth/callback/google?sessionId=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      { headers: { "x-session-id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } },
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

const MINE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const VICTIM = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const STALE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

describe("claimAnonymousSession", () => {
  it("does nothing when there is no anonymous cookie", async () => {
    const { repo } = fakeClaimRepo([]);
    await claimAnonymousSession(null, "user-1", { repo });
    expect(repo.claimSession).not.toHaveBeenCalled();
  });

  it("claims exactly the session named by the cookie, for that user", async () => {
    const { repo, table } = fakeClaimRepo([
      { id: MINE, userId: null, expiresAt: new Date(Date.now() + 1000) },
    ]);
    await claimAnonymousSession(MINE, "user-1", { repo });
    expect(repo.claimSession).toHaveBeenCalledWith(
      MINE,
      "user-1",
      expect.any(Date),
    );
    expect(table.get(MINE)).toMatchObject({
      userId: "user-1",
      expiresAt: null,
    });
  });

  it("never reassigns a session someone else already claimed", async () => {
    const { repo, table } = fakeClaimRepo([
      { id: VICTIM, userId: "victim-user", expiresAt: null },
    ]);
    // Attacker somehow gets VICTIM into their own cookie (e.g. a stolen
    // or shared browser) and signs in as themselves.
    await claimAnonymousSession(VICTIM, "attacker-user", { repo });
    expect(table.get(VICTIM)!.userId).toBe("victim-user");
  });

  it("does not claim an already-expired anonymous session", async () => {
    const { repo, table } = fakeClaimRepo([
      {
        id: STALE,
        userId: null,
        expiresAt: new Date("2020-01-01T00:00:00Z"),
      },
    ]);
    await claimAnonymousSession(STALE, "user-1", {
      repo,
      now: () => new Date("2026-09-22T00:00:00Z"),
    });
    expect(table.get(STALE)).toMatchObject({ userId: null });
  });

  it("is idempotent — claiming twice is harmless", async () => {
    const { repo, table } = fakeClaimRepo([
      { id: MINE, userId: null, expiresAt: null },
    ]);
    await claimAnonymousSession(MINE, "user-1", { repo });
    await claimAnonymousSession(MINE, "user-1", { repo });
    expect(table.get(MINE)).toMatchObject({ userId: "user-1" });
  });

  // The Auth.js sign-in event (src/auth.ts) hands this function the raw
  // `scan_session` value from the cookie store. A malformed one used to reach
  // Postgres as an invalid uuid (22P02): a query that can only fail and an
  // EventError log line (Auth.js swallows it, so the sign-in still succeeds),
  // with the claim skipped.
  it.each([
    ["not a uuid", "session-123"],
    ["an SQL fragment", "' OR 1=1 --"],
    ["a uuid with trailing junk", `${MINE}x`],
    ["a uuid with leading whitespace", ` ${MINE}`],
    ["an empty string", ""],
    ["a truncated uuid", MINE.slice(0, 20)],
    ["a percent-encoding remnant", "%E0%A4%A"],
  ])(
    "never lets a malformed cookie value reach the repo (%s)",
    async (_label, value) => {
      const { repo } = fakeClaimRepo([]);
      await claimAnonymousSession(value, "user-1", { repo });
      expect(repo.claimSession).not.toHaveBeenCalled();
    },
  );

  it("treats an absent cookie (undefined, as the cookie store returns it) as no session", async () => {
    const { repo } = fakeClaimRepo([]);
    await claimAnonymousSession(undefined, "user-1", { repo });
    expect(repo.claimSession).not.toHaveBeenCalled();
  });

  it("still claims a well-formed value, in any letter case", async () => {
    const { repo } = fakeClaimRepo([]);
    await claimAnonymousSession(MINE.toUpperCase(), "user-1", { repo });
    expect(repo.claimSession).toHaveBeenCalledTimes(1);
    expect(repo.claimSession).toHaveBeenCalledWith(
      MINE.toUpperCase(),
      "user-1",
      expect.any(Date),
    );
  });
});

describe("parseSessionId — the one UUID check every cookie reader shares", () => {
  it("accepts exactly what readSessionCookie accepts", () => {
    for (const value of [
      MINE,
      VICTIM,
      "00000000-0000-4000-8000-000000000001",
    ]) {
      expect(parseSessionId(value)).toBe(value);
      expect(readSessionCookie(`${SCAN_SESSION_COOKIE}=${value}`)).toBe(value);
    }
    for (const value of ["", "abc", `${MINE}0`, "' OR 1=1 --"]) {
      expect(parseSessionId(value)).toBeNull();
      expect(readSessionCookie(`${SCAN_SESSION_COOKIE}=${value}`)).toBeNull();
    }
    expect(parseSessionId(undefined)).toBeNull();
    expect(parseSessionId(null)).toBeNull();
  });
});

/**
 * `claimOnSignIn` is the body of the Auth.js `events.signIn` hook in
 * src/auth.ts. The hook itself needs a real sign-in to run, so what it does
 * is pinned here: it hands the signed-in user's id and the `scan_session`
 * cookie's raw value (and nothing else) to the claim.
 */
describe("claimOnSignIn — the Auth.js sign-in event", () => {
  function cookieStore(cookies: Record<string, string>) {
    return {
      get: vi.fn((name: string) =>
        name in cookies ? { value: cookies[name]! } : undefined,
      ),
    };
  }

  it("claims the cookie's session for the user who signed in", async () => {
    const { repo, table } = fakeClaimRepo([
      { id: MINE, userId: null, expiresAt: new Date(Date.now() + 60_000) },
    ]);
    const store = cookieStore({ [SCAN_SESSION_COOKIE]: MINE });

    await claimOnSignIn({ id: "user-1" }, store, { repo });

    expect(store.get).toHaveBeenCalledWith(SCAN_SESSION_COOKIE);
    expect(repo.claimSession).toHaveBeenCalledTimes(1);
    expect(repo.claimSession).toHaveBeenCalledWith(
      MINE,
      "user-1",
      expect.any(Date),
    );
    expect(table.get(MINE)).toMatchObject({
      userId: "user-1",
      expiresAt: null,
    });
  });

  it("reads only the scan_session cookie, never another one", async () => {
    const { repo } = fakeClaimRepo([]);
    const store = cookieStore({ other: MINE });
    await claimOnSignIn({ id: "user-1" }, store, { repo });
    expect(repo.claimSession).not.toHaveBeenCalled();
  });

  it.each([
    ["no user id", { id: undefined }],
    ["a null user id", { id: null }],
    ["an empty user id", { id: "" }],
  ])("claims nothing for %s", async (_label, user) => {
    const { repo } = fakeClaimRepo([]);
    await claimOnSignIn(user, cookieStore({ [SCAN_SESSION_COOKIE]: MINE }), {
      repo,
    });
    expect(repo.claimSession).not.toHaveBeenCalled();
  });

  it("claims nothing when there is no scan_session cookie", async () => {
    const { repo } = fakeClaimRepo([]);
    await claimOnSignIn({ id: "user-1" }, cookieStore({}), { repo });
    expect(repo.claimSession).not.toHaveBeenCalled();
  });

  it("a malformed scan_session value never reaches the repo", async () => {
    const { repo } = fakeClaimRepo([]);
    await claimOnSignIn(
      { id: "user-1" },
      cookieStore({ [SCAN_SESSION_COOKIE]: "not-a-uuid" }),
      { repo },
    );
    expect(repo.claimSession).not.toHaveBeenCalled();
  });
});
