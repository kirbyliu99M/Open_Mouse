import { afterEach, describe, expect, it } from "vitest";
import { guardDemoRouteFromProduction } from "../../src/app/scan/demo-guard";

const ORIGINAL_VERCEL_ENV = process.env.VERCEL_ENV;

describe("guardDemoRouteFromProduction", () => {
  afterEach(() => {
    if (ORIGINAL_VERCEL_ENV === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = ORIGINAL_VERCEL_ENV;
  });

  it("calls notFound() (throws) when VERCEL_ENV is production — /scan/submit-demo and /scan/measured-demo must not exist there", () => {
    process.env.VERCEL_ENV = "production";
    expect(() => guardDemoRouteFromProduction()).toThrow();
  });

  it("does nothing outside production (preview, development, or unset)", () => {
    for (const value of ["preview", "development", undefined] as const) {
      if (value === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = value;
      expect(() => guardDemoRouteFromProduction()).not.toThrow();
    }
  });
});
