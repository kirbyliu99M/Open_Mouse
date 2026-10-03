/**
 * The seed's real upserts (`seedCatalogue`, the function scripts/seed.ts calls)
 * against a real Postgres (PGlite) with the repo's own migrations, fed the
 * checked-in seed and descriptors files. This is the only place the
 * `withDescriptors` branch (enum casts, descriptor_method, a jsonb `[]`, a
 * timestamptz) runs with non-null values before production does.
 */
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
import descriptorsJson from "../../src/db/seed/logitech-descriptors.json";
import seedJson from "../../src/db/seed/logitech.json";
import {
  type SeedDb,
  seedCatalogue,
  seedSummaryLine,
} from "../../src/server/catalogue/seed-catalogue";
import type {
  DescriptorRecord,
  SpecRecord,
} from "../../src/server/catalogue/seed-rows";
import { migratedDatabase } from "./fixtures/pglite";

// A migrated PGlite takes about 2.5 s to start; under load that crossed the
// 5 s default (#61). The timeout covers the setup, not the logic.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const specs = seedJson as unknown as SpecRecord[];
const descriptors = descriptorsJson as unknown as DescriptorRecord[];

const NO_SHELL = [
  "M100",
  "Mobi Fold",
  "MX Ergo S",
  "Signature Comfort M840L",
] as const;
const OTHER_DESCRIPTORS = [
  "shape",
  "hand_compatibility",
  "front_flare",
  "side_curvature",
  "thumb_rest",
  "ring_finger_rest",
] as const;
const PROVENANCE = [
  "descriptor_method",
  "descriptor_model",
  "descriptor_source_urls",
  "classified_at",
] as const;
const ALL_DESCRIPTOR_COLUMNS = [
  "hump_placement",
  ...OTHER_DESCRIPTORS,
  ...PROVENANCE,
] as const;

type Row = Record<string, unknown> & { model: string };

let pg: PGlite;
let db: SeedDb;

const rows = async (): Promise<Row[]> =>
  (await pg.query<Row>("SELECT * FROM mice ORDER BY model")).rows;
const byModel = (all: readonly Row[], model: string): Row => {
  const row = all.find((r) => r.model === model);
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

describe("seedCatalogue on a database whose descriptors are all null (production today)", () => {
  it("first seeds the dimensions only: every descriptor column stays null", async () => {
    const summary = await seedCatalogue(db, specs, []);
    expect(seedSummaryLine(summary)).toBe(
      "Seeded 38 mice (0 skipped for missing dimensions); table now holds 38.",
    );
    const all = await rows();
    expect(all).toHaveLength(38);
    for (const row of all)
      for (const column of ALL_DESCRIPTOR_COLUMNS)
        expect(row[column], `${row.model} ${column}`).toBeNull();
  });

  describe("then with the checked-in descriptors file", () => {
    beforeEach(async () => {
      await seedCatalogue(db, specs, []);
    });

    it("prints the line the production step in the PR promises", async () => {
      const summary = await seedCatalogue(db, specs, descriptors);
      expect(seedSummaryLine(summary)).toBe(
        "Seeded 38 mice (0 skipped for missing dimensions); table now holds 38. Applied descriptors for 34/34 classified models (0 needing review cleared, not applied).",
      );
    });

    it("writes the 34 hump values and nothing else", async () => {
      await seedCatalogue(db, specs, descriptors);
      const all = await rows();
      expect(all).toHaveLength(38);

      const humps = Object.fromEntries(
        all
          .filter((r) => r.hump_placement !== null)
          .map((r) => [r.model, r.hump_placement]),
      );
      expect(humps).toEqual(
        Object.fromEntries(descriptors.map((d) => [d.model, d.humpPlacement])),
      );
      expect(Object.keys(humps)).toHaveLength(34);

      // Every other descriptor column is still null, on all 38 rows.
      for (const row of all)
        for (const column of OTHER_DESCRIPTORS)
          expect(row[column], `${row.model} ${column}`).toBeNull();
    });

    it("stores the provenance the file names, with the labels the seed stamps", async () => {
      await seedCatalogue(db, specs, descriptors);
      const listed = (await rows()).filter((r) => r.hump_placement !== null);
      expect(listed).toHaveLength(34);
      for (const row of listed) {
        // `applyDescriptors` stamps this label on every non-needsReview
        // record; the real provenance is descriptor_model (see
        // src/server/catalogue/geometry-descriptors.ts, COLUMN LABEL).
        expect(row.descriptor_method).toBe("rubric_vision");
        expect(row.descriptor_model).toBe("geometry-gd1@06cc13d");
        expect(row.descriptor_source_urls).toEqual([]);
        expect((row.classified_at as Date).toISOString()).toBe(
          "2026-10-02T00:00:00.000Z",
        );
      }
    });

    it("leaves the four models with no shell with every descriptor column null", async () => {
      await seedCatalogue(db, specs, descriptors);
      const all = await rows();
      for (const model of NO_SHELL)
        for (const column of ALL_DESCRIPTOR_COLUMNS)
          expect(byModel(all, model)[column], `${model} ${column}`).toBeNull();
    });

    it("is idempotent: a second run changes no row, id and created_at included", async () => {
      await seedCatalogue(db, specs, descriptors);
      const first = await rows();
      const summary = await seedCatalogue(db, specs, descriptors);
      expect(await rows()).toEqual(first);
      expect(summary.tableCount).toBe(38);
    });
  });
});

describe("seedCatalogue's precedence, on a database that already holds descriptor values", () => {
  const POISON = `
    hump_placement = 'back_aggressive', shape = 'ergonomic',
    hand_compatibility = 'right', front_flare = 'flat', side_curvature = 'flat',
    thumb_rest = true, ring_finger_rest = true, descriptor_method = 'manual',
    descriptor_model = 'hand-edit', descriptor_source_urls = '["x"]'::jsonb,
    classified_at = '2026-01-01T00:00:00Z'`;

  beforeEach(async () => {
    await seedCatalogue(db, specs, []);
  });

  it("does not touch the four models with no record, whatever their columns hold", async () => {
    const quoted = NO_SHELL.map((m) => `'${m}'`).join(", ");
    await pg.exec(`UPDATE mice SET ${POISON} WHERE model IN (${quoted})`);
    const before = await rows();

    await seedCatalogue(db, specs, descriptors);
    const after = await rows();

    for (const model of NO_SHELL) {
      expect(byModel(after, model)).toEqual(byModel(before, model));
      expect(byModel(after, model).shape).toBe("ergonomic"); // really still set
    }
  });

  it("overwrites every descriptor column of a model the file lists, nulls included", async () => {
    await pg.exec(`UPDATE mice SET ${POISON} WHERE model = 'G203 Lightsync'`);

    await seedCatalogue(db, specs, descriptors);
    const row = byModel(await rows(), "G203 Lightsync");

    expect(row.hump_placement).toBe("back_minimal");
    for (const column of OTHER_DESCRIPTORS) expect(row[column]).toBeNull();
    expect(row.descriptor_model).toBe("geometry-gd1@06cc13d");
    expect(row.descriptor_source_urls).toEqual([]);
  });

  it("clears a model whose record is flagged needsReview, and leaves the rest as they were", async () => {
    await seedCatalogue(db, specs, descriptors);
    const before = await rows();

    const flagged = descriptors.map((d) =>
      d.model === "G203 Lightsync" ? { ...d, needsReview: true } : d,
    );
    const summary = await seedCatalogue(db, specs, flagged);
    const after = await rows();

    expect(seedSummaryLine(summary)).toContain(
      "Applied descriptors for 33/34 classified models (1 needing review cleared, not applied).",
    );
    for (const column of ALL_DESCRIPTOR_COLUMNS)
      expect(byModel(after, "G203 Lightsync")[column]).toBeNull();
    for (const row of before.filter((r) => r.model !== "G203 Lightsync"))
      expect(byModel(after, row.model)).toEqual(row);
  });

  it("refreshes dimensions on a re-seed without touching the descriptors of an unlisted model", async () => {
    await pg.exec(
      `UPDATE mice SET ${POISON}, length_mm = 1 WHERE model = 'M100'`,
    );
    await seedCatalogue(db, specs, descriptors);
    const m100 = byModel(await rows(), "M100");
    const spec = specs.find((s) => s.model === "M100")!;
    expect(Number(m100.length_mm)).toBe(spec.lengthMm);
    expect(m100.descriptor_model).toBe("hand-edit");
  });
});

describe("scripts/seed.ts", () => {
  it("still loads and skips cleanly outside a preview build (its imports resolve)", () => {
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const result = spawnSync(
      process.execPath,
      [
        join(repo, "node_modules", "tsx", "dist", "cli.mjs"),
        join(repo, "scripts", "seed.ts"),
        "--preview",
      ],
      {
        cwd: repo,
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, VERCEL_ENV: "" },
      },
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "Skipping preview seed outside the preview environment.",
    );
  });
});
