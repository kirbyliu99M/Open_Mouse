import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FitPreferences } from "../../src/lib/contracts/fit";
import { fitPreferencesSchema } from "../../src/lib/contracts/fit";
import {
  ENGINE_VERSION_V1,
  ENGINE_VERSION_V3,
  THICKNESS_HEIGHT_SHIFT_MM,
  THICKNESS_HEIGHT_SHIFT_MM_V3,
} from "../../src/server/fit/coefficients";
import { resolveFitEngine } from "../../src/server/fit/engine";
import type { OwnedScan } from "../../src/server/scans/repo";
import {
  createFakeFitRepo,
  createFakeScanRepo,
  sampleCatalogue,
  sampleOwnedScan,
} from "./fixtures/fake-fit-deps";

// The real default engine runs; the spy only records the preferences it was
// handed, so the test can tell an `undefined` from a `"medium"` (the two score
// identically, which is exactly why the output alone cannot show it).
const seen: FitPreferences[] = [];
vi.mock("../../src/server/fit/engine", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/server/fit/engine")>();
  return {
    ...actual,
    scoreFitDefault: (
      ...args: Parameters<typeof actual.scoreFitDefault>
    ): ReturnType<typeof actual.scoreFitDefault> => {
      seen.push(args[2]);
      return actual.scoreFitDefault(...args);
    },
  };
});

const { loadOwnedFit } = await import("../../src/server/fit/core");

const SCAN_ID = "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f";
const NOW = () => new Date("2026-10-11T00:00:00Z");

async function run(owned: OwnedScan, prefs: FitPreferences) {
  const { repo: fitRepo } = createFakeFitRepo(sampleCatalogue);
  const result = await loadOwnedFit(
    SCAN_ID,
    { userId: null, cookieSessionId: "c" },
    prefs,
    {
      scanRepo: createFakeScanRepo(vi.fn(async () => owned)),
      fitRepo,
      now: NOW,
    },
  );
  if (result.status !== "ok") throw new Error("unreachable");
  return result.fit;
}

const noPrefs = () => fitPreferencesSchema.parse({});

beforeEach(() => {
  seen.length = 0;
});

describe("loadOwnedFit passes the palm-thickness answer to the engine", () => {
  it("a skipped answer (null in the scan) reaches the engine as undefined, never as medium", async () => {
    await run({ ...sampleOwnedScan, palmThicknessStated: null }, noPrefs());
    expect(seen).toHaveLength(1);
    expect(seen[0]!.palmThickness).toBeUndefined();
    expect(seen[0]!.palmThickness).not.toBe("medium");
  });

  it("the stated answer on the scan is used when the request has none", async () => {
    await run({ ...sampleOwnedScan, palmThicknessStated: "thick" }, noPrefs());
    expect(seen[0]!.palmThickness).toBe("thick");
  });

  it("prefs.palmThickness wins over the scan's stated answer, like gripStyle", async () => {
    await run(
      { ...sampleOwnedScan, palmThicknessStated: "thick" },
      fitPreferencesSchema.parse({ palmThickness: "thin" }),
    );
    expect(seen[0]!.palmThickness).toBe("thin");
  });

  it("an explicit medium in prefs is kept (a choice), even over a stated thick", async () => {
    await run(
      { ...sampleOwnedScan, palmThicknessStated: "thick" },
      fitPreferencesSchema.parse({ palmThickness: "medium" }),
    );
    expect(seen[0]!.palmThickness).toBe("medium");
  });

  it("the grip line next to it is unchanged: prefs, then the scan's stated grip", async () => {
    await run(
      {
        ...sampleOwnedScan,
        gripStyleStated: "palm",
        palmThicknessStated: "thin",
      },
      noPrefs(),
    );
    expect(seen[0]!.gripStyle).toBe("palm");
    expect(seen[0]!.palmThickness).toBe("thin");
  });

  it("the answer changes the response (the height target moves by the shift), and medium equals a skipped answer", async () => {
    const skipped = await run(
      { ...sampleOwnedScan, palmThicknessStated: null },
      noPrefs(),
    );
    const thick = await run(
      { ...sampleOwnedScan, palmThicknessStated: "thick" },
      noPrefs(),
    );
    const medium = await run(
      { ...sampleOwnedScan, palmThicknessStated: "medium" },
      noPrefs(),
    );
    // The shift's direction belongs to the engine the route runs (FIT_ENGINE):
    // v1 raises the height target for a thick palm, v3 lowers it.
    const v3 = resolveFitEngine() === "v3";
    const shift = v3
      ? THICKNESS_HEIGHT_SHIFT_MM_V3.thick
      : THICKNESS_HEIGHT_SHIFT_MM.thick;
    expect(Math.abs(shift)).toBe(1.5);
    expect(thick.targets.heightMm).toBeCloseTo(
      skipped.targets.heightMm + shift,
      9,
    );
    expect(medium).toEqual(skipped);
    expect(skipped.engineVersion).toBe(
      v3 ? ENGINE_VERSION_V3 : ENGINE_VERSION_V1,
    );
  });
});
