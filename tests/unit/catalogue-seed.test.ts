/**
 * The full CAT-1 seed against a real Postgres (PGlite) with the repo's own
 * migrations: every seed row and imported candidate goes
 * through the real table constraints, a second run changes nothing, and the
 * fit repo reads `listed` and `formFactor` back.
 */
import type { PGlite } from "@electric-sql/pglite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// `server-only` throws outside a React Server Component; the repo module is
// exercised here for real.
vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

import { CATALOGUE_EXPECTED as N } from "./fixtures/catalogue-expected";
import catalogueJson from "../../src/db/seed/catalogue.json";
import descriptorsJson from "../../src/db/seed/logitech-descriptors.json";
import factsJson from "../../src/db/seed/logitech-facts.json";
import seedJson from "../../src/db/seed/logitech.json";
import type { CatalogueEntry } from "../../src/server/catalogue/candidate-map";
import type { FactsFile } from "../../src/server/catalogue/catalogue-rows";
import {
  type SeedDb,
  seedCatalogue,
  seedSummaryLine,
} from "../../src/server/catalogue/seed-catalogue";
import type {
  DescriptorRecord,
  SpecRecord,
} from "../../src/server/catalogue/seed-rows";
import { createDrizzleFitRepo } from "../../src/server/fit/drizzle-repo";
import { listedOnly } from "../../src/server/fit/listed";
import { migratedDatabase } from "./fixtures/pglite";

const specs = seedJson as unknown as SpecRecord[];
const descriptors = descriptorsJson as unknown as DescriptorRecord[];
const input = {
  facts: factsJson as unknown as FactsFile,
  entries: catalogueJson as unknown as CatalogueEntry[],
};

type Row = Record<string, unknown> & { model: string };

let pg: PGlite;
let db: SeedDb;

const rows = async (): Promise<Row[]> =>
  (await pg.query<Row>("SELECT * FROM mice ORDER BY brand, model")).rows;
const one = async (model: string): Promise<Row> => {
  const row = (await rows()).find((r) => r.model === model);
  if (!row) throw new Error(`${model} is not in mice`);
  return row;
};

beforeAll(async () => {
  const migrated = await migratedDatabase();
  pg = migrated.pg;
  db = migrated.db as unknown as SeedDb;
});

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.exec("TRUNCATE mice CASCADE");
});

describe("seedCatalogue with the catalogue, facts and descriptors", () => {
  it("writes every row through the table's constraints and says so", async () => {
    const summary = await seedCatalogue(db, specs, descriptors, input);
    expect(seedSummaryLine(summary)).toBe(
      `Seeded ${N.rows} mice (0 skipped for missing dimensions); table now holds ${N.rows}. Applied descriptors for 34/34 classified models (0 needing review cleared, not applied). Catalogue: ${N.imported} imported, ${N.merged} merged into first-party rows; ${N.unlisted} unlisted.`,
    );
    expect(await rows()).toHaveLength(N.rows);
  });

  it("stores the new columns", async () => {
    await seedCatalogue(db, specs, descriptors, input);
    const all = await rows();
    const count = (f: (r: Row) => boolean) => all.filter(f).length;
    expect(count((r) => r.listed === false)).toBe(N.unlisted);
    expect(count((r) => r.category === "office")).toBe(N.office);
    expect(count((r) => r.form_factor === "trackball")).toBe(3);
    expect(count((r) => r.form_factor === "vertical")).toBe(3);
    expect(count((r) => r.data_source === "first_party")).toBe(N.firstParty);
    expect(count((r) => r.data_source === "eloshapes")).toBe(N.eloshapes);
    expect(count((r) => r.image_path !== null)).toBe(0);

    const m575 = await one("ERGO M575");
    expect(m575).toMatchObject({
      listed: false,
      category: "office",
      form_factor: "trackball",
      hand_compatibility: null,
      shape: "ergonomic", // from logitech-facts.json, never seeded before
    });
    const g903 = await one("G903 Hero");
    expect(g903).toMatchObject({
      listed: true,
      category: "gaming",
      data_source: "first_party",
      hand_compatibility: "ambidextrous",
      shape: "symmetrical",
      hump_placement: "back_minimal", // the geometry value, not the candidate's
    });
  });

  it("is idempotent: a second run changes no row, id and created_at included", async () => {
    await seedCatalogue(db, specs, descriptors, input);
    const first = await rows();
    const summary = await seedCatalogue(db, specs, descriptors, input);
    expect(await rows()).toEqual(first);
    expect(summary.tableCount).toBe(N.rows);
  });

  it("writes connectivity on conflict, so a rerun fills rows seeded without it", async () => {
    await seedCatalogue(db, specs, descriptors, input);
    const imported = (catalogueJson as unknown as CatalogueEntry[]).find(
      (e) => !e.mergesInto && e.connectivity === "wireless",
    )!;
    await pg.exec(
      `UPDATE mice SET connectivity = NULL WHERE model = '${imported.model.replace(/'/g, "''")}' OR model = 'G502 Hero'`,
    );
    await seedCatalogue(db, specs, descriptors, input);
    expect((await one(imported.model)).connectivity).toBe("wireless");
    expect((await one("G502 Hero")).connectivity).toBe(
      specs.find((s) => s.model === "G502 Hero")!.connectivity,
    );
    const all = await rows();
    const count = (v: string | null) =>
      all.filter((r) => r.connectivity === v).length;
    expect({
      wired: count("wired"),
      wireless: count("wireless"),
      unknown: count(null),
    }).toEqual({
      wired: N.rowConnectivity.wired,
      wireless: N.rowConnectivity.wireless,
      unknown: N.rowConnectivity.unknown,
    });
  });

  it("re-seeding moves a row back to the seed's listed value", async () => {
    await seedCatalogue(db, specs, descriptors, input);
    await pg.exec("UPDATE mice SET listed = true WHERE model = 'M100'");
    await seedCatalogue(db, specs, descriptors, input);
    expect((await one("M100")).listed).toBe(false);
  });

  it("sets image_path when the file exists", async () => {
    await seedCatalogue(db, specs, descriptors, {
      ...input,
      imageExists: (slug) => slug === "logitech-g309",
    });
    expect((await one("G309")).image_path).toBe(
      "/images/mice/logitech-g309.webp",
    );
    expect((await one("G203 Lightsync")).image_path).toBeNull();
  });
});

describe("the fit repo over the seeded table", () => {
  it("returns listed and formFactor, and listedOnly keeps the listed rows", async () => {
    await seedCatalogue(db, specs, descriptors, input);
    const repo = createDrizzleFitRepo(
      db as unknown as Parameters<typeof createDrizzleFitRepo>[0],
    );
    const catalogue = await repo.loadCatalogue();
    expect(catalogue).toHaveLength(N.rows);
    const m575 = catalogue.find((m) => m.model === "ERGO M575")!;
    expect(m575.listed).toBe(false);
    expect(m575.formFactor).toBe("trackball");
    expect(listedOnly(catalogue)).toHaveLength(N.listed);
    expect(
      listedOnly(catalogue).filter((m) => m.formFactor === "trackball"),
    ).toEqual([expect.objectContaining({ model: "MX Ergo S" })]);
  });

  it("returns the connectivity column for every row (the results filter reads it from here)", async () => {
    await seedCatalogue(db, specs, descriptors, input);
    const repo = createDrizzleFitRepo(
      db as unknown as Parameters<typeof createDrizzleFitRepo>[0],
    );
    const catalogue = await repo.loadCatalogue();
    const stored = new Map(
      (
        await pg.query<{ slug: string; connectivity: string | null }>(
          "SELECT slug, connectivity FROM mice",
        )
      ).rows.map((r) => [r.slug, r.connectivity] as const),
    );
    // Each row carries exactly what the table holds (a missing column would
    // read as undefined here, and the filter would see every mouse as unknown).
    for (const m of catalogue) {
      expect(m.connectivity, m.slug).toBe(stored.get(m.slug));
    }
    const values = new Set(catalogue.map((m) => m.connectivity));
    expect(values.has("wired")).toBe(true);
    expect(values.has("wireless")).toBe(true);
  });
});
