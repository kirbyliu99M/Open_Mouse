/**
 * The env wiring of the tester page and routes (src/server/tester/route-deps.ts):
 * `TESTER_OPEN` and `TESTER_CODES` read at request time, so a flipped or
 * missing `open` cannot pass unnoticed (review #243 round 7).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  testerPageEnabled,
  testerPageOpen,
  testerRouteDeps,
} from "../../src/server/tester/route-deps";

afterEach(() => vi.unstubAllEnvs());

function env(open: string, codes: string) {
  vi.stubEnv("TESTER_OPEN", open);
  vi.stubEnv("TESTER_CODES", codes);
}

describe("tester route deps", () => {
  it("both unset: page off, deps closed", () => {
    env("", "");
    expect(testerPageEnabled()).toBe(false);
    expect(testerPageOpen()).toBe(false);
    const deps = testerRouteDeps("shot");
    expect(deps.open).toBe(false);
    expect(deps.codes).toBeNull();
  });

  it("TESTER_OPEN=1 alone: page on and open, no codes", () => {
    env("1", "");
    expect(testerPageEnabled()).toBe(true);
    expect(testerPageOpen()).toBe(true);
    expect(testerRouteDeps("shot").open).toBe(true);
    expect(testerRouteDeps("check").codes).toBeNull();
  });

  it("codes alone: page on, not open", () => {
    env("", "P07-K7Q2M9");
    expect(testerPageEnabled()).toBe(true);
    expect(testerPageOpen()).toBe(false);
    const deps = testerRouteDeps("shot");
    expect(deps.open).toBe(false);
    expect(deps.codes).toEqual(["P07-K7Q2M9"]);
  });

  it("anything but exactly 1 does not open the page", () => {
    for (const v of ["0", "true", "yes", "11"]) {
      env(v, "");
      expect(testerPageOpen(), v).toBe(false);
      expect(testerPageEnabled(), v).toBe(false);
    }
  });
});
