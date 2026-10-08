/**
 * Fit stability report (docs/fit-algorithm.md section 8): how much the ranking
 * moves when a hand measurement moves by a plausible error, for fit-v0 and the
 * fit-v1 candidate on the same catalogue.
 *
 *   npx tsx scripts/fit-stability.ts
 *
 * Prints markdown to stdout. Local and deterministic: no network, no database,
 * no clock, no randomness. The report itself is built by the pure
 * `buildStabilityReport` (src/server/fit/stability-report.ts); this file only
 * reads the inputs. The catalogue is the checked-in 38-model seed with every
 * descriptor unknown (the one tests/unit/fit-golden.test.ts uses) and the form
 * factors of src/db/seed/logitech-facts.json; the hands are the four golden
 * hands.
 *
 * The acceptance threshold for "rigid" is Kirby's (未拍板); the candidate in the
 * spec is a top-5 Jaccard of at least 0.6 at ±5 mm.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
const catalogue = buildSeedCatalogue(
  readJson("../src/db/seed/logitech.json") as Parameters<
    typeof buildSeedCatalogue
  >[0],
  readJson("../src/db/seed/logitech-facts.json") as Parameters<
    typeof buildSeedCatalogue
  >[1],
);

process.stdout.write(buildStabilityReport(catalogue, golden));
