/**
 * A typed (manual-entry) hand width is scored on the scan's scale (candidate,
 * Kirby 2026-10-17): `loadOwnedFit` and `buildSnapshot` score
 * `scoringMeasurements(...)`, while the measurements they hand back stay as
 * typed. Nothing here touches a database: fake repos, and the checked-in seed
 * as the real catalogue.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import catalogueJson from "../../src/db/seed/catalogue.json";
import descriptorsJson from "../../src/db/seed/logitech-descriptors.json";
import factsJson from "../../src/db/seed/logitech-facts.json";
import seedJson from "../../src/db/seed/logitech.json";
import { fitPreferencesSchema } from "../../src/lib/contracts/fit";
import {
  MANUAL_ENTRY,
  type HandMeasurements,
} from "../../src/lib/contracts/measurement";
import type { CatalogueEntry } from "../../src/server/catalogue/candidate-map";
import {
  buildSeedRows,
  type FactsFile,
  toCatalogueMouse,
} from "../../src/server/catalogue/catalogue-rows";
import type {
  DescriptorRecord,
  SpecRecord,
} from "../../src/server/catalogue/seed-rows";
import { loadOwnedFit } from "../../src/server/fit/core";
import { scoreFitDefault, scoreWithEngine } from "../../src/server/fit/engine";
import { listedOnly } from "../../src/server/fit/listed";
import { groupShells } from "../../src/server/fit/shell-groups";
import { buildSnapshot } from "../../src/server/result-feedback/snapshot";
import type { OwnedScan } from "../../src/server/scans/repo";
import {
  createFakeFitRepo,
  createFakeScanRepo,
} from "./fixtures/fake-fit-deps";

const SCAN_ID = "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f";
const NOW = () => new Date("2026-10-17T00:00:00Z");

const built = buildSeedRows(
  seedJson as unknown as SpecRecord[],
  descriptorsJson as unknown as DescriptorRecord[],
  {
    facts: factsJson as unknown as FactsFile,
    entries: catalogueJson as unknown as CatalogueEntry[],
  },
);
const catalogue = listedOnly(
  // The seed rows carry no database id; the fake catalogue gives each one.
  [...built.withDescriptors, ...built.withoutDescriptors].map((r) => ({
    ...toCatalogueMouse(r),
    id: r.slug,
  })),
);

// Kirby's pair of 2026-10-17: 190 mm long, 85 mm wide (ruler), claw grip,
// medium palm thickness. Palm length is the contract's estimate for a typed
// hand, as the submission stores it.
const TYPED_WIDTH = 85;
const SCANNED_WIDTH = TYPED_WIDTH * MANUAL_ENTRY.widthToLandmarkScale; // 65.45
const PALM_LENGTH = 190 * MANUAL_ENTRY.palmLengthRatio;
const measure = (palmWidthMm: number): HandMeasurements => ({
  handLengthMm: 190,
  palmLengthMm: PALM_LENGTH,
  palmWidthMm,
});
const scan = (
  palmWidthMm: number,
  calibrationMethod: OwnedScan["calibrationMethod"],
): OwnedScan => ({
  hand: "right",
  gripStyleStated: "claw",
  palmThicknessStated: "medium",
  measurements: measure(palmWidthMm),
  calibrationMethod,
});

async function fitFor(owned: OwnedScan) {
  const { repo: fitRepo } = createFakeFitRepo(catalogue);
  const result = await loadOwnedFit(
    SCAN_ID,
    { userId: null, cookieSessionId: "c" },
    fitPreferencesSchema.parse({}),
    {
      scanRepo: createFakeScanRepo(vi.fn(async () => owned)),
      fitRepo,
      now: NOW,
    },
  );
  if (result.status !== "ok") throw new Error("unreachable");
  return result;
}

describe("loadOwnedFit scores a typed width on the scan's scale", () => {
  it("a typed 85 mm and a printed-sheet 65.45 mm of the same hand give the same fit", async () => {
    const typed = await fitFor(scan(TYPED_WIDTH, "manual-entry"));
    const scanned = await fitFor(scan(SCANNED_WIDTH, "printed-sheet"));
    const top5 = (r: typeof typed) =>
      r.fit.results.slice(0, 5).map((e) => e.mouse.slug);

    expect(typed.fit.gripStyle).toEqual(scanned.fit.gripStyle);
    expect(top5(typed)).toEqual(top5(scanned));
    expect(typed.fit.results.map((e) => e.total)).toEqual(
      scanned.fit.results.map((e) => e.total),
    );
    expect(typed.fit.results).toEqual(scanned.fit.results);
    expect(typed.fit.handType).toEqual(scanned.fit.handType);
    // Only the calibration method differs between the two.
    expect(typed.calibrationMethod).toBe("manual-entry");
    expect(scanned.calibrationMethod).toBe("printed-sheet");
  });

  it("hands back the typed width, not the scored one", async () => {
    const typed = await fitFor(scan(TYPED_WIDTH, "manual-entry"));
    expect(typed.measurements.palmWidthMm).toBe(85);
    expect(typed.measurements).toEqual(measure(85));
  });

  it("without the conversion the typed 85 mm would score differently (the typed fit is not the raw one)", async () => {
    const typed = await fitFor(scan(TYPED_WIDTH, "manual-entry"));
    const raw = scoreFitDefault(
      measure(TYPED_WIDTH),
      catalogue,
      fitPreferencesSchema.parse({
        gripStyle: "claw",
        palmThickness: "medium",
      }),
      "right",
    );
    expect(typed.fit.results.map((e) => e.mouse.slug)).not.toEqual(
      raw.results.map((e) => e.mouse.slug),
    );
  });

  it("does not convert any other method: a printed-sheet 85 mm scores as 85 mm", async () => {
    const sheet = await fitFor(scan(TYPED_WIDTH, "printed-sheet"));
    const legacy = await fitFor(scan(TYPED_WIDTH, null));
    const raw = scoreFitDefault(
      measure(TYPED_WIDTH),
      catalogue,
      fitPreferencesSchema.parse({
        gripStyle: "claw",
        palmThickness: "medium",
      }),
      "right",
    );
    expect(sheet.fit.results.map((e) => e.total)).toEqual(
      legacy.fit.results.map((e) => e.total),
    );
    // Same engine output as scoring the stored numbers directly.
    const rawGrouped = groupShells(raw.results, catalogue);
    expect(sheet.fit.results.map((e) => e.mouse.slug)).toEqual(
      rawGrouped.map((e) => e.mouse.slug),
    );
  });
});

describe("buildSnapshot scores a typed width on the scan's scale", () => {
  it("a typed 85 mm and a printed-sheet 65.45 mm give the same top mice", async () => {
    const typed = await buildSnapshot(
      scan(TYPED_WIDTH, "manual-entry"),
      catalogue,
    );
    const scanned = await buildSnapshot(
      scan(SCANNED_WIDTH, "printed-sheet"),
      catalogue,
    );
    expect(typed.topMice).toEqual(scanned.topMice);
    expect(typed.grip).toBe(scanned.grip);
    expect(typed.handSize).toBe(scanned.handSize);
    expect(typed.handWidth).toBe(scanned.handWidth);
    expect(typed.calibrationMethod).toBe("manual-entry");
    expect(scanned.calibrationMethod).toBe("printed-sheet");
  });

  it("does not change the scan it is given", async () => {
    const owned = scan(TYPED_WIDTH, "manual-entry");
    await buildSnapshot(owned, catalogue);
    expect(owned.measurements.palmWidthMm).toBe(85);
  });
});

describe("the real catalogue, typed 190 x 85 mm, claw, medium thickness", () => {
  const prefs = fitPreferencesSchema.parse({
    gripStyle: "claw",
    palmThickness: "medium",
  });
  const rankOf = (
    list: readonly { mouse: { model: string } }[],
    model: string,
  ): number => {
    const i = list.findIndex((e) => e.mouse.model === model);
    if (i < 0) throw new Error(`${model} is not in the list`);
    return i + 1;
  };

  // The baseline ("what the engine saw before the conversion") is scored with
  // an explicit engine, so it does not move with FIT_ENGINE; the conversion
  // itself runs through the route, which follows FIT_ENGINE. Rank 1 is v1's;
  // v3's wider grip target puts the same mouse at BEFORE_RANK.v3.
  const BEFORE_RANK = { v1: 1, v3: 3 } as const;
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(["v1", "v3"] as const)(
    "moves Scimitar Elite from near the top to far down, and no Scimitar leads (%s)",
    async (engine) => {
      vi.stubEnv("FIT_ENGINE", engine);
      // What the engine saw before this change: the typed 85 mm, unconverted.
      const before = groupShells(
        scoreWithEngine(engine, measure(TYPED_WIDTH), catalogue, prefs, "right")
          .results,
        catalogue,
      );
      const after = (await fitFor(scan(TYPED_WIDTH, "manual-entry"))).fit
        .results;

      // v1, grouped (user-visible) ranks, 2026-10-17: Scimitar Elite Wireless
      // 1 -> 221 of 310, Trinity CF first after. G903 Hero 249 -> 252: the
      // conversion does not lift it (its length sub-score, 22, is what holds it
      // down), so no claim about it is made here.
      expect(rankOf(before, "Scimitar Elite Wireless")).toBe(
        BEFORE_RANK[engine],
      );
      expect(after[0]!.mouse.model).not.toMatch(/^Scimitar/);
      expect(rankOf(after, "Scimitar Elite Wireless")).toBeGreaterThan(100);
    },
  );
});
