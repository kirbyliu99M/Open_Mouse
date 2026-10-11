/**
 * Where `users.last_active_at` is written (candidate, inactive-retention spec
 * 2026-10-11, sections 3.2 and 5.4; decision 1 = rule P2): on sign-in, and at
 * most once per 24 hours when a signed-in request reads its session. A failed
 * write must never break a sign-in or a session read. Run against PGlite with
 * the repo's migrations, and through the real Auth.js handler.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { NextRequest } from "next/server";
import { migratedDatabase } from "./fixtures/pglite";
import { users } from "../../src/db/schema";

vi.mock("server-only", () => ({}));
const headersState = vi.hoisted(() => ({ cookiesThrow: false }));
vi.mock("next/headers", () => ({
  cookies: async () => {
    if (headersState.cookiesThrow) throw new Error("cookies unavailable");
    return { get: () => undefined };
  },
  headers: async () => new Headers(),
}));
vi.mock("../../src/db/client", () => ({ getDb: () => flakyDb }));

import {
  ACTIVITY_THROTTLE_MS,
  type ActivityDbSource,
  recordSessionActivity,
  recordSignIn,
} from "../../src/server/account/activity";
import { handleSignInEvent } from "../../src/server/auth/sign-in";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

type PgDb = Awaited<ReturnType<typeof migratedDatabase>>["db"];
let pg: PGlite;
/** PGlite and neon-http handles differ in type only; the calls are the same. */
let realDb: ActivityDbSource;
let flakyDb: ActivityDbSource;
/** When true, every UPDATE of `users` throws; the adapter's other writes work. */
let failUsersUpdate = false;
let handlers: typeof import("../../src/auth").handlers;
let authEvents: typeof import("../../src/auth").authEvents;

const TOKEN = "session-token-for-the-last-active-test";

beforeAll(async () => {
  process.env.AUTH_SECRET = "test-secret-for-the-last-active-test";
  process.env.AUTH_TRUST_HOST = "true";
  const migrated = await migratedDatabase();
  pg = migrated.pg;
  realDb = migrated.db as unknown as ActivityDbSource;
  const raw: PgDb = migrated.db;
  flakyDb = new Proxy(raw, {
    get(target, prop, receiver) {
      if (prop === "update") {
        return (table: unknown) => {
          if (failUsersUpdate && table === users) {
            throw new Error("boom: db down for me@example.test");
          }
          return target.update(table as typeof users);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as unknown as ActivityDbSource;
  ({ handlers, authEvents } = await import("../../src/auth"));
}, 60_000);
afterAll(() => pg.close());
beforeEach(async () => {
  failUsersUpdate = false;
  await pg.exec(`truncate table users cascade`);
});

const ageOf = async (id: string) =>
  (
    await pg.query<{ age_s: number }>(
      `select extract(epoch from (now() - last_active_at))::float8 as age_s from users where id = $1`,
      [id],
    )
  ).rows[0]!.age_s;

async function seedUser(id: string, lastActiveAgo: string) {
  await pg.query(
    `insert into users (id, name, email, last_active_at) values ($1, 'N', $2, now() - $3::interval)`,
    [id, `${id}@example.test`, lastActiveAgo],
  );
}

const HOUR = 3600;

describe("new accounts", () => {
  it("an insert that does not name the column (the adapter's createUser) gets the insert time", async () => {
    await pg.exec(
      `insert into users (id, email) values ('new', 'new@example.test')`,
    );
    expect(await ageOf("new")).toBeLessThan(60);
    expect(await ageOf("new")).toBeGreaterThanOrEqual(-1);
  });
});

describe("recordSignIn", () => {
  it("sets last_active_at to the database's now(), whatever it was", async () => {
    await seedUser("u1", "200 days");
    await recordSignIn(realDb, "u1");
    expect(await ageOf("u1")).toBeLessThan(60);
  });

  it("writes on every sign-in, even one minute after the last write (no throttle)", async () => {
    await seedUser("u1", "1 minute");
    await pg.exec(
      `update users set last_active_at = now() - interval '2 minutes' where id = 'u1'`,
    );
    await recordSignIn(realDb, "u1");
    expect(await ageOf("u1")).toBeLessThan(30);
  });

  it("does nothing for a missing id, and touches only that user", async () => {
    await seedUser("u1", "200 days");
    await seedUser("u2", "200 days");
    await recordSignIn(realDb, undefined);
    await recordSignIn(realDb, null);
    await recordSignIn(realDb, "u1");
    expect(await ageOf("u1")).toBeLessThan(60);
    expect(await ageOf("u2")).toBeGreaterThan(199 * 24 * HOUR);
  });

  it("a failing write never throws", async () => {
    await seedUser("u1", "200 days");
    failUsersUpdate = true;
    await expect(recordSignIn(flakyDb, "u1")).resolves.toBeUndefined();
    await expect(
      recordSignIn(() => {
        throw new Error("no DATABASE_URL");
      }, "u1"),
    ).resolves.toBeUndefined();
  });
});

describe("recordSessionActivity: the 24-hour throttle", () => {
  const NOW = new Date();
  const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

  it("writes when the row says the last write was more than 24 hours ago", async () => {
    await seedUser("u1", "25 hours");
    await recordSessionActivity(
      realDb,
      { id: "u1", lastActiveAt: hoursAgo(25) },
      NOW,
    );
    expect(await ageOf("u1")).toBeLessThan(60);
  });

  it("does not write when it was 23 hours ago", async () => {
    await seedUser("u1", "23 hours");
    await recordSessionActivity(
      realDb,
      { id: "u1", lastActiveAt: hoursAgo(23) },
      NOW,
    );
    expect(await ageOf("u1")).toBeGreaterThan(22.9 * HOUR);
  });

  it("does not even query when the row is fresh (no wasted write)", async () => {
    const update = vi.fn();
    await recordSessionActivity(
      { update } as never,
      { id: "u1", lastActiveAt: hoursAgo(1) },
      NOW,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("the 24-hour condition is repeated in SQL: a stale copy of the row does not overwrite a fresh write", async () => {
    // Another request already wrote an hour ago, but this request holds the
    // older row it read earlier.
    await seedUser("u1", "1 hour");
    await recordSessionActivity(
      realDb,
      { id: "u1", lastActiveAt: hoursAgo(72) },
      NOW,
    );
    const age = await ageOf("u1");
    expect(age).toBeGreaterThan(0.9 * HOUR);
    expect(age).toBeLessThan(1.1 * HOUR);
  });

  it("an unexpected shape (no lastActiveAt) still ends in a correct row: the SQL throttle decides", async () => {
    await seedUser("old", "3 days");
    await seedUser("recent", "1 hour");
    await recordSessionActivity(realDb, { id: "old" }, NOW);
    await recordSessionActivity(realDb, { id: "recent" }, NOW);
    expect(await ageOf("old")).toBeLessThan(60);
    expect(await ageOf("recent")).toBeGreaterThan(0.9 * HOUR);
  });

  it("does nothing without a user id", async () => {
    const update = vi.fn();
    await recordSessionActivity({ update } as never, undefined, NOW);
    await recordSessionActivity(
      { update } as never,
      { lastActiveAt: hoursAgo(99) },
      NOW,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("a failing write never throws", async () => {
    await seedUser("u1", "3 days");
    failUsersUpdate = true;
    await expect(
      recordSessionActivity(
        flakyDb,
        { id: "u1", lastActiveAt: hoursAgo(72) },
        NOW,
      ),
    ).resolves.toBeUndefined();
    expect(await ageOf("u1")).toBeGreaterThan(71 * HOUR);
  });

  it("the throttle is 24 hours", () => {
    expect(ACTIVITY_THROTTLE_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe("handleSignInEvent", () => {
  const COOKIE = "11111111-1111-4111-8111-111111111111";
  const withCookie = async () => ({ get: () => ({ value: COOKIE }) });
  const noCookies = async () => ({ get: () => undefined });
  const claimRepo = () => ({ claimSession: vi.fn(async () => undefined) });

  it("stamps the user and then tries the claim", async () => {
    await seedUser("u1", "200 days");
    const repo = claimRepo();
    await handleSignInEvent({ id: "u1" }, withCookie, {
      db: realDb,
      makeRepo: () => repo,
    });
    expect(await ageOf("u1")).toBeLessThan(60);
    expect(repo.claimSession).toHaveBeenCalledTimes(1);
  });

  it("a failing stamp does not stop the claim, and a failing claim does not undo the stamp", async () => {
    await seedUser("u1", "200 days");
    failUsersUpdate = true;
    const repo = claimRepo();
    await handleSignInEvent({ id: "u1" }, withCookie, {
      db: flakyDb,
      makeRepo: () => repo,
    });
    expect(repo.claimSession).toHaveBeenCalledTimes(1);

    failUsersUpdate = false;
    const failing = {
      claimSession: vi.fn(async () => {
        throw new Error("claim failed");
      }),
    };
    await expect(
      handleSignInEvent({ id: "u1" }, withCookie, {
        db: realDb,
        makeRepo: () => failing,
      }),
    ).rejects.toThrow("claim failed");
    expect(await ageOf("u1")).toBeLessThan(60);
  });

  it("a cookies() that throws still stamps; only the claim is lost", async () => {
    await seedUser("u1", "200 days");
    const repo = claimRepo();
    await expect(
      handleSignInEvent(
        { id: "u1" },
        async () => {
          throw new Error("cookies unavailable");
        },
        { db: realDb, makeRepo: () => repo },
      ),
    ).rejects.toThrow("cookies unavailable");
    expect(await ageOf("u1")).toBeLessThan(60);
    expect(repo.claimSession).not.toHaveBeenCalled();
  });

  it("a repo factory that throws still stamps", async () => {
    await seedUser("u1", "200 days");
    await expect(
      handleSignInEvent({ id: "u1" }, withCookie, {
        db: realDb,
        makeRepo: () => {
          throw new Error("no DATABASE_URL");
        },
      }),
    ).rejects.toThrow("no DATABASE_URL");
    expect(await ageOf("u1")).toBeLessThan(60);
  });

  it("no user id: no stamp, no claim", async () => {
    const repo = claimRepo();
    await handleSignInEvent({}, noCookies, {
      db: realDb,
      makeRepo: () => repo,
    });
    expect(repo.claimSession).not.toHaveBeenCalled();
  });
});

describe("the sign-in event as wired in src/auth.ts (authEvents.signIn)", () => {
  // The Auth.js event config, called the way Auth.js calls it after a sign-in.
  // This is what fails if the stamp is ever unhooked from the real event.
  it("stamps last_active_at on a sign-in", async () => {
    await seedUser("user-1", "200 days");
    await authEvents.signIn({ user: { id: "user-1" } });
    expect(await ageOf("user-1")).toBeLessThan(60);
  });

  it("still stamps when next/headers cookies() throws (the claim is lost, the stamp is not)", async () => {
    await seedUser("user-1", "200 days");
    headersState.cookiesThrow = true;
    try {
      await expect(
        authEvents.signIn({ user: { id: "user-1" } }),
      ).rejects.toThrow("cookies unavailable");
    } finally {
      headersState.cookiesThrow = false;
    }
    expect(await ageOf("user-1")).toBeLessThan(60);
  });

  it("another user is not stamped", async () => {
    await seedUser("user-1", "200 days");
    await seedUser("user-2", "200 days");
    await authEvents.signIn({ user: { id: "user-1" } });
    expect(await ageOf("user-2")).toBeGreaterThan(199 * 24 * HOUR);
  });
});

describe("the real Auth.js session handler (GET /api/auth/session)", () => {
  const request = () =>
    new NextRequest("http://localhost/api/auth/session", {
      headers: { cookie: `authjs.session-token=${TOKEN}` },
    });

  async function seedSession(lastActiveAgo: string) {
    await seedUser("user-1", lastActiveAgo);
    await pg.query(
      `insert into auth_sessions (session_token, user_id, expires) values ($1, 'user-1', now() + interval '1 day')`,
      [TOKEN],
    );
  }

  it("a signed-in request after more than a day stamps last_active_at, and the body is unchanged", async () => {
    await seedSession("3 days");
    const res = await handlers.GET(request());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["expires", "user"]);
    expect(body.user).toEqual({ id: "user-1", name: "N", image: null });
    expect(await ageOf("user-1")).toBeLessThan(60);
  });

  it("a request inside the 24 hours leaves it alone", async () => {
    await seedSession("2 hours");
    const res = await handlers.GET(request());
    expect(res.status).toBe(200);
    const age = await ageOf("user-1");
    expect(age).toBeGreaterThan(1.9 * HOUR);
    expect(age).toBeLessThan(2.1 * HOUR);
  });

  it("a failing write still returns the session", async () => {
    await seedSession("3 days");
    failUsersUpdate = true;
    const res = await handlers.GET(request());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { id: string } };
    expect(body.user.id).toBe("user-1");
    expect(await ageOf("user-1")).toBeGreaterThan(71 * HOUR);
  });

  it("no session, no write", async () => {
    await seedUser("user-1", "3 days");
    const res = await handlers.GET(
      new NextRequest("http://localhost/api/auth/session"),
    );
    expect(await res.json()).toBeNull();
    expect(await ageOf("user-1")).toBeGreaterThan(71 * HOUR);
  });
});
