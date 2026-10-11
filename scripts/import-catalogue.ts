/**
 * Local-only: turns the adjudicated candidate list into the committed seed
 * `src/db/seed/catalogue.json`. Never runs in CI and never in a build.
 *
 *   npx tsx scripts/import-catalogue.ts [path/to/approved-candidates.csv]
 *   npx prettier --write src/db/seed/catalogue.json
 *
 * The CSV lives outside the repo (AGENTS.md rule 1, revised 2026-10-08) and
 * carries values from a public compilation; only the generated JSON is
 * committed. The mapping is in src/server/catalogue/candidate-map.ts.
 *
 * The local dataset CSV is read from CATALOGUE_DATASET_CSV, and Kirby's
 * official URL list from CATALOGUE_OFFICIAL_URLS_CSV (defaults below). The
 * list supplies the source URL of a candidate with no official URL of its own;
 * a candidate the list does not have fails the import.
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
  buildOfficialUrlIndex,
  comparePageConnectivity,
  isKnownConnectivity,
  lookupOfficialUrl,
  OFFICIAL_CONNECTIVITY,
  TRACKBALL_NAME_PATTERN,
  type CandidateRecord,
  type OfficialUrlRow,
} from "../src/server/catalogue/candidate-map";

const DEFAULT_CSV =
  "C:/Users/kirby/Desktop/Mouse Shape Project/catalogue-agy/approved-candidates.csv";
const DATASET_CSV =
  process.env.CATALOGUE_DATASET_CSV ??
  "C:/Users/kirby/Desktop/Mouse Shape Project/Dataset/third_party_mouse_data.csv";
const OFFICIAL_URLS_CSV =
  process.env.CATALOGUE_OFFICIAL_URLS_CSV ??
  "C:/Users/kirby/Desktop/Mouse Shape Project/catalogue-agy/mouse_official_urls.csv";
const SAVED_PAGES_DIR =
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
 * Fills `connectivity` on each record from the local sources: the dataset
 * CSV for `compiled_csv`, the saved compare pages for `compiled_site`, the
 * brand's own page (OFFICIAL_CONNECTIVITY) for
 * `official`. File I/O only; the matching is in connectivity-match.ts.
 * Returns what it could not find.
 */
function attachConnectivity(records: CandidateRecord[]): string[] {
  const index = buildCsvIndex(
    parseCsv(readFileSync(DATASET_CSV, "utf8")) as unknown as DatasetRow[],
  );
  const titles = parseCsv(
    readFileSync(`${SAVED_PAGES_DIR}/elo-new.csv`, "utf8"),
  )
    .filter((r) => r.status === "200")
    .map((r) => ({ title: r.title, slug: r.slug }));
  const missing: string[] = [];
  for (const rec of records) {
    const label = `${rec.brand} ${rec.model}`;
    let raw: string | undefined;
    if (rec.source === "compiled_csv") {
      raw = lookupCsvConnectivity(index, rec.brand, rec.model);
    } else if (rec.source === "compiled_site") {
      const slug = matchSiteTitle(titles, rec.brand, rec.model);
      const file = slug ? `${SAVED_PAGES_DIR}/raw/${slug}.html` : "";
      if (file && existsSync(file)) {
        raw = comparePageConnectivity(
          pageTextLines(readFileSync(file, "utf8")),
        );
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
  const officialUrls = buildOfficialUrlIndex(
    parseCsv(readFileSync(OFFICIAL_URLS_CSV, "utf8")).map(
      (r): OfficialUrlRow => ({
        brand: r.brand ?? "",
        model: r.model ?? "",
        officialUrl: r.official_url ?? "",
        urlType: r.url_type ?? "",
      }),
    ),
  );
  const entries = buildCatalogue(
    records,
    seedModels,
    RETRIEVED_AT,
    undefined,
    officialUrls,
  );
  const fromList = records.filter((r) => r.officialUrl.trim() === "");
  console.log(
    `Source URL from the official URL list: ${fromList.length} candidates.`,
  );
  for (const r of fromList) {
    const row = lookupOfficialUrl(officialUrls, r.brand, r.model);
    if (row && row.urlType !== "direct_product_page")
      console.log(`  ${r.brand} ${r.model}: ${row.urlType}`);
  }
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
