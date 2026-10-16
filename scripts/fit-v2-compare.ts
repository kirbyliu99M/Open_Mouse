/**
 * v1 vs v2 (structure prototype, candidate) comparison on the four golden
 * hands and the 38-row test catalogue.
 *
 *   npx tsx scripts/fit-v2-compare.ts
 *   npx tsx scripts/fit-v2-compare.ts --real
 *
 * Prints markdown to stdout. The v2 default is the FRAME (no EXIF) scenario:
 * simulated Sigma_input and bias vector from the scan error budget; the report
 * gives the top-5 probabilities under it (with the EXIF comparison and the
 * nominal-focal-prior candidate beside them) and lists, per hand, what differs
 * between the v2 default and the v1-equivalent setting. Local and
 * deterministic (the resampling uses a seeded PRNG); no network, no database. `--real` reads the listed rows of the
 * seed built from the checked-in src/db/seed/*.json, exactly as
 * scripts/fit-stability.ts does: it needs neither a database nor ../Dataset.
 * The report is built by the pure `buildCompareReportV2`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildSeedRows,
  toCatalogueMouse,
} from "../src/server/catalogue/catalogue-rows";
import {
  buildCompareReportV2,
  type CompareHand,
} from "../src/server/fit/compare-report-v2";
import { listedOnly } from "../src/server/fit/listed";
import { buildSeedCatalogue } from "../src/server/fit/seed-catalogue";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const readJson = (rel: string): unknown =>
  JSON.parse(readFileSync(here(rel), "utf8"));

const golden = readJson("../tests/unit/fixtures/fit-golden.json") as Record<
  string,
  CompareHand
>;

const seedCatalogue = () =>
  buildSeedCatalogue(
    readJson("../src/db/seed/logitech.json") as Parameters<
      typeof buildSeedCatalogue
    >[0],
    readJson("../src/db/seed/logitech-facts.json") as Parameters<
      typeof buildSeedCatalogue
    >[1],
  );

const realCatalogue = () => {
  const built = buildSeedRows(
    readJson("../src/db/seed/logitech.json") as Parameters<
      typeof buildSeedRows
    >[0],
    readJson("../src/db/seed/logitech-descriptors.json") as Parameters<
      typeof buildSeedRows
    >[1],
    {
      facts: readJson("../src/db/seed/logitech-facts.json") as never,
      entries: readJson("../src/db/seed/catalogue.json") as never,
    },
  );
  return listedOnly(
    [...built.withDescriptors, ...built.withoutDescriptors].map((r) =>
      toCatalogueMouse(r),
    ),
  );
};

if (process.argv.includes("--real")) {
  process.stdout.write(
    buildCompareReportV2(
      realCatalogue(),
      golden,
      "the listed rows of the full seed, with descriptors",
    ),
  );
} else {
  process.stdout.write(buildCompareReportV2(seedCatalogue(), golden));
}
