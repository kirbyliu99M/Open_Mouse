/**
 * Scan S2 (V3.2, 2026-10-21): prints the failure stage's extra live-preview
 * time per sample on this machine (desktop, not a phone). What is timed:
 * `tests/unit/helpers/paper-stage-bench.ts`.
 *
 *   npx tsx scripts/paper-stage-bench.ts
 */
import { measureStageOverhead } from "../tests/unit/helpers/paper-stage-bench";

const bench = measureStageOverhead(2000);
console.log(
  `S2 stage overhead per live sample (measured, this machine, n=${bench.samples}): ` +
    `worst case (153600 regions) p95 ${bench.worstP95Ms.toFixed(4)} ms, ` +
    `typical (400 regions) p95 ${bench.typicalP95Ms.toFixed(4)} ms`,
);
