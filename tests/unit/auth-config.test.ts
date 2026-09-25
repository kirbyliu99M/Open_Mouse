import { describe, expect, it } from "vitest";
import {
  isAuthConfigured,
  PLACEHOLDER_AUTH_SECRET,
  resolveAuthSecret,
} from "../../src/server/auth/config";

describe("isAuthConfigured — no real OAuth credentials exist here (issue #17)", () => {
  it("is false when nothing is set", () => {
    expect(isAuthConfigured({})).toBe(false);
  });

  it.each([
    { AUTH_GOOGLE_ID: "id" },
    { AUTH_GOOGLE_SECRET: "secret" },
    { AUTH_SECRET: "secret" },
    { AUTH_GOOGLE_ID: "id", AUTH_GOOGLE_SECRET: "secret" },
    { AUTH_GOOGLE_ID: "id", AUTH_SECRET: "secret" },
    { AUTH_GOOGLE_ID: "", AUTH_GOOGLE_SECRET: "secret", AUTH_SECRET: "secret" },
    { AUTH_GOOGLE_ID: "   ", AUTH_GOOGLE_SECRET: "s", AUTH_SECRET: "s" },
  ])("is false when only some are set (%o)", (env) => {
    expect(isAuthConfigured(env)).toBe(false);
  });

  it("is true only when all three are set to non-blank values", () => {
    expect(
      isAuthConfigured({
        AUTH_GOOGLE_ID: "id",
        AUTH_GOOGLE_SECRET: "secret",
        AUTH_SECRET: "secret",
      }),
    ).toBe(true);
  });

  it("defaults to process.env when no env is passed", () => {
    // In this build/test environment no real credentials exist.
    expect(isAuthConfigured()).toBe(false);
  });
});

// L3 (security hardening finding): a missing AUTH_SECRET used to fall back
// silently to a public, checked-in placeholder secret, in production and
// everywhere else alike. Auth.js uses this value to sign/verify session and
// CSRF/state cookies, so a known public value lets anyone forge them --
// in production it is now a random per-process secret nobody knows (not a
// throw: that failed next build and every route). Dev/test/build keep the
// fixed placeholder.
describe("resolveAuthSecret", () => {
  it("returns the real secret when AUTH_SECRET is set, in any environment", () => {
    expect(resolveAuthSecret({ AUTH_SECRET: "real-secret" })).toBe(
      "real-secret",
    );
    expect(
      resolveAuthSecret({
        AUTH_SECRET: "real-secret",
        NODE_ENV: "production",
      }),
    ).toBe("real-secret");
    expect(
      resolveAuthSecret({
        AUTH_SECRET: "real-secret",
        VERCEL_ENV: "production",
      }),
    ).toBe("real-secret");
  });

  it("falls back to the placeholder outside production when AUTH_SECRET is unset", () => {
    expect(resolveAuthSecret({})).toBe("unconfigured-build-only-placeholder");
    expect(resolveAuthSecret({ NODE_ENV: "development" })).toBe(
      "unconfigured-build-only-placeholder",
    );
    expect(resolveAuthSecret({ NODE_ENV: "test" })).toBe(
      "unconfigured-build-only-placeholder",
    );
    expect(resolveAuthSecret({ VERCEL_ENV: "preview" })).toBe(
      "unconfigured-build-only-placeholder",
    );
  });

  it("treats a blank AUTH_SECRET the same as unset", () => {
    expect(resolveAuthSecret({ AUTH_SECRET: "" })).toBe(
      "unconfigured-build-only-placeholder",
    );
    expect(resolveAuthSecret({ AUTH_SECRET: "   " })).toBe(
      "unconfigured-build-only-placeholder",
    );
  });

  it("never returns the public placeholder in production without AUTH_SECRET (NODE_ENV)", () => {
    const secret = resolveAuthSecret({ NODE_ENV: "production" }, () => "rnd");
    expect(secret).toBe("rnd");
    expect(secret).not.toBe(PLACEHOLDER_AUTH_SECRET);
  });

  it("uses the random secret when VERCEL_ENV=production even if NODE_ENV is not production", () => {
    expect(
      resolveAuthSecret(
        { VERCEL_ENV: "production", NODE_ENV: "test" },
        () => "rnd",
      ),
    ).toBe("rnd");
  });

  it("does not throw in production without AUTH_SECRET (a throw fails next build and every route)", () => {
    expect(() => resolveAuthSecret({ NODE_ENV: "production" })).not.toThrow();
  });

  it("keeps one random secret per process by default, at least 32 bytes long", () => {
    const first = resolveAuthSecret({ NODE_ENV: "production" });
    const second = resolveAuthSecret({ NODE_ENV: "production" });
    expect(first).toBe(second);
    expect(Buffer.from(first, "base64url").length).toBeGreaterThanOrEqual(32);
  });

  it("uses the placeholder for a Vercel preview without AUTH_SECRET", () => {
    expect(resolveAuthSecret({ VERCEL_ENV: "preview" })).toBe(
      PLACEHOLDER_AUTH_SECRET,
    );
  });

  it("defaults to process.env (the test runner is not production, so the placeholder)", () => {
    expect(resolveAuthSecret()).toBe(PLACEHOLDER_AUTH_SECRET);
  });
});
