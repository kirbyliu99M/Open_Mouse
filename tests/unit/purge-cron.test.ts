/**
 * `GET /api/cron/purge-inactive`: authorization, the mode switch, the per-run
 * bounds and what the response and the log are allowed to say (candidate, spec
 * 2026-10-11, sections 3.4 and 5.3). The repo is a fake here; the SQL it stands
 * for is tested on PGlite in purge-db.test.ts.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { PurgeGuard, PurgeRepo } from "../../src/server/account/purge";
import {
  CHUNK_SIZE,
  DEFAULT_LIMITS,
  MAX_ACCOUNTS_PER_RUN,
  TIME_BUDGET_MS,
  handlePurgeInactive,
  type PurgeCronDeps,
} from "../../src/server/account/purge-cron";
import { formatLogLine, shortHash, type LogFields } from "../../src/server/log";

const URL_BASE = "http://localhost/api/cron/purge-inactive";

/** An in-memory stand-in with the same observable rules as the SQL. */
function fakeRepo(ids: string[] = []) {
  const remaining = new Set(ids);
  const repo = {
    selectInactiveUserIds: vi.fn(async (_days: number, limit: number) =>
      [...remaining].slice(0, limit),
    ),
    countInactiveUsers: vi.fn(async () => remaining.size),
    countScansOfUsers: vi.fn(
      async (userIds: readonly string[]) => userIds.length * 2,
    ),
    deleteUserAccounts: vi.fn(
      async (userIds: readonly string[], guard: PurgeGuard) => {
        // The real SQL refuses a nonsense window; the fake does too.
        if (guard.windowDays < 1) throw new RangeError("window");
        const gone = userIds.filter((id) => remaining.delete(id));
        return gone;
      },
    ),
  } satisfies PurgeRepo;
  return { repo, remaining };
}

function neverCalled(repo: ReturnType<typeof fakeRepo>["repo"]) {
  for (const fn of Object.values(repo)) expect(fn).not.toHaveBeenCalled();
}

const call = (
  query: string,
  deps: Partial<PurgeCronDeps> & { repo: PurgeRepo },
  authorization: string | null = "Bearer secret",
) =>
  handlePurgeInactive(
    new Request(`${URL_BASE}${query}`, {
      headers: authorization ? { authorization } : {},
    }),
    {
      cronSecret: "secret",
      modeEnv: "delete",
      logger: { info: vi.fn(), error: vi.fn() },
      ...deps,
    },
  );

describe("the shipped limits", () => {
  it("are 200 accounts a run, chunks of 25, a 20 s budget, a 90-day window", () => {
    expect(MAX_ACCOUNTS_PER_RUN).toBe(200);
    expect(CHUNK_SIZE).toBe(25);
    expect(TIME_BUDGET_MS).toBe(20_000);
    expect(DEFAULT_LIMITS).toEqual({
      maxAccounts: 200,
      chunkSize: 25,
      budgetMs: 20_000,
      windowDays: 90,
    });
  });
});

describe("authorization", () => {
  it.each([
    ["no secret configured, no header", undefined, null],
    ["no secret configured, a header", undefined, "Bearer secret"],
    [
      "no secret configured, header 'Bearer undefined'",
      undefined,
      "Bearer undefined",
    ],
    ["empty secret configured", "", "Bearer "],
    ["secret configured, no header", "secret", null],
    ["secret configured, wrong secret", "secret", "Bearer wrong"],
    ["secret configured, missing Bearer prefix", "secret", "secret"],
    ["secret configured, wrong scheme", "secret", "Basic secret"],
  ] as const)(
    "%s: 401, and the repo is never called",
    async (_label, cronSecret, header) => {
      const { repo } = fakeRepo(["a", "b"]);
      const res = await call("", { repo, cronSecret }, header);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
      neverCalled(repo);
    },
  );

  it("is checked before the mode: a wrong secret with ?dryRun=1 is still 401", async () => {
    const { repo } = fakeRepo(["a"]);
    const res = await call("?dryRun=1", { repo }, "Bearer nope");
    expect(res.status).toBe(401);
    neverCalled(repo);
  });

  it("the right secret is let through", async () => {
    const { repo } = fakeRepo([]);
    const res = await call("", { repo });
    expect(res.status).toBe(200);
  });
});

describe("mode", () => {
  it.each([undefined, "", "off", "DELETE", "yes", "dry_run"])(
    "%j is off: 200 {mode: off} and nothing is touched",
    async (modeEnv) => {
      const { repo } = fakeRepo(["a"]);
      const res = await call("", { repo, modeEnv });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ mode: "off" });
      neverCalled(repo);
    },
  );

  it.each(["?mode=delete", "?dryRun=0", "?delete=1", "?dryRun=true"])(
    "no query value turns off into delete (%s)",
    async (query) => {
      const { repo } = fakeRepo(["a"]);
      const res = await call(query, { repo, modeEnv: "off" });
      expect(await res.json()).toEqual({ mode: "off" });
      neverCalled(repo);
    },
  );

  it("?dryRun=1 with the variable on delete never deletes", async () => {
    const { repo, remaining } = fakeRepo(["a", "b"]);
    const res = await call("?dryRun=1", { repo, modeEnv: "delete" });
    expect(((await res.json()) as { mode: string }).mode).toBe("dry-run");
    expect(repo.deleteUserAccounts).not.toHaveBeenCalled();
    expect(remaining.size).toBe(2);
  });

  it("?dryRun=1 also runs a dry-run when the variable is off (it only reads)", async () => {
    const { repo } = fakeRepo(["a"]);
    const res = await call("?dryRun=1", { repo, modeEnv: "off" });
    expect(((await res.json()) as { mode: string }).mode).toBe("dry-run");
    expect(repo.deleteUserAccounts).not.toHaveBeenCalled();
  });
});

describe("dry-run", () => {
  it("reports counts and at most 20 hashed ids: never an id in full", async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `user-${i}-secretish`);
    const { repo } = fakeRepo(ids);
    const res = await call("", { repo, modeEnv: "dry-run" });
    const text = await res.text();
    const body = JSON.parse(text) as {
      candidates: number;
      scansInRun: number;
      remaining: boolean;
      sample: string[];
    };
    expect(body.candidates).toBe(30);
    expect(body.scansInRun).toBe(60);
    expect(body.remaining).toBe(false);
    expect(body.sample).toEqual(ids.slice(0, 20).map(shortHash));
    for (const id of ids) expect(text).not.toContain(id);
    expect(repo.deleteUserAccounts).not.toHaveBeenCalled();
  });

  it("says remaining when more accounts are eligible than one run would take", async () => {
    const { repo } = fakeRepo(Array.from({ length: 201 }, (_, i) => `u${i}`));
    const res = await call("", { repo, modeEnv: "dry-run" });
    const body = (await res.json()) as {
      candidates: number;
      remaining: boolean;
    };
    expect(body.candidates).toBe(201);
    expect(body.remaining).toBe(true);
  });
});

describe("delete mode bounds", () => {
  it("deletes in chunks of 25", async () => {
    const { repo } = fakeRepo(Array.from({ length: 60 }, (_, i) => `u${i}`));
    const res = await call("", { repo });
    expect(await res.json()).toMatchObject({
      usersDeleted: 60,
      chunks: 3,
      remaining: false,
    });
    expect(repo.deleteUserAccounts.mock.calls.map((c) => c[0].length)).toEqual([
      25, 25, 10,
    ]);
    for (const [, guard] of repo.deleteUserAccounts.mock.calls) {
      expect(guard).toEqual({ windowDays: 90 });
    }
  });

  it("never deletes more than 200 accounts in one run, and says remaining", async () => {
    const { repo, remaining } = fakeRepo(
      Array.from({ length: 500 }, (_, i) => `u${i}`),
    );
    const res = await call("", { repo });
    expect(await res.json()).toMatchObject({
      usersDeleted: 200,
      chunks: 8,
      remaining: true,
    });
    expect(remaining.size).toBe(300);
  });

  it("exactly 200 eligible: all deleted, nothing remaining", async () => {
    const { repo } = fakeRepo(Array.from({ length: 200 }, (_, i) => `u${i}`));
    const res = await call("", { repo });
    expect(await res.json()).toMatchObject({
      usersDeleted: 200,
      remaining: false,
    });
  });

  it("starts no new chunk after the 20 s budget", async () => {
    const { repo } = fakeRepo(Array.from({ length: 100 }, (_, i) => `u${i}`));
    let now = 1_000_000;
    // Each chunk "takes" 7 s of wall time: chunks start at 0, 7 and 14 s; the
    // check at 21 s refuses a fourth.
    repo.deleteUserAccounts.mockImplementation(async (ids) => {
      now += 7_000;
      return [...ids];
    });
    const res = await call("", { repo, nowMs: () => now });
    expect(await res.json()).toMatchObject({
      usersDeleted: 75,
      chunks: 3,
      remaining: true,
    });
    expect(repo.deleteUserAccounts).toHaveBeenCalledTimes(3);
  });

  it("stops instead of looping when the guard deletes nothing for the ids it selected, and says remaining because the same accounts are still eligible", async () => {
    const { repo } = fakeRepo(["a", "b"]);
    repo.deleteUserAccounts.mockImplementation(async () => []);
    const res = await call("", { repo });
    expect(await res.json()).toMatchObject({
      usersDeleted: 0,
      chunks: 1,
      remaining: true,
    });
    // One chunk, then the single "anything more?" look: no endless re-selection.
    expect(repo.deleteUserAccounts).toHaveBeenCalledTimes(1);
    expect(repo.selectInactiveUserIds).toHaveBeenCalledTimes(2);
  });

  it("a chunk the guard blocked does not hide other eligible accounts: remaining is true", async () => {
    // The first two became active after the select (the guard blocks them) but
    // a third account is still eligible.
    const { repo, remaining } = fakeRepo(["a", "b", "c"]);
    repo.selectInactiveUserIds.mockImplementationOnce(async () => ["a", "b"]);
    repo.deleteUserAccounts.mockImplementation(async (ids) => {
      for (const id of ids) remaining.delete(id);
      return [];
    });
    remaining.add("c");
    const res = await call("", { repo });
    expect(await res.json()).toMatchObject({
      usersDeleted: 0,
      chunks: 1,
      remaining: true,
    });
  });

  it("a chunk the guard blocked with nothing else eligible: remaining is false", async () => {
    const { repo, remaining } = fakeRepo(["a", "b"]);
    repo.deleteUserAccounts.mockImplementation(async (ids) => {
      for (const id of ids) remaining.delete(id);
      return [];
    });
    const res = await call("", { repo });
    expect(await res.json()).toMatchObject({
      usersDeleted: 0,
      chunks: 1,
      remaining: false,
    });
  });

  it("a guard that blocks every chunk cannot loop past the cap or the time budget", async () => {
    const { repo } = fakeRepo(Array.from({ length: 500 }, (_, i) => `u${i}`));
    repo.deleteUserAccounts.mockImplementation(async () => []);
    const res = await call("", { repo });
    expect((await res.json()) as { remaining: boolean }).toMatchObject({
      remaining: true,
    });
    expect(repo.deleteUserAccounts.mock.calls.length).toBeLessThanOrEqual(8);
  });

  it("remaining is false only after a select that found nothing", async () => {
    const { repo } = fakeRepo(["a"]);
    const res = await call("", { repo });
    expect(await res.json()).toMatchObject({
      usersDeleted: 1,
      remaining: false,
    });
    // The last select returned no ids.
    const results = await Promise.all(
      repo.selectInactiveUserIds.mock.results.map((r) => r.value),
    );
    expect(results.at(-1)).toEqual([]);
  });

  it("with nothing eligible deletes nothing and does not call the delete", async () => {
    const { repo } = fakeRepo([]);
    const res = await call("", { repo });
    expect(await res.json()).toMatchObject({
      usersDeleted: 0,
      chunks: 0,
      remaining: false,
    });
    expect(repo.deleteUserAccounts).not.toHaveBeenCalled();
  });
});

describe("what the response and the log may say", () => {
  it("the log line carries counts only and survives the real formatter without a full id", async () => {
    const ids = [
      "11111111-2222-3333-4444-555555555555",
      "someone@example.test",
    ];
    const { repo } = fakeRepo(ids);
    const logger = { info: vi.fn(), error: vi.fn() };
    const res = await call("", { repo, logger });
    const text = await res.text();

    expect(logger.info).toHaveBeenCalledTimes(1);
    const [event, fields] = logger.info.mock.calls[0]!;
    expect(event).toBe("retention.purge");
    expect(Object.keys(fields as object).sort()).toEqual(
      [
        "chunks",
        "eligible",
        "mode",
        "ms",
        "remaining",
        "route",
        "scansDeleted",
        "usersDeleted",
      ].sort(),
    );
    const line = formatLogLine("info", event as string, fields as LogFields);
    for (const id of ids) {
      expect(text).not.toContain(id);
      expect(line).not.toContain(id);
    }
    expect(JSON.parse(line)).toMatchObject({
      level: "info",
      event: "retention.purge",
      mode: "delete",
      usersDeleted: 2,
      eligible: 2,
    });
  });

  it("a failure is a 500 that names only the error class, never its message", async () => {
    const { repo } = fakeRepo(["a"]);
    class NeonDbError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "NeonDbError";
      }
    }
    repo.deleteUserAccounts.mockRejectedValue(
      new NeonDbError(
        "connection to host db.secret.example failed for me@example.test",
      ),
    );
    const logger = { info: vi.fn(), error: vi.fn() };
    const res = await call("", { repo, logger });
    const text = await res.text();

    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: "NeonDbError" });
    expect(text).not.toContain("example");
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("example");
    expect(JSON.stringify(logger.error.mock.calls)).toContain("NeonDbError");
  });

  it("a thrown non-Error or a hostile name becomes the plain class 'Error'", async () => {
    for (const thrown of [
      "boom",
      { name: "x" },
      Object.assign(new Error("m"), { name: "a b@c.d" }),
    ]) {
      const { repo } = fakeRepo(["a"]);
      repo.selectInactiveUserIds.mockRejectedValue(thrown);
      const res = await call("", { repo });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Error" });
    }
  });
});

describe("the route module", () => {
  it("answers 401 with no secret and {mode: off} without touching the database, even with no DATABASE_URL", async () => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("RETENTION_PURGE_MODE", "");
    try {
      const { GET, maxDuration, dynamic } =
        await import("../../src/app/api/cron/purge-inactive/route");
      expect(dynamic).toBe("force-dynamic");
      expect(maxDuration).toBe(60);

      expect(
        (
          await GET(
            new Request(URL_BASE, { headers: { authorization: "Bearer x" } }),
          )
        ).status,
      ).toBe(401);

      vi.stubEnv("CRON_SECRET", "s3cret");
      const off = await GET(
        new Request(URL_BASE, { headers: { authorization: "Bearer s3cret" } }),
      );
      expect(off.status).toBe(200);
      expect(await off.json()).toEqual({ mode: "off" });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
