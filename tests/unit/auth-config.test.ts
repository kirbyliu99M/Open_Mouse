import { describe, expect, it } from "vitest";
import {
  isAuthConfigured,
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
// in production this must fail loudly instead of arming every session with
// it. Dev/test/build (no VERCEL_ENV=production, no NODE_ENV=production)
// must keep working unset, exactly as before.
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

  it("throws a clear error when NODE_ENV=production and AUTH_SECRET is unset", () => {
    expect(() => resolveAuthSecret({ NODE_ENV: "production" })).toThrow(
      /AUTH_SECRET/,
    );
  });

  it("throws when VERCEL_ENV=production and AUTH_SECRET is unset, even if NODE_ENV is not production", () => {
    expect(() =>
      resolveAuthSecret({ VERCEL_ENV: "production", NODE_ENV: "test" }),
    ).toThrow(/AUTH_SECRET/);
  });

  it("does not throw for a Vercel preview deployment (VERCEL_ENV=preview, NODE_ENV unset) without AUTH_SECRET", () => {
    // NODE_ENV === "production" alone is also treated as production (the
    // task's spec is a plain OR of the two flags) -- this only exercises
    // the case where NEITHER flag says production.
    expect(() => resolveAuthSecret({ VERCEL_ENV: "preview" })).not.toThrow();
  });

  it("defaults to process.env when no env is passed", () => {
    // In this build/test environment neither AUTH_SECRET nor a production
    // runtime is set, so this must not throw.
    expect(() => resolveAuthSecret()).not.toThrow();
  });
});
