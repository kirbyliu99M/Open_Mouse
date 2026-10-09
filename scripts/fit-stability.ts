/**
 * Fit stability report (docs/fit-algorithm.md section 8): how much the ranking
 * moves when a hand measurement moves by a plausible error, for fit-v0 and the
 * fit-v1 candidate on the same catalogue.
 *
 *   npx tsx scripts/fit-stability.ts
 *   npx tsx scripts/fit-stability.ts --real
 *
 * Prints markdown to stdout. Local and deterministic: no network, no database,
 * no clock, no randomness. The report itself is built by the pure
 * `buildStabilityReport` (src/server/fit/stability-report.ts); this file only
 * reads the inputs. The catalogue is the checked-in 38-model seed with every
 * descriptor unknown (the one tests/unit/fit-golden.test.ts uses) and the form
 * factors of src/db/seed/logitech-facts.json; the hands are the four golden
 * hands.
 *
 * With `--real` the catalogue is instead the listed rows of the full seed
 * (logitech.json merged with catalogue.json and the descriptors, as the seed
 * script builds them), the same one the calibration evidence uses.
 *
 * The acceptance threshold for "rigid" is Kirby's (未拍板); the candidate in the
 * spec is a top-5 Jaccard of at least 0.6 at ±5 mm.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildSeedRows,
  toCatalogueMouse,
} from "../src/server/catalogue/catalogue-rows";
import { listedOnly } from "../src/server/fit/listed";
import { buildSeedCatalogue } from "../src/server/fit/seed-catalogue";
import {
  buildStabilityReport,
  type ReportHand,
} from "../src/server/fit/stability-report";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const readJson = (rel: string): unknown =>
  JSON.parse(readFileSync(here(rel), "utf8"));

const golden = readJson("../tests/unit/fixtures/fit-golden.json") as Record<
  string,
  ReportHand
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
    buildStabilityReport(
      realCatalogue(),
      golden,
      "the listed rows of the full seed, with descriptors",
    ),
  );
} else {
  process.stdout.write(buildStabilityReport(seedCatalogue(), golden));
}
