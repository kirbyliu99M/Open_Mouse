import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The route file wires the real pieces (Drizzle `select 1`, the DB-backed
 * limiter, `process.env`) to `handleHealth`. The pieces that need a database
 * are replaced; what is under test is the wiring: which query runs, how the
 * limiter is keyed, and that no environment variable but the commit hash is
 * handed on.
 */
vi.mock("server-only", () => ({}));

const execute = vi.fn();
const createDrizzleRateLimiter = vi.fn();
vi.mock("../../src/db/client", () => ({ getDb: () => ({ execute }) }));
vi.mock("../../src/server/analysis/drizzle-rate-limiter", () => ({
  createDrizzleRateLimiter: (options: unknown) => {
    createDrizzleRateLimiter(options);
    return { allow: () => true };
  },
}));

import { GET } from "../../src/app/api/health/route";

const SECRETS = {
  DATABASE_URL: "postgres://admin:hunter2@ep-secret-host-123.neon.tech/prod",
  AUTH_SECRET: "auth-secret-value-aaaaaaaaaaaaaaaaaaaa",
  GEMINI_API_KEY: "AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q",
  CRON_SECRET: "cron-secret-value-bbbbbbbbbbbbbbbbbbbb",
};

const call = () =>
  GET(
    new Request("https://example.test/api/health", {
      headers: { "x-vercel-forwarded-for": "203.0.113.45" },
    }),
  );

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  execute.mockReset();
  createDrizzleRateLimiter.mockReset();
});

describe("app/api/health/route.ts", () => {
  it("runs select 1 and answers 200 with the short commit hash", async () => {
    vi.stubEnv(
      "VERCEL_GIT_COMMIT_SHA",
      "fedcba9876543210fedcba9876543210fedcba98",
    );
    execute.mockResolvedValue({ rows: [{ "?column?": 1 }] });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      version: "fedcba9",
      db: "ok",
    });
    expect(execute).toHaveBeenCalledTimes(1);
    // The query text is `select 1` and nothing else.
    const query = JSON.stringify(execute.mock.calls[0]![0]);
    expect(query.toLowerCase()).toContain("select 1");
  });

  it("says dev when the platform sets no commit", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    execute.mockResolvedValue({});
    expect((await (await call()).json()).version).toBe("dev");
  });

  it("limits each caller to 30 calls a minute under its own key prefix", async () => {
    execute.mockResolvedValue({});
    await call();
    expect(createDrizzleRateLimiter).toHaveBeenCalledWith({
      windowMs: 60_000,
      limit: 30,
      keyPrefix: "health:",
    });
  });

  it("leaks no environment variable, even when the database error quotes one", async () => {
    for (const [name, value] of Object.entries(SECRETS))
      vi.stubEnv(name, value);
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "fedcba9876543210");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    execute.mockRejectedValue(
      new Error(`getaddrinfo ENOTFOUND ${SECRETS.DATABASE_URL}`),
    );
    const res = await call();
    expect(res.status).toBe(503);
    const everything =
      (await res.text()) +
      JSON.stringify([...res.headers.entries()]) +
      warn.mock.calls.flat().join("");
    for (const value of Object.values(SECRETS)) {
      expect(everything).not.toContain(value);
    }
    expect(everything).not.toContain("ENOTFOUND");
    expect(everything).not.toContain("ep-secret-host");
  });
});
