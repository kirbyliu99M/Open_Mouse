/**
 * The real `/scan/tester` page (src/app/scan/tester/page.tsx) passes open
 * mode through from the env, and open mode's server HTML starts on consent
 * with no code form (review #243 round 8).
 */
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import ScanTesterPage from "../../src/app/scan/tester/page";
import { TesterClient } from "../../src/client/tester/TesterClient";

afterEach(() => vi.unstubAllEnvs());

function env(open: string, codes: string) {
  vi.stubEnv("TESTER_OPEN", open);
  vi.stubEnv("TESTER_CODES", codes);
}

describe("/scan/tester page", () => {
  it("is notFound() with both env vars unset", () => {
    env("", "");
    expect(() => ScanTesterPage()).toThrow("NEXT_NOT_FOUND");
  });

  it("passes open from TESTER_OPEN to the client", () => {
    env("1", "");
    expect(ScanTesterPage().props.open).toBe(true);
    env("", "P07-K7Q2M9");
    expect(ScanTesterPage().props.open).toBe(false);
  });
});

describe("TesterClient server HTML", () => {
  it("open mode starts on consent, with no code form", () => {
    const html = renderToString(createElement(TesterClient, { open: true }));
    expect(html).toContain('data-testid="tester-step-consent"');
    expect(html).not.toContain('id="tester-code"');
  });

  it("code mode still starts on the code form", () => {
    const html = renderToString(createElement(TesterClient));
    expect(html).toContain('data-testid="tester-step-code"');
    expect(html).toContain('id="tester-code"');
  });
});
