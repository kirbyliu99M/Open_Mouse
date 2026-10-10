/**
 * Local-only: turns the adjudicated candidate list into the committed seed
 * `src/db/seed/catalogue.json`. Never runs in CI and never in a build.
 *
 *   npx tsx scripts/import-catalogue.ts [path/to/approved-candidates.csv]
 *   npx prettier --write src/db/seed/catalogue.json
 *
 * The CSV lives outside the repo (AGENTS.md rule 1, revised 2026-10-08) and
 * carries EloShapes values; only the generated JSON is committed. The mapping
 * is in src/server/catalogue/candidate-map.ts.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  buildCsvIndex,
  lookupCsvConnectivity,
  matchSiteTitle,
  pageTextLines,
  type DatasetRow,
} from "../src/server/catalogue/connectivity-match";
import { parseCsv } from "../src/server/catalogue/csv";
import {
  buildCatalogue,
  eloPageConnectivity,
  isKnownConnectivity,
  OFFICIAL_CONNECTIVITY,
  TRACKBALL_NAME_PATTERN,
  type CandidateRecord,
} from "../src/server/catalogue/candidate-map";

const DEFAULT_CSV =
  "C:/Users/kirby/Desktop/Mouse Shape Project/catalogue-agy/approved-candidates.csv";
const ELO_DATASET =
  "C:/Users/kirby/Desktop/Mouse Shape Project/Dataset/eloshapes_mouse_data.csv";
const ELO_SITE_DIR =
  "C:/Users/kirby/Desktop/Mouse Shape Project/catalogue-agy/elo";
const OUT = "src/db/seed/catalogue.json";
/** The day Claude and Kirby adjudicated the list. */
const RETRIEVED_AT = "2026-10-09T00:00:00.000Z";

const COLUMNS = [
  "descriptorBasis",
  "brand",
  "model",
  "officialUrl",
  "source",
  "lengthMm",
  "widthMm",
  "heightMm",
  "weightG",
  "size",
  "shape",
  "hand",
  "hump",
  "flare",
  "sideCurvature",
  "thumbRest",
] as const;

/**
 * Fills `connectivity` on each record from the local EloShapes sources:
 * the dataset CSV for `eloshapes_csv`, the saved compare pages for
 * `eloshapes_site`, the brand's own page (OFFICIAL_CONNECTIVITY) for
 * `official`. File I/O only; the matching is in connectivity-match.ts.
 * Returns what it could not find.
 */
function attachConnectivity(records: CandidateRecord[]): string[] {
  const index = buildCsvIndex(
    parseCsv(readFileSync(ELO_DATASET, "utf8")) as unknown as DatasetRow[],
  );
  const titles = parseCsv(readFileSync(`${ELO_SITE_DIR}/elo-new.csv`, "utf8"))
    .filter((r) => r.status === "200")
    .map((r) => ({ title: r.title, slug: r.slug }));
  const missing: string[] = [];
  for (const rec of records) {
    const label = `${rec.brand} ${rec.model}`;
    let raw: string | undefined;
    if (rec.source === "eloshapes_csv") {
      raw = lookupCsvConnectivity(index, rec.brand, rec.model);
    } else if (rec.source === "eloshapes_site") {
      const slug = matchSiteTitle(titles, rec.brand, rec.model);
      const file = slug ? `${ELO_SITE_DIR}/raw/${slug}.html` : "";
      if (file && existsSync(file)) {
        raw = eloPageConnectivity(pageTextLines(readFileSync(file, "utf8")));
      }
    } else {
      raw = OFFICIAL_CONNECTIVITY[rec.officialUrl.trim()];
    }
    if (raw === undefined || raw === "")
      missing.push(`${rec.source}: ${label}`);
    rec.connectivity = raw ?? "";
  }
  return missing;
}

function main() {
  const csvPath = process.argv[2] ?? DEFAULT_CSV;
  const rows = parseCsv(readFileSync(csvPath, "utf8"));
  const header = Object.keys(rows[0] ?? {});
  for (const column of COLUMNS) {
    if (!header.includes(column)) {
      throw new Error(`${csvPath} has no "${column}" column`);
    }
  }
  const records = rows as unknown as CandidateRecord[];
  const seedModels = (
    JSON.parse(readFileSync("src/db/seed/logitech.json", "utf8")) as {
      model: string;
    }[]
  ).map((r) => r.model);

  const missing = attachConnectivity(records);
  const unknown = records.filter((r) => !isKnownConnectivity(r.connectivity));
  const entries = buildCatalogue(records, seedModels, RETRIEVED_AT);
  writeFileSync(OUT, JSON.stringify(entries, null, 2) + "\n");

  const count = (v: string | null) =>
    entries.filter((e) => e.connectivity === v).length;
  console.log(
    `Connectivity: wired ${count("wired")}, wireless ${count("wireless")}, null ${count(null)}; unrecognised spellings ${unknown.length}.`,
  );
  console.log(`No connectivity found (${missing.length}):`);
  for (const m of missing) console.log(`  ${m}`);
  const seedRows = JSON.parse(
    readFileSync("src/db/seed/logitech.json", "utf8"),
  ) as { model: string; connectivity?: string }[];
  console.log("Logitech disagreements (seed value kept):");
  for (const e of entries.filter((x) => x.mergesInto)) {
    const seed = seedRows.find((r) => r.model === e.mergesInto)?.connectivity;
    if (
      seed !== undefined &&
      e.connectivity !== null &&
      seed !== e.connectivity
    ) {
      console.log(`  ${e.model}: seed ${seed}, candidate ${e.connectivity}`);
    }
  }

  const brands = new Map<string, number>();
  for (const e of entries) brands.set(e.brand, (brands.get(e.brand) ?? 0) + 1);
  console.log(`Wrote ${entries.length} entries to ${OUT}.`);
  console.log(
    [...brands].map(([brand, n]) => `${brand}: ${n}`).join(", ") || "(none)",
  );
  console.log("Merged into logitech.json rows:");
  for (const e of entries.filter((x) => x.mergesInto)) {
    console.log(
      `  ${e.model} -> ${e.mergesInto}${e.model === e.mergesInto ? "" : "  (alias)"}`,
    );
  }
  const names = entries.filter((e) =>
    TRACKBALL_NAME_PATTERN.test(`${e.brand} ${e.model}`),
  );
  console.log(
    `Names that look like trackballs: ${names.map((e) => `${e.brand} ${e.model}`).join(", ") || "none"}`,
  );
  console.log("Now run: npx prettier --write src/db/seed/catalogue.json");
}

main();
