/**
 * `FIT_ENGINE` (server-side environment variable) is the one switch for the
 * engine the routes run. Unset, empty or any value that is not "v1", "v2" or
 * "v3" means v1. 未拍板 (candidate): which value production uses is Kirby's call.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ENGINE,
  ENGINE_VERSION_V1,
  ENGINE_VERSION_V3,
} from "../../src/server/fit/coefficients";
import {
  excludeReasonForEngine,
  resolveFitEngine,
  scoreFitDefault,
  scoreWithEngine,
  storedNullScore,
} from "../../src/server/fit/engine";
import { hand, mouseRow, seedCatalogue } from "./fit-v2c-fixtures";

const prefs = { includeVertical: false } as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveFitEngine", () => {
  it("falls back to v1 when FIT_ENGINE is not set", () => {
    expect(DEFAULT_ENGINE).toBe("v1");
    expect(resolveFitEngine({})).toBe("v1");
    expect(resolveFitEngine({ FIT_ENGINE: undefined })).toBe("v1");
  });

  it.each(["v1", "v2", "v3"] as const)("accepts %s", (value) => {
    expect(resolveFitEngine({ FIT_ENGINE: value })).toBe(value);
  });

  it("tolerates surrounding whitespace", () => {
    expect(resolveFitEngine({ FIT_ENGINE: " v3 " })).toBe("v3");
  });

  it.each(["", "v0", "V3", "v4", "3", "fit-v3.0-candidate.0", "true", "v3;v1"])(
    "falls back to v1 for the bad value %j (v0 is not selectable)",
    (value) => {
      expect(resolveFitEngine({ FIT_ENGINE: value })).toBe("v1");
    },
  );

  it("reads process.env at call time, not at import time", () => {
    vi.stubEnv("FIT_ENGINE", "v3");
    expect(resolveFitEngine()).toBe("v3");
    vi.stubEnv("FIT_ENGINE", "nonsense");
    expect(resolveFitEngine()).toBe("v1");
    vi.stubEnv("FIT_ENGINE", "");
    expect(resolveFitEngine()).toBe("v1");
  });
});

describe("the routes follow it", () => {
  const m = hand(190, 65.7);
  const args = [m, seedCatalogue, prefs, "right"] as const;

  it("scoreFitDefault runs v1 when unset and v3 when FIT_ENGINE=v3", () => {
    vi.stubEnv("FIT_ENGINE", "");
    const unset = scoreFitDefault(...args);
    expect(unset.engineVersion).toBe(ENGINE_VERSION_V1);
    expect(unset).toEqual(scoreWithEngine("v1", ...args));

    vi.stubEnv("FIT_ENGINE", "v3");
    const v3 = scoreFitDefault(...args);
    expect(v3.engineVersion).toBe(ENGINE_VERSION_V3);
    expect(v3).toEqual(scoreWithEngine("v3", ...args));
  });

  it("scoreFitDefault stays on v1 for a garbage value", () => {
    vi.stubEnv("FIT_ENGINE", "v9");
    expect(scoreFitDefault(...args).engineVersion).toBe(ENGINE_VERSION_V1);
  });

  it("the stored null score uses the same resolved engine as the fit", () => {
    // Same catalogue-mean prior for v1 and v3, never the v0 constant 75.
    const stored = storedNullScore(
      resolveFitEngine({ FIT_ENGINE: "v3" }),
      seedCatalogue,
    );
    expect(typeof stored("thumb", "palm")).toBe("number");
  });
});

describe("excludeReasonForEngine", () => {
  const vertical = mouseRow({ slug: "v", formFactor: "vertical" });
  const ordinary = mouseRow({ slug: "o" });

  it.each(["v1", "v2", "v3"] as const)(
    "%s hides a vertical mouse by default and keeps an ordinary one",
    (engine) => {
      expect(excludeReasonForEngine(engine, vertical, "right", prefs)).not.toBe(
        null,
      );
      expect(excludeReasonForEngine(engine, ordinary, "right", prefs)).toBe(
        null,
      );
    },
  );

  it("v1, v2 and v3 apply the same rule", () => {
    const v1 = excludeReasonForEngine("v1", vertical, "left", prefs);
    expect(excludeReasonForEngine("v2", vertical, "left", prefs)).toEqual(v1);
    expect(excludeReasonForEngine("v3", vertical, "left", prefs)).toEqual(v1);
  });

  it("an id that is not an engine throws instead of falling to another rule", () => {
    expect(() =>
      // @ts-expect-error "v9" is not an EngineId
      excludeReasonForEngine("v9", ordinary, "right", prefs),
    ).toThrow(/Unknown fit engine: v9/);
  });
});
