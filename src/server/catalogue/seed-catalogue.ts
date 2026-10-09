/**
 * The seed's database writes, split out of scripts/seed.ts so a test can run
 * the real upserts against a real Postgres (PGlite) instead of a copy of the
 * SQL. scripts/seed.ts reads the files, opens the Neon connection and calls
 * `seedCatalogue`; nothing else lives there.
 *
 * Two upserts, because a model the descriptors file lists and one it does not
 * must behave differently (see `partitionByDescriptors`): the first leaves the
 * descriptor columns out of its conflict `set`, so whatever the database holds
 * survives; the second overwrites every descriptor column unconditionally with
 * the file's values, nulls included.
 */
import { sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { mice } from "../../db/schema";
import { buildSeedRows, type CatalogueSeedInput } from "./catalogue-rows";
import type { DescriptorRecord, SpecRecord } from "./seed-rows";

/** What `seedCatalogue` needs of a database: the Neon HTTP driver in production, PGlite in tests. */
export type SeedDb = Pick<NeonHttpDatabase, "insert" | "execute">;

const DIMENSION_SET = {
  lengthMm: sql`excluded.length_mm`,
  widthMm: sql`excluded.width_mm`,
  heightMm: sql`excluded.height_mm`,
  weightG: sql`excluded.weight_g`,
  connectivity: sql`excluded.connectivity`,
  size: sql`excluded.size`,
  sourceUrl: sql`excluded.source_url`,
  specRetrievedAt: sql`excluded.spec_retrieved_at`,
  // CAT-1: the seed decides these five on every run, so a change to which
  // models are listed (or to a form factor fact) reaches the database.
  category: sql`excluded.category`,
  listed: sql`excluded.listed`,
  formFactor: sql`excluded.form_factor`,
  imagePath: sql`excluded.image_path`,
  dataSource: sql`excluded.data_source`,
};

/** Rows per INSERT: keeps one statement well under Postgres's 65 535-parameter limit (about 30 columns each). */
const INSERT_CHUNK = 100;

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += INSERT_CHUNK) {
    out.push(items.slice(i, i + INSERT_CHUNK));
  }
  return out;
}

const DESCRIPTOR_SET = {
  shape: sql`excluded.shape`,
  handCompatibility: sql`excluded.hand_compatibility`,
  humpPlacement: sql`excluded.hump_placement`,
  frontFlare: sql`excluded.front_flare`,
  sideCurvature: sql`excluded.side_curvature`,
  thumbRest: sql`excluded.thumb_rest`,
  ringFingerRest: sql`excluded.ring_finger_rest`,
  descriptorMethod: sql`excluded.descriptor_method`,
  descriptorModel: sql`excluded.descriptor_model`,
  descriptorSourceUrls: sql`excluded.descriptor_source_urls`,
  classifiedAt: sql`excluded.classified_at`,
};

export interface SeedSummary {
  /** Rows upserted: spec records with all three dimensions, plus imported candidates. */
  seeded: number;
  /** Spec records skipped for a missing dimension. */
  skipped: number;
  /** Rows in `mice` after the run. */
  tableCount: number;
  /** Records in the descriptors file. */
  descriptorRecords: number;
  /** Of those, the ones applied (not needsReview). */
  descriptorsApplied: number;
  /** Candidate entries that became rows of their own (0 without a catalogue file). */
  catalogueImported: number;
  /** Candidate entries merged into a `logitech.json` row. */
  catalogueMerged: number;
  /** Rows written with `listed = false`. */
  unlisted: number;
}

export async function seedCatalogue(
  db: SeedDb,
  records: readonly SpecRecord[],
  descriptors: readonly DescriptorRecord[],
  input: CatalogueSeedInput = {},
): Promise<SeedSummary> {
  const built = buildSeedRows(records, descriptors, input);
  const { withDescriptors, withoutDescriptors } = built;

  for (const rows of chunks(withoutDescriptors)) {
    await db
      .insert(mice)
      .values(rows)
      .onConflictDoUpdate({
        target: [mice.brand, mice.model],
        set: DIMENSION_SET,
      });
  }
  for (const rows of chunks(withDescriptors)) {
    await db
      .insert(mice)
      .values(rows)
      .onConflictDoUpdate({
        target: [mice.brand, mice.model],
        set: { ...DIMENSION_SET, ...DESCRIPTOR_SET },
      });
  }

  const [{ count }] = (
    await db.execute(sql`SELECT count(*)::int AS count FROM mice`)
  ).rows as [{ count: number }];
  const written = [...withDescriptors, ...withoutDescriptors];
  return {
    seeded: written.length,
    skipped: built.skipped,
    tableCount: count,
    descriptorRecords: descriptors.length,
    descriptorsApplied: descriptors.filter((d) => !d.needsReview).length,
    catalogueImported: built.imported,
    catalogueMerged: built.merged,
    unlisted: written.filter((r) => !r.listed).length,
  };
}

/** The line `npm run db:seed` prints. */
export function seedSummaryLine(s: SeedSummary): string {
  return (
    `Seeded ${s.seeded} mice (${s.skipped} skipped for missing dimensions); table now holds ${s.tableCount}.` +
    (s.descriptorRecords
      ? ` Applied descriptors for ${s.descriptorsApplied}/${s.descriptorRecords} classified models (${s.descriptorRecords - s.descriptorsApplied} needing review cleared, not applied).`
      : "") +
    (s.catalogueImported + s.catalogueMerged > 0
      ? ` Catalogue: ${s.catalogueImported} imported, ${s.catalogueMerged} merged into first-party rows; ${s.unlisted} unlisted.`
      : "")
  );
}
