/**
 * Scan error budget (SIMULATION, not measurement): a Monte-Carlo run of the
 * real scan pipeline on synthetic scenes, to see how many mm each error source
 * contributes to handLengthMm and palmWidthMm.
 *
 *   npx tsx scripts/scan-error-budget.ts
 *   npx tsx scripts/scan-error-budget.ts --json out/scan-error-budget.json
 *   npx tsx scripts/scan-error-budget.ts --n 500 --seed 7
 *
 * Prints Markdown to stdout (about 2 minutes at the default N = 2000). The
 * primary scenario is the frame capture without EXIF; the tilt cap is swept
 * (10 / 20 / 30 / 45 degrees) because the real tilt distribution is unknown,
 * and the candidate nominal-focal-prior fix is compared with the current
 * policy. Local and deterministic (a fixed seed, no network, no clock, no
 * files read); not part of CI. The synthetic world is in
 * scan-error-budget-core.ts and the conditions and rendering in
 * scan-error-budget-report.ts; those are the parts the unit tests cover.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SIGMA_MEAS_MM } from "../src/server/fit/coefficients";
import { buildErrorBudget, renderMarkdown } from "./scan-error-budget-report";

const DEFAULT_SEED = 20261016;
const DEFAULT_N = 2000;

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const n = Number(argValue("--n") ?? DEFAULT_N);
const seed = Number(argValue("--seed") ?? DEFAULT_SEED);
const jsonPath = argValue("--json");
if (!Number.isInteger(n) || n < 2 || !Number.isInteger(seed)) {
  console.error(
    "Usage: scan-error-budget.ts [--n <integer >= 2>] [--seed <integer>] [--json <path>]",
  );
  process.exit(1);
}

const report = buildErrorBudget(seed, n, SIGMA_MEAS_MM);
console.log(renderMarkdown(report));
if (jsonPath) {
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  console.error(`JSON written to ${jsonPath}`);
}
