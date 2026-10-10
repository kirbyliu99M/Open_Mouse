import { describe, expect, it, vi } from "vitest";
import { fitPreferencesSchema } from "../../src/lib/contracts/fit";
import { loadOwnedFit } from "../../src/server/fit/core";
import { listedOnly } from "../../src/server/fit/listed";
import { scoreFit } from "../../src/server/fit/score";
import type { CatalogueMouse } from "../../src/server/fit/types";
import {
  createFakeFitRepo,
  createFakeScanRepo,
  sampleCatalogue,
  sampleOwnedScan,
} from "./fixtures/fake-fit-deps";

// This file pins the v0 path on purpose (fit-listed-v1.test.ts covers the
// default, v1): the default engine is switched to v0 for these tests.
vi.mock("../../src/server/fit/coefficients", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/server/fit/coefficients")>();
  return { ...actual, DEFAULT_ENGINE: "v0" };
});

// Wrap the real scoreFit so the test can see exactly which catalogue reached it.
vi.mock("../../src/server/fit/score", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/server/fit/score")>();
  return { ...actual, scoreFit: vi.fn(actual.scoreFit) };
});

const SCAN_ID = "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f";
const NO_PREFS = fitPreferencesSchema.parse({});

const hidden: CatalogueMouse = {
  ...sampleCatalogue[0]!,
  id: "mouse-hidden",
  slug: "logitech-m100",
  model: "M100",
  listed: false,
};
const trackball: CatalogueMouse = {
  ...sampleCatalogue[1]!,
  id: "mouse-ball",
  slug: "acme-ball",
  brand: "Acme",
  model: "Ball",
  formFactor: "trackball",
  listed: true,
};

describe("listedOnly", () => {
  it("drops listed = false and keeps listed = true and absent", () => {
    const out = listedOnly([
      { ...sampleCatalogue[0]!, listed: true },
      sampleCatalogue[1]!,
      hidden,
    ]);
    expect(out.map((m) => m.slug)).toEqual(["logitech-g502", "razer-basilisk"]);
  });
});

describe("loadOwnedFit with an unlisted row in the catalogue", () => {
  const run = async () => {
    const fake = createFakeFitRepo([...sampleCatalogue, hidden, trackball]);
    const result = await loadOwnedFit(
      SCAN_ID,
      { userId: null, cookieSessionId: "c" },
      NO_PREFS,
      {
        scanRepo: createFakeScanRepo(vi.fn(async () => sampleOwnedScan)),
        fitRepo: fake.repo,
        now: () => new Date("2026-10-09T12:00:00Z"),
      },
    );
    if (result.status !== "ok") throw new Error("expected ok");
    return { fit: result.fit, fake };
  };

  it("never hands the unlisted row to scoreFit", async () => {
    vi.mocked(scoreFit).mockClear();
    await run();
    expect(scoreFit).toHaveBeenCalledTimes(1);
    const catalogueArg = vi.mocked(scoreFit).mock.calls[0]![1];
    expect(catalogueArg.map((m) => m.slug)).not.toContain("logitech-m100");
    expect(catalogueArg).toHaveLength(3);
  });

  it("neither ranks nor excludes it, and stores nothing for it", async () => {
    const { fit, fake } = await run();
    const everywhere = [
      ...fit.results.map((r) => r.mouse.slug),
      ...fit.excluded.map((e) => e.slug),
    ];
    expect(everywhere).not.toContain("logitech-m100");
    expect(fake.saveFitResultsCalls.flat().map((r) => r.mouseId)).not.toContain(
      "mouse-hidden",
    );
  });

  it("reports a listed trackball as excluded, not ranked", async () => {
    const { fit } = await run();
    expect(fit.excluded).toContainEqual(
      expect.objectContaining({
        slug: "acme-ball",
        reason: "trackball_form_factor",
      }),
    );
    expect(fit.results.map((r) => r.mouse.slug)).not.toContain("acme-ball");
  });
});
