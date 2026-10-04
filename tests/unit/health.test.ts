import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HEALTH_DB_TIMEOUT_MS,
  HEALTH_RATE_LIMIT_MAX,
  HEALTH_RATE_LIMIT_WINDOW_MS,
  handleHealth,
  resolveVersion,
  type HealthDeps,
} from "../../src/server/health/health";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const okDb = () => Promise.resolve();

const request = (headers: Record<string, string> = {}) =>
  new Request("https://example.test/api/health", { headers });
const withIp = { "x-vercel-forwarded-for": "203.0.113.45" };

const deps = (over: Partial<HealthDeps> = {}): HealthDeps => ({
  checkDb: okDb,
  env: { VERCEL_GIT_COMMIT_SHA: SHA },
  ...over,
});

afterEach(() => vi.restoreAllMocks());

describe("GET /api/health, database reachable", () => {
  it("answers 200 with exactly { status, version, db }", async () => {
    const res = await handleHealth(request(), deps());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      version: "0123456",
      db: "ok",
    });
  });

  it("is never cached", async () => {
    for (const checkDb of [okDb, () => Promise.reject(new Error("x"))]) {
      const res = await handleHealth(request(), deps({ checkDb }));
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("content-type")).toContain("application/json");
    }
  });
});

describe("version", () => {
  it("is the first 7 characters of the commit hash", () => {
    expect(resolveVersion(SHA)).toBe("0123456");
    expect(resolveVersion("ABCDEF1234567890")).toBe("abcdef1");
    expect(resolveVersion("abcdef1")).toBe("abcdef1");
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["blank", "   "],
    ["too short to be a hash", "abc12"],
    ["not hexadecimal", "main-branch-build"],
    ["something that looks like a secret", "postgres://user:pw@host/db"],
  ])('is "dev" when the variable is %s', async (_name, value) => {
    expect(resolveVersion(value)).toBe("dev");
    const res = await handleHealth(
      request(),
      deps({ env: { VERCEL_GIT_COMMIT_SHA: value } }),
    );
    expect((await res.json()).version).toBe("dev");
  });
});

describe("database failures", () => {
  it('answers 503 and db "unavailable" when select 1 times out, without waiting past the limit', async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const started = Date.now();
    const res = await handleHealth(
      request(),
      deps({ checkDb: () => new Promise(() => {}), dbTimeoutMs: 30 }),
    );
    expect(Date.now() - started).toBeLessThan(1000);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: "degraded",
      version: "0123456",
      db: "unavailable",
    });
    expect(JSON.parse(String(warn.mock.calls[0]![0]))).toMatchObject({
      level: "warn",
      event: "health.db_unavailable",
      route: "/api/health",
      reason: "timeout",
    });
  });

  it("uses a 2 second limit by default", () => {
    expect(HEALTH_DB_TIMEOUT_MS).toBe(2000);
  });

  it("answers 503 when select 1 throws, and shows nothing of the error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const leaky = new Error(
      "connect ECONNREFUSED postgres://admin:hunter2@ep-secret-host-123.neon.tech:5432/prod",
    );
    const res = await handleHealth(
      request(),
      deps({ checkDb: () => Promise.reject(leaky) }),
    );
    expect(res.status).toBe(503);
    const text = await res.clone().text();
    expect(JSON.parse(text)).toEqual({
      status: "degraded",
      version: "0123456",
      db: "unavailable",
    });
    for (const secret of [
      "hunter2",
      "ep-secret-host",
      "ECONNREFUSED",
      "admin",
    ]) {
      expect(text).not.toContain(secret);
      expect(warn.mock.calls.flat().join("")).not.toContain(secret);
    }
    expect(JSON.parse(String(warn.mock.calls[0]![0]))).toMatchObject({
      event: "health.db_unavailable",
      reason: "error",
    });
  });

  it("treats a check that throws synchronously the same way", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await handleHealth(
      request(),
      deps({
        checkDb: () => {
          throw new Error("DATABASE_URL is not set");
        },
      }),
    );
    expect(res.status).toBe(503);
    expect((await res.json()).db).toBe("unavailable");
  });

  it("does not leave an unhandled rejection when a timed-out check rejects later", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    let rejectLate: (reason: Error) => void = () => {};
    const res = await handleHealth(
      request(),
      deps({
        checkDb: () =>
          new Promise((_resolve, reject) => {
            rejectLate = reject;
          }),
        dbTimeoutMs: 10,
      }),
    );
    expect(res.status).toBe(503);
    rejectLate(new Error("late failure"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe("nothing from the environment is in the response", () => {
  const SECRET_ENV = {
    DATABASE_URL: "postgres://admin:hunter2@ep-secret-host-123.neon.tech/prod",
    AUTH_SECRET: "auth-secret-value-aaaaaaaaaaaaaaaaaaaa",
    GEMINI_API_KEY: "AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q",
    CRON_SECRET: "cron-secret-value-bbbbbbbbbbbbbbbbbbbb",
    RATE_LIMIT_KEY_SECRET: "rate-limit-secret-cccccccccccccccc",
  };

  it("holds for a healthy and a failing database, in body, headers and logs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const checkDb of [
      okDb,
      () => Promise.reject(new Error(SECRET_ENV.DATABASE_URL)),
    ]) {
      // The handler is handed the whole hostile environment on purpose.
      const res = await handleHealth(
        request(),
        deps({
          checkDb,
          env: {
            VERCEL_GIT_COMMIT_SHA: SHA,
            ...SECRET_ENV,
          } as HealthDeps["env"],
        }),
      );
      const everything =
        (await res.text()) + JSON.stringify([...res.headers.entries()]);
      for (const value of Object.values(SECRET_ENV)) {
        expect(everything).not.toContain(value);
      }
      expect(Object.keys(JSON.parse(everything.split("[[")[0]!))).toEqual([
        "status",
        "version",
        "db",
      ]);
    }
    for (const value of Object.values(SECRET_ENV)) {
      expect(warn.mock.calls.flat().join("")).not.toContain(value);
    }
  });
});

describe("abuse protection", () => {
  it("allows 30 calls a minute per caller, on a per-minute window", () => {
    expect(HEALTH_RATE_LIMIT_MAX).toBe(30);
    expect(HEALTH_RATE_LIMIT_WINDOW_MS).toBe(60_000);
  });

  it("answers 429 without touching the database when the caller is over the limit", async () => {
    const checkDb = vi.fn(okDb);
    const allow = vi.fn(() => false);
    const res = await handleHealth(
      request(withIp),
      deps({ checkDb, createLimiter: () => ({ allow }) }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      error: "Too many requests. Try again shortly.",
    });
    expect(checkDb).not.toHaveBeenCalled();
    expect(allow).toHaveBeenCalledWith("203.0.113.45");
  });

  it("checks the database when the caller is within the limit", async () => {
    const checkDb = vi.fn(okDb);
    const res = await handleHealth(
      request(withIp),
      deps({ checkDb, createLimiter: () => ({ allow: () => true }) }),
    );
    expect(res.status).toBe(200);
    expect(checkDb).toHaveBeenCalledTimes(1);
  });

  it("does not limit a request with no usable client IP (local development)", async () => {
    const createLimiter = vi.fn(() => ({ allow: () => false }));
    const res = await handleHealth(request(), deps({ createLimiter }));
    expect(res.status).toBe(200);
    expect(createLimiter).not.toHaveBeenCalled();
  });

  it("fails open when the limiter throws, because it lives in the database being checked", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await handleHealth(
      request(withIp),
      deps({
        createLimiter: () => ({
          allow: () => {
            throw new Error("connection to ep-secret-host-123 refused");
          },
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(String(warn.mock.calls[0]![0]))).toMatchObject({
      event: "health.rate_limiter_unavailable",
      reason: "error",
      action: "proceed_without_limit",
    });
    expect(warn.mock.calls.flat().join("")).not.toContain("ep-secret-host");
  });

  it("fails open when the limiter cannot even be built, and still reports the database", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await handleHealth(
      request(withIp),
      deps({
        createLimiter: () => {
          throw new Error("DATABASE_URL is not set");
        },
        checkDb: () => Promise.reject(new Error("no database")),
      }),
    );
    expect(res.status).toBe(503);
    expect((await res.json()).db).toBe("unavailable");
  });

  it("fails open when the limiter hangs, without waiting past its own limit", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const started = Date.now();
    const res = await handleHealth(
      request(withIp),
      deps({
        createLimiter: () => ({ allow: () => new Promise<boolean>(() => {}) }),
        limiterTimeoutMs: 30,
      }),
    );
    expect(Date.now() - started).toBeLessThan(1000);
    expect(res.status).toBe(200);
  });
});
