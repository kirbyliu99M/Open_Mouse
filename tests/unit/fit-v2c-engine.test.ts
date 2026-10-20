/**
 * fit-v2.0 candidate, build spec rev2 §4 T8: engine dispatch. "v2" runs the
 * candidate and stores catalogue priors like v1; an id that is not an
 * EngineId fails at the type level and at run time (no silent fall-through
 * to v0); and the default engine stays v1.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FitPreferences } from "../../src/lib/contracts/fit";
import {
  DEFAULT_ENGINE,
  ENGINE_VERSION_V1,
  ENGINE_VERSION_V2,
} from "../../src/server/fit/coefficients";
import {
  resolveFitEngine,
  scoreFitDefault,
  scoreWithEngine,
} from "../../src/server/fit/engine";
import { computePriors } from "../../src/server/fit/priors";
import { scoreFitV2 } from "../../src/server/fit/score-v2-candidate";
import { hand, seedCatalogue } from "./fit-v2c-fixtures";

const prefs: FitPreferences = { includeVertical: false };
const m = hand(250, 87.5); // out of range, so v2 really differs from v1

describe("T8: scoreWithEngine", () => {
  it('"v2" runs the candidate with the catalogue priors and reports its version', () => {
    const out = scoreWithEngine("v2", m, seedCatalogue, prefs, "right");
    expect(ENGINE_VERSION_V2).toBe("fit-v2.0-candidate.0");
    expect(out.engineVersion).toBe("fit-v2.0-candidate.0");
    expect(out).toEqual(
      scoreFitV2(
        m,
        seedCatalogue,
        prefs,
        "right",
        computePriors(seedCatalogue),
      ),
    );
    expect(out.coverage?.lengthOutOfRange).toBe(true);
    // Rank stability is a separate step, never part of the engine call.
    expect(out.results.some((e) => "rankStability" in e)).toBe(false);
  });

  it('"v1" is still v1', () => {
    const out = scoreWithEngine("v1", m, seedCatalogue, prefs, "right");
    expect(out.engineVersion).toBe(ENGINE_VERSION_V1);
    expect(out).not.toHaveProperty("coverage");
  });

  it("an unknown id fails at the type level and at run time", () => {
    expect(() =>
      // @ts-expect-error "v9" is not an EngineId
      scoreWithEngine("v9", m, seedCatalogue, prefs, "right"),
    ).toThrow(/Unknown fit engine: v9/);
  });
});

describe("T8: the default engine", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // This used to pin DEFAULT_ENGINE with the list of 13 things that had to
  // happen before v2 or v3 could be the default. Items 1-4, 6 and 8 (results
  // page, excluded list, share card, analysis input, fitExcludes, feedback
  // snapshot) are the consumer commits of branch v31-consumers-2026-10-20;
  // items 5, 7 and 9-13 are unchanged decisions (Kirby / Claude). What stays
  // pinned: nothing but the environment variable moves the engine off v1, and
  // the variable's default is v1.
  it("falls back to v1: unset, empty, or a value that is not v1, v2 or v3", () => {
    expect(DEFAULT_ENGINE).toBe("v1");
    for (const value of ["", "v0", "v9", "candidate"]) {
      vi.stubEnv("FIT_ENGINE", value);
      expect(resolveFitEngine()).toBe("v1");
    }
  });

  it("the route's engine is v1 when FIT_ENGINE is unset and emits none of the v2 fields", () => {
    vi.stubEnv("FIT_ENGINE", "");
    const out = scoreFitDefault(m, seedCatalogue, prefs, "right");
    expect(out.engineVersion).toBe(ENGINE_VERSION_V1);
    expect(out).not.toHaveProperty("coverage");
    expect(out.results.some((e) => "rankStability" in e)).toBe(false);
  });

  it("FIT_ENGINE=v2 runs the v2 candidate through the route's entry point", () => {
    vi.stubEnv("FIT_ENGINE", "v2");
    const out = scoreFitDefault(m, seedCatalogue, prefs, "right");
    expect(out.engineVersion).toBe(ENGINE_VERSION_V2);
    expect(out.coverage?.lengthOutOfRange).toBe(true);
  });
});
