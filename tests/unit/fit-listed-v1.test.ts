import { describe, expect, it, vi } from "vitest";
import { fitPreferencesSchema } from "../../src/lib/contracts/fit";
import { DEFAULT_ENGINE } from "../../src/server/fit/coefficients";
import { loadOwnedFit } from "../../src/server/fit/core";
import { computePriors } from "../../src/server/fit/priors";
import { scoreFitV1 } from "../../src/server/fit/score-v1";
import type { CatalogueMouse } from "../../src/server/fit/types";
import {
  createFakeFitRepo,
  createFakeScanRepo,
  sampleCatalogue,
  sampleOwnedScan,
} from "./fixtures/fake-fit-deps";

// Run the route's path with fit-v1 as the default engine, and watch what
// reaches the engine and the catalogue-mean priors.
vi.mock("../../src/server/fit/coefficients", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/server/fit/coefficients")>();
  return { ...actual, DEFAULT_ENGINE: "v1" };
});
vi.mock("../../src/server/fit/score-v1", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/server/fit/score-v1")>();
  return { ...actual, scoreFitV1: vi.fn(actual.scoreFitV1) };
});
vi.mock("../../src/server/fit/priors", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/server/fit/priors")>();
  return { ...actual, computePriors: vi.fn(actual.computePriors) };
});

const SCAN_ID = "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f";

const hidden: CatalogueMouse = {
  ...sampleCatalogue[0]!,
  id: "mouse-hidden",
  slug: "logitech-m100",
  model: "M100",
  lengthMm: 90,
  widthMm: 50,
  weightG: 400,
  listed: false,
};

describe("loadOwnedFit under fit-v1 with an unlisted row", () => {
  it("runs v1", () => {
    expect(DEFAULT_ENGINE).toBe("v1");
  });

  it("keeps the unlisted row out of the ranking, the exclusions, the priors and storage", async () => {
    vi.mocked(scoreFitV1).mockClear();
    vi.mocked(computePriors).mockClear();
    const fake = createFakeFitRepo([...sampleCatalogue, hidden]);
    const result = await loadOwnedFit(
      SCAN_ID,
      { userId: null, cookieSessionId: "c" },
      fitPreferencesSchema.parse({}),
      {
        scanRepo: createFakeScanRepo(vi.fn(async () => sampleOwnedScan)),
        fitRepo: fake.repo,
        now: () => new Date("2026-10-09T12:00:00Z"),
      },
    );
    if (result.status !== "ok") throw new Error("expected ok");

    expect(scoreFitV1).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(scoreFitV1).mock.calls[0]![1].map((m) => m.slug),
    ).not.toContain("logitech-m100");

    // Every priors computation (scoring and stored null scores) saw only listed rows.
    expect(computePriors).toHaveBeenCalled();
    for (const [catalogue] of vi.mocked(computePriors).mock.calls)
      expect(catalogue.map((m) => m.slug)).not.toContain("logitech-m100");

    const everywhere = [
      ...result.fit.results.map((r) => r.mouse.slug),
      ...result.fit.excluded.map((e) => e.slug),
    ];
    expect(everywhere).not.toContain("logitech-m100");
    expect(fake.saveFitResultsCalls.flat().map((r) => r.mouseId)).not.toContain(
      "mouse-hidden",
    );
  });
});
