import { describe, expect, it } from "vitest";
import { isAuthConfigured } from "../../src/server/auth/config";

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
