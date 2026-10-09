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
import { readFileSync, writeFileSync } from "node:fs";
import { parseCsv } from "../src/server/catalogue/csv";
import {
  buildCatalogue,
  TRACKBALL_NAME_PATTERN,
  type CandidateRecord,
} from "../src/server/catalogue/candidate-map";

const DEFAULT_CSV =
  "C:/Users/kirby/Desktop/Mouse Shape Project/catalogue-agy/approved-candidates.csv";
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

  const entries = buildCatalogue(records, seedModels, RETRIEVED_AT);
  writeFileSync(OUT, JSON.stringify(entries, null, 2) + "\n");

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
