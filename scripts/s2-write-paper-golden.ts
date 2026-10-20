/**
 * Scan S2 (V3.2, 2026-10-21): writes `tests/unit/fixtures/s2-paper-golden.json`,
 * the paper detector's and calibration's output on the existing synthetic
 * scenes (`tests/unit/helpers/s2-golden-scenes.ts`). It was run once on the
 * detector as it was BEFORE the failure stage was added, so the golden test
 * (`paper-detect-stage-golden.test.ts`) compares the code after against the
 * code before. Re-running it overwrites that evidence: do so only on purpose,
 * for a change that is meant to move these numbers.
 *
 *   npx tsx scripts/s2-write-paper-golden.ts
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  goldenFrames,
  goldenRecord,
} from "../tests/unit/helpers/s2-golden-scenes";

const records = goldenFrames().map(goldenRecord);
const out = resolve(process.cwd(), "tests/unit/fixtures/s2-paper-golden.json");
writeFileSync(out, JSON.stringify(records, null, 1) + "\n");
const found = records.filter((r) => r.detection.corners !== null).length;
console.log(`${records.length} scenes, ${found} with four corners -> ${out}`);
