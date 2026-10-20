import { afterEach, describe, expect, it, vi } from "vitest";
import { fitPreferencesSchema } from "../../src/lib/contracts/fit";
import {
  ENGINE_VERSION_V1,
  ENGINE_VERSION_V3,
} from "../../src/server/fit/coefficients";
import { resolveFitEngine } from "../../src/server/fit/engine";
import { computePriors } from "../../src/server/fit/priors";
import { loadOwnedFit } from "../../src/server/fit/core";
import type { CatalogueMouse } from "../../src/server/fit/types";
import {
  createFakeFitRepo,
  createFakeScanRepo,
  sampleCatalogue,
  sampleOwnedScan,
} from "./fixtures/fake-fit-deps";

// No mock of the engine anywhere in this file: it runs whatever FIT_ENGINE
// resolves to (v1 when unset, the shipped default since 2026-10-10). The v1
// version string is therefore only asserted when the variable is not "v3".

afterEach(() => {
  vi.unstubAllEnvs();
});

const SCAN_ID = "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f";
const NOW = () => new Date("2026-10-10T00:00:00Z");

// One classified mouse, so the catalogue-mean thumb prior is not v0's 75.
const classified: CatalogueMouse = {
  ...sampleCatalogue[0]!,
  id: "mouse-3",
  slug: "acme-classified",
  brand: "Acme",
  model: "Classified",
  thumbRest: true,
};
const catalogue = [...sampleCatalogue, classified];

async function run(prefs = fitPreferencesSchema.parse({})) {
  const { repo: fitRepo, saveFitResultsCalls } = createFakeFitRepo(catalogue);
  const result = await loadOwnedFit(
    SCAN_ID,
    { userId: null, cookieSessionId: "c" },
    prefs,
    {
      scanRepo: createFakeScanRepo(vi.fn(async () => sampleOwnedScan)),
      fitRepo,
      now: NOW,
    },
  );
  if (result.status !== "ok") throw new Error("unreachable");
  return { fit: result.fit, rows: saveFitResultsCalls[0]! };
}

describe("loadOwnedFit under the shipped default engine", () => {
  const expectedVersion =
    resolveFitEngine() === "v3" ? ENGINE_VERSION_V3 : ENGINE_VERSION_V1;

  it("runs the engine FIT_ENGINE names (v1 when unset) and sends a hand type", async () => {
    const { fit, rows } = await run();
    expect(fit.engineVersion).toBe(expectedVersion);
    expect(fit.handType).toBeDefined();
    expect(rows.every((r) => r.engineVersion === expectedVersion)).toBe(true);
  });

  it("runs v1 when FIT_ENGINE is unset or not a valid value", async () => {
    for (const value of ["", "v9"]) {
      vi.stubEnv("FIT_ENGINE", value);
      expect((await run()).fit.engineVersion).toBe(ENGINE_VERSION_V1);
    }
  });

  it("runs v3 and stores v3 rows when FIT_ENGINE=v3", async () => {
    vi.stubEnv("FIT_ENGINE", "v3");
    const { fit, rows } = await run();
    expect(fit.engineVersion).toBe(ENGINE_VERSION_V3);
    expect(rows.every((r) => r.engineVersion === ENGINE_VERSION_V3)).toBe(true);
  });

  it("carries gripStyle.weights when no grip is stated, and none when one is", async () => {
    const open = (await run()).fit.gripStyle;
    expect(open.stated).toBeNull();
    const w = open.weights!;
    expect(w.palm + w.claw + w.fingertip).toBeCloseTo(1, 12);
    const stated = (
      await run(fitPreferencesSchema.parse({ gripStyle: "palm" }))
    ).fit.gripStyle;
    expect(stated.weights).toBeUndefined();
  });

  it("stores a null sub-score as v1's catalogue-mean prior, not v0's 75", async () => {
    const { fit, rows } = await run();
    const grip = fit.gripStyle.used;
    const expected = Math.round(computePriors(catalogue).thumb[grip]);
    expect(expected).not.toBe(75);
    const unclassified = fit.results.filter(
      (e) => e.subscores.thumb.score === null,
    );
    expect(unclassified.length).toBeGreaterThan(0);
    for (const e of unclassified) {
      const row = rows.find((r) => r.rank === e.rank)!;
      expect(row.thumbScore).toBe(expected);
    }
  });
});
