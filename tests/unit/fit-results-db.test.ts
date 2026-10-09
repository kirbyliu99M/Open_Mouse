/**
 * `fit_results` against a real Postgres (PGlite) with the repo's migrations:
 * `saveFitResults` must leave exactly the rows it was given for a scan and
 * engine version. A mouse that was ranked on an earlier load and is now a
 * same-shell variant (SHELL-1) must not keep its old row or its old rank.
 */
import { describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });
vi.mock("server-only", () => ({}));

import { createDrizzleFitRepo } from "../../src/server/fit/drizzle-repo";
import type { FitResultRow } from "../../src/server/fit/rows";
import { migratedDatabase, withSequentialBatch } from "./fixtures/pglite";

type FitDb = Parameters<typeof createDrizzleFitRepo>[0];

const ENGINE = "fit-v0-provisional";
const MICE = ["a", "b", "c", "d"].map((slug, i) => ({
  slug,
  id: `00000000-0000-4000-8000-00000000010${i}`,
}));
const id = (slug: string) => MICE.find((m) => m.slug === slug)!.id;

const row = (
  scanId: string,
  slug: string,
  rank: number,
  engineVersion = ENGINE,
): FitResultRow => ({
  scanId,
  mouseId: id(slug),
  engineVersion,
  rank,
  totalScore: 90 - rank,
  lengthScore: 80,
  gripWidthScore: 75,
  heightHumpScore: 90,
  frontFlareScore: 80,
  thumbScore: 100,
  weightScore: 70,
  reasons: {} as FitResultRow["reasons"],
});

async function world() {
  const { pg, db } = await migratedDatabase();
  for (const m of MICE) {
    await pg.query(
      `INSERT INTO mice (id, slug, brand, model, length_mm, width_mm, height_mm, size, source_url, spec_retrieved_at)
       VALUES ($1, $2, 'Acme', $2, 120, 65, 40, 'medium', 'https://example.test', now())`,
      [m.id, m.slug],
    );
  }
  const session = await pg.query<{ id: string }>(
    `INSERT INTO scan_sessions (expires_at) VALUES (now() + interval '1 hour') RETURNING id`,
  );
  const scans: string[] = [];
  for (const n of [1, 2]) {
    const scanId = `00000000-0000-4000-8000-00000000020${n}`;
    await pg.query(
      `INSERT INTO scans (id, session_id, hand) VALUES ($1, $2, 'right')`,
      [scanId, session.rows[0]!.id],
    );
    scans.push(scanId);
  }
  const repo = createDrizzleFitRepo(withSequentialBatch<FitDb>(db));
  const stored = async (scanId: string, engineVersion = ENGINE) =>
    (
      await pg.query<{ slug: string; rank: number; total_score: number }>(
        `SELECT m.slug, f.rank, f.total_score
           FROM fit_results f JOIN mice m ON m.id = f.mouse_id
          WHERE f.scan_id = $1 AND f.engine_version = $2
          ORDER BY f.rank`,
        [scanId, engineVersion],
      )
    ).rows;
  return { pg, repo, stored, scans: scans as [string, string] };
}

describe("createDrizzleFitRepo().saveFitResults against Postgres", () => {
  it("a smaller second set, with a mouse merged into a variant, leaves exactly the second set with ranks 1..n", async () => {
    const { pg, repo, stored, scans } = await world();
    const [scan] = scans;

    await repo.saveFitResults([
      row(scan, "a", 1),
      row(scan, "b", 2),
      row(scan, "c", 3),
      row(scan, "d", 4),
    ]);
    expect(await stored(scan)).toHaveLength(4);

    // "b" is now a variant of "a": gone, and "c" and "d" move up.
    await repo.saveFitResults([
      row(scan, "a", 1),
      row(scan, "c", 2),
      row(scan, "d", 3),
    ]);

    expect(await stored(scan)).toEqual([
      { slug: "a", rank: 1, total_score: 89 },
      { slug: "c", rank: 2, total_score: 88 },
      { slug: "d", rank: 3, total_score: 87 },
    ]);
    await pg.close();
  });

  it("saving the same set twice is idempotent", async () => {
    const { pg, repo, stored, scans } = await world();
    const set = [row(scans[0], "a", 1), row(scans[0], "b", 2)];
    await repo.saveFitResults(set);
    await repo.saveFitResults(set);
    expect((await stored(scans[0])).map((r) => r.slug)).toEqual(["a", "b"]);
    await pg.close();
  });

  it("never touches another scan's rows or another engine version's rows", async () => {
    const { pg, repo, stored, scans } = await world();
    const [scan1, scan2] = scans;
    await repo.saveFitResults([row(scan2, "a", 1), row(scan2, "b", 2)]);
    await repo.saveFitResults([
      row(scan1, "a", 1, "fit-v1"),
      row(scan1, "b", 2, "fit-v1"),
    ]);
    await repo.saveFitResults([row(scan1, "a", 1), row(scan1, "b", 2)]);

    await repo.saveFitResults([row(scan1, "a", 1)]);

    expect((await stored(scan1)).map((r) => r.slug)).toEqual(["a"]);
    expect((await stored(scan1, "fit-v1")).map((r) => r.slug)).toEqual([
      "a",
      "b",
    ]);
    expect((await stored(scan2)).map((r) => r.slug)).toEqual(["a", "b"]);
    await pg.close();
  });
});
