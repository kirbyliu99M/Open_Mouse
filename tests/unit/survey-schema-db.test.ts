/**
 * Migration 0007 (survey contributions) on a real Postgres (PGlite), with the
 * repo's own migrations: that the hand-wrapped SQL builds what drizzle's
 * snapshot says, that it is additive and re-runnable, and that the constraints
 * and cascades the privacy rules lean on are really in the database.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it, vi } from "vitest";
import {
  MIGRATION_FILES,
  applyMigrations,
  count,
  migratedDatabase,
  migrationStatements,
} from "./fixtures/pglite";
import {
  BRAND_A,
  BRAND_B,
  BRAND_OTHER,
  FEEL_RIGHT,
} from "./fixtures/survey-values";

// Each case starts a fresh in-process Postgres and applies every migration.
vi.setConfig({ testTimeout: 30_000 });

const MIGRATION_0007 = MIGRATION_FILES.findIndex((f) => f.startsWith("0007_"));

interface Snapshot {
  tables: Record<
    string,
    {
      columns: Record<string, { type: string; notNull: boolean }>;
      indexes: Record<string, { isUnique: boolean }>;
      foreignKeys: Record<string, unknown>;
      compositePrimaryKeys: Record<string, unknown>;
      uniqueConstraints: Record<string, unknown>;
      checkConstraints: Record<string, unknown>;
    }
  >;
}

const snapshot = JSON.parse(
  readFileSync(
    new URL("../../drizzle/meta/0007_snapshot.json", import.meta.url),
    "utf8",
  ),
) as Snapshot;

const UDT_OF_SNAPSHOT_TYPE: Record<string, string> = {
  uuid: "uuid",
  text: "text",
  "timestamp with time zone": "timestamptz",
  smallint: "int2",
  jsonb: "jsonb",
  boolean: "bool",
  grip_style: "grip_style",
};

const SURVEY_TABLES = [
  "survey_contributions",
  "survey_ratings",
  "survey_other_mice",
] as const;

const USER = "user-1";
const MOUSE_A = "20000000-0000-4000-8000-00000000000a";
const MOUSE_B = "20000000-0000-4000-8000-00000000000b";
const SESSION = "00000000-0000-4000-8000-00000000000a";
const SCAN = "10000000-0000-4000-8000-00000000000a";
const C1 = "30000000-0000-4000-8000-000000000001";
const C2 = "30000000-0000-4000-8000-000000000002";

async function seed(pg: PGlite) {
  await pg.exec(`
    insert into users (id) values ('${USER}');
    insert into mice (id, slug, brand, model, length_mm, width_mm, height_mm, size, source_url, spec_retrieved_at)
    values
      ('${MOUSE_A}', 'a', 'A', 'a', 120, 65, 38, 'medium', 'https://example.com/a', now()),
      ('${MOUSE_B}', 'b', 'B', 'b', 125, 68, 40, 'medium', 'https://example.com/b', now());
    insert into scan_sessions (id, user_id, expires_at) values ('${SESSION}', null, now() + interval '1 hour');
    insert into scans (id, session_id, hand) values ('${SCAN}', '${SESSION}', 'right');
  `);
}

const contribution = (
  id: string,
  over: Partial<Record<string, string>> = {},
): string => {
  const v = {
    user_id: "null",
    consent_version: "'v'",
    consented_at: "'2026-10-06T00:00:00Z'",
    hand_length_bin_mm: "180",
    palm_width_bin_mm: "80",
    grip_style: "'claw'",
    main_use: "null",
    feedback: "null",
    ...over,
  };
  return `insert into survey_contributions
    (id, user_id, consent_version, consented_at, hand_length_bin_mm, palm_width_bin_mm, grip_style, main_use, feedback)
    values ('${id}', ${v.user_id}, ${v.consent_version}, ${v.consented_at}, ${v.hand_length_bin_mm}, ${v.palm_width_bin_mm}, ${v.grip_style}, ${v.main_use}, ${v.feedback})`;
};

const rating = (
  contributionId: string,
  mouseId: string,
  over: Partial<Record<string, string>> = {},
): string => {
  const v = {
    user_id: "null",
    satisfaction: "4",
    pain_points: "'[]'",
    ...over,
  };
  return `insert into survey_ratings (contribution_id, mouse_id, user_id, satisfaction, pain_points)
    values ('${contributionId}', '${mouseId}', ${v.user_id}, ${v.satisfaction}, ${v.pain_points})`;
};

describe("migration 0007", () => {
  it("is one statement (the neon-http migrator has no transaction)", () => {
    expect(migrationStatements(MIGRATION_FILES[MIGRATION_0007]!)).toHaveLength(
      1,
    );
  });

  it("re-runs without error", async () => {
    const { pg } = await migratedDatabase();
    await expect(
      applyMigrations(pg, MIGRATION_0007, MIGRATION_0007 + 1),
    ).resolves.toBeUndefined();
    await pg.close();
  });

  it("is additive: scans written before it keep every column and read back, the new column null", async () => {
    const pg = new PGlite();
    await applyMigrations(pg, 0, MIGRATION_0007);
    await pg.exec(`
      insert into scan_sessions (id, expires_at) values ('${SESSION}', now() + interval '1 hour');
      insert into scans (id, session_id, hand, grip_style_stated) values ('${SCAN}', '${SESSION}', 'left', 'palm');
    `);
    await applyMigrations(pg, MIGRATION_0007, MIGRATION_0007 + 1);
    const { rows } = await pg.query<{
      hand: string;
      grip_style_stated: string;
      survey_contributed_at: Date | null;
    }>(`select hand, grip_style_stated, survey_contributed_at from scans`);
    expect(rows).toEqual([
      { hand: "left", grip_style_stated: "palm", survey_contributed_at: null },
    ]);
    // Code that predates 0007 inserts a scan without naming the new column.
    await pg.exec(
      `insert into scans (session_id, hand) values ('${SESSION}', 'right')`,
    );
    await pg.close();
  });

  it.each(SURVEY_TABLES)(
    "builds %s exactly as drizzle's snapshot describes it",
    async (table) => {
      const { pg } = await migratedDatabase();
      const expected = snapshot.tables[`public.${table}`]!;

      const columns = await pg.query<{
        column_name: string;
        udt_name: string;
        is_nullable: string;
      }>(
        `select column_name, udt_name, is_nullable from information_schema.columns where table_name = $1`,
        [table],
      );
      expect(
        Object.fromEntries(
          columns.rows.map((c) => [
            c.column_name,
            { type: c.udt_name, notNull: c.is_nullable === "NO" },
          ]),
        ),
      ).toEqual(
        Object.fromEntries(
          Object.entries(expected.columns).map(([name, c]) => [
            name,
            { type: UDT_OF_SNAPSHOT_TYPE[c.type], notNull: c.notNull },
          ]),
        ),
      );

      const constraints = await pg.query<{ conname: string; contype: string }>(
        `select conname, contype from pg_constraint where conrelid = $1::regclass`,
        [table],
      );
      const names = (type: string) =>
        constraints.rows
          .filter((c) => c.contype === type)
          .map((c) => c.conname)
          .sort();
      expect(names("f")).toEqual(Object.keys(expected.foreignKeys).sort());
      expect(names("c")).toEqual(Object.keys(expected.checkConstraints).sort());
      expect(names("u")).toEqual(
        Object.keys(expected.uniqueConstraints).sort(),
      );
      // The primary key: a composite one is named in the snapshot, a single
      // column one is Postgres' own `<table>_pkey`.
      expect(names("p")).toEqual(
        Object.keys(expected.compositePrimaryKeys).length > 0
          ? Object.keys(expected.compositePrimaryKeys).sort()
          : [`${table}_pkey`],
      );

      const indexes = await pg.query<{ indexname: string }>(
        `select indexname from pg_indexes where tablename = $1 and indexname not like '%_pkey' and indexname not like '%_pk'`,
        [table],
      );
      expect(indexes.rows.map((i) => i.indexname).sort()).toEqual(
        Object.keys(expected.indexes).sort(),
      );
      await pg.close();
    },
  );

  it("adds the nullable survey_contributed_at to scans, as the snapshot says", async () => {
    const { pg } = await migratedDatabase();
    const expected =
      snapshot.tables["public.scans"]!.columns["survey_contributed_at"]!;
    expect(expected).toMatchObject({
      type: "timestamp with time zone",
      notNull: false,
    });
    const { rows } = await pg.query<{ is_nullable: string }>(
      `select is_nullable from information_schema.columns where table_name = 'scans' and column_name = 'survey_contributed_at'`,
    );
    expect(rows).toEqual([{ is_nullable: "YES" }]);
    await pg.close();
  });
});

describe("what a contribution can never hold or point to", () => {
  it("has no scan or session column, and no foreign key to scans or scan_sessions", async () => {
    const { pg } = await migratedDatabase();
    const columns = await pg.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_name in ('survey_contributions', 'survey_ratings', 'survey_other_mice')`,
    );
    for (const c of columns.rows) {
      expect(c.column_name).not.toMatch(/scan|session/);
    }
    const fks = await pg.query<{ referenced: string }>(
      `select confrelid::regclass::text as referenced from pg_constraint
        where contype = 'f' and conrelid::regclass::text like 'survey_%'`,
    );
    expect(new Set(fks.rows.map((r) => r.referenced))).toEqual(
      new Set(["users", "mice", "survey_contributions"]),
    );
    await pg.close();
  });

  it("has no created_at or any timestamp but the day-grained consented_at", async () => {
    const { pg } = await migratedDatabase();
    const { rows } = await pg.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_name like 'survey_%' and udt_name in ('timestamptz', 'timestamp', 'date')`,
    );
    expect(rows).toEqual([{ column_name: "consented_at" }]);
    await pg.close();
  });
});

describe("constraints", () => {
  async function accepts(pg: PGlite, statement: string) {
    await expect(pg.exec(statement)).resolves.toBeDefined();
  }
  async function rejects(pg: PGlite, statement: string, constraint: string) {
    await expect(pg.exec(statement)).rejects.toThrow(constraint);
  }

  it("holds the hand profile to multiples of 5 inside the scan's own plausible range", async () => {
    const { pg } = await migratedDatabase();
    await accepts(pg, contribution(C1, { hand_length_bin_mm: "100" }));
    await accepts(
      pg,
      contribution(C2, { hand_length_bin_mm: "280", palm_width_bin_mm: "150" }),
    );
    for (const over of [
      { hand_length_bin_mm: "183" },
      { hand_length_bin_mm: "95" },
      { hand_length_bin_mm: "285" },
      { palm_width_bin_mm: "82" },
      { palm_width_bin_mm: "45" },
      { palm_width_bin_mm: "155" },
    ]) {
      await rejects(
        pg,
        contribution(crypto.randomUUID(), over),
        "survey_contributions_bins",
      );
    }
    await pg.close();
  });

  it("refuses a consent time finer than a day, so it cannot be matched to a scan by time", async () => {
    const { pg } = await migratedDatabase();
    await accepts(
      pg,
      contribution(C1, { consented_at: "'2026-10-06T00:00:00Z'" }),
    );
    for (const at of [
      "'2026-10-06T08:15:00Z'",
      "'2026-10-06T00:00:00.001Z'",
      "now()",
    ]) {
      await rejects(
        pg,
        contribution(crypto.randomUUID(), { consented_at: at }),
        "survey_contributions_consented_on_a_day",
      );
    }
    await pg.close();
  });

  it("bounds the free text and the other text columns", async () => {
    const { pg } = await migratedDatabase();
    await accepts(pg, contribution(C1, { feedback: `'${"x".repeat(500)}'` }));
    await rejects(
      pg,
      contribution(crypto.randomUUID(), { feedback: `'${"x".repeat(501)}'` }),
      "survey_contributions_feedback_length",
    );
    await rejects(
      pg,
      contribution(crypto.randomUUID(), { feedback: "''" }),
      "survey_contributions_feedback_length",
    );
    await rejects(
      pg,
      contribution(crypto.randomUUID(), { main_use: "''" }),
      "survey_contributions_main_use_length",
    );
    await rejects(
      pg,
      contribution(crypto.randomUUID(), { consent_version: "''" }),
      "survey_contributions_consent_version_set",
    );
    await pg.close();
  });

  it("keeps satisfaction in 1 to 5 and pain points an array", async () => {
    const { pg } = await migratedDatabase();
    await seed(pg);
    await pg.exec(contribution(C1));
    await accepts(pg, rating(C1, MOUSE_A, { satisfaction: "1" }));
    await accepts(pg, rating(C1, MOUSE_B, { satisfaction: "5" }));
    for (const satisfaction of ["0", "6"]) {
      await rejects(
        pg,
        `delete from survey_ratings; ${rating(C1, MOUSE_A, { satisfaction })}`,
        "survey_ratings_satisfaction_range",
      );
    }
    await rejects(
      pg,
      `delete from survey_ratings; ${rating(C1, MOUSE_A, { pain_points: `'{"a":1}'` })}`,
      "survey_ratings_pain_points_array",
    );
    await pg.close();
  });

  it("holds a signed-in person to one rating per mouse across contributions, but not an anonymous one", async () => {
    const { pg } = await migratedDatabase();
    await seed(pg);
    await pg.exec(contribution(C1, { user_id: `'${USER}'` }));
    await pg.exec(contribution(C2, { user_id: `'${USER}'` }));
    await accepts(pg, rating(C1, MOUSE_A, { user_id: `'${USER}'` }));
    await rejects(
      pg,
      rating(C2, MOUSE_A, { user_id: `'${USER}'` }),
      "survey_ratings_user_mouse_unique",
    );
    await accepts(pg, rating(C2, MOUSE_B, { user_id: `'${USER}'` }));
    // Anonymous: any number of ratings of the same mouse, from separate contributions.
    const A1 = crypto.randomUUID();
    const A2 = crypto.randomUUID();
    await pg.exec(contribution(A1));
    await pg.exec(contribution(A2));
    await accepts(pg, rating(A1, MOUSE_A));
    await accepts(pg, rating(A2, MOUSE_A));
    // A contribution rates a mouse once.
    await rejects(
      pg,
      rating(A1, MOUSE_A),
      "survey_ratings_contribution_id_mouse_id_pk",
    );
    await pg.close();
  });

  it("holds a signed-in person to one other mouse per brand slug, matched exactly, and bounds the brand", async () => {
    const { pg } = await migratedDatabase();
    await seed(pg);
    await pg.exec(contribution(C1, { user_id: `'${USER}'` }));
    await pg.exec(contribution(C2, { user_id: `'${USER}'` }));
    const other = (c: string, brand: string, user = `'${USER}'`) =>
      `insert into survey_other_mice (contribution_id, user_id, brand, size_feel) values ('${c}', ${user}, '${brand}', '${FEEL_RIGHT}')`;
    await accepts(pg, other(C1, BRAND_A));
    await rejects(
      pg,
      other(C2, BRAND_A),
      "survey_other_mice_user_brand_unique",
    );
    await accepts(pg, other(C2, BRAND_B));
    // Every brand that is not listed is the one slug `other`: once per person.
    await accepts(pg, other(C1, BRAND_OTHER));
    await rejects(
      pg,
      other(C2, BRAND_OTHER),
      "survey_other_mice_user_brand_unique",
    );
    // Exact, not the free-text days' lower(btrim(...)): the index holds the two
    // columns as they are. (The body schema only lets a listed slug through, so
    // a differently cased value never reaches here; this pins the index.)
    await accepts(pg, other(C2, BRAND_A.toUpperCase()));
    const { rows: indexes } = await pg.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where indexname = 'survey_other_mice_user_brand_unique'`,
    );
    expect(indexes).toHaveLength(1);
    expect(indexes[0]!.indexdef).not.toMatch(/lower|btrim/i);
    // Anonymous: the same brand can be there many times.
    await accepts(pg, other(C1, BRAND_A, "null"));
    await accepts(pg, other(C2, BRAND_A, "null"));
    // The column's own length bound (1 to 32), which does not follow the
    // contract: a brand is a short slug, and the list is the schema's to hold.
    await accepts(pg, other(C1, "x".repeat(32), "null"));
    await rejects(pg, other(C1, "", "null"), "survey_other_mice_brand_length");
    await rejects(
      pg,
      other(C1, "x".repeat(33), "null"),
      "survey_other_mice_brand_length",
    );
    await pg.close();
  });
});

describe("deletion paths", () => {
  async function withContributions() {
    const { pg } = await migratedDatabase();
    await seed(pg);
    await pg.exec(`
      ${contribution(C1, { user_id: `'${USER}'`, feedback: "'kept'" })};
      ${rating(C1, MOUSE_A, { user_id: `'${USER}'` })};
      insert into survey_other_mice (contribution_id, user_id, brand, size_feel) values ('${C1}', '${USER}', '${BRAND_A}', '${FEEL_RIGHT}');
      ${contribution(C2)};
      ${rating(C2, MOUSE_B)};
    `);
    return pg;
  }
  const n = (pg: PGlite, table: string) =>
    count(pg, `select count(*)::int as n from ${table}`);

  it("deleting a user removes their contributions, ratings and other mice, and nobody else's", async () => {
    const pg = await withContributions();
    await pg.exec(`delete from users where id = '${USER}'`);
    expect(await n(pg, "survey_contributions")).toBe(1);
    expect(await n(pg, "survey_ratings")).toBe(1);
    expect(await n(pg, "survey_other_mice")).toBe(0);
    await pg.close();
  });

  it("deleting the contribution removes its ratings and other mice", async () => {
    const pg = await withContributions();
    await pg.exec(`delete from survey_contributions where id = '${C1}'`);
    expect(await n(pg, "survey_ratings")).toBe(1);
    expect(await n(pg, "survey_other_mice")).toBe(0);
    await pg.close();
  });

  it("the anonymous expiry (deleting the session) takes the scan and its mark, and leaves every contribution", async () => {
    const pg = await withContributions();
    await pg.exec(
      `update scans set survey_contributed_at = now() where id = '${SCAN}'`,
    );
    await pg.exec(`delete from scan_sessions where id = '${SESSION}'`);
    expect(await n(pg, "scans")).toBe(0);
    expect(await n(pg, "survey_contributions")).toBe(2);
    expect(await n(pg, "survey_ratings")).toBe(2);
    expect(await n(pg, "survey_other_mice")).toBe(1);
    await pg.close();
  });

  it("deleting a scan leaves the contribution made from it", async () => {
    const pg = await withContributions();
    await pg.exec(`delete from scans where id = '${SCAN}'`);
    expect(await n(pg, "survey_contributions")).toBe(2);
    await pg.close();
  });

  it("removing a catalogue mouse removes the ratings of it, not the rest of the contribution", async () => {
    const pg = await withContributions();
    await pg.exec(`delete from mice where id = '${MOUSE_A}'`);
    expect(await n(pg, "survey_ratings")).toBe(1);
    expect(await n(pg, "survey_contributions")).toBe(2);
    await pg.close();
  });
});
