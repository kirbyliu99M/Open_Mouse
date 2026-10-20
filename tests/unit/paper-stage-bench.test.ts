/**
 * Scan S2 (V3.2, 2026-10-21): the failure stage's extra live-preview time per
 * sample, desktop p95 under 1 ms (`helpers/paper-stage-bench.ts` says what is
 * timed). `npx tsx scripts/paper-stage-bench.ts` prints the numbers.
 */
import { describe, expect, it } from "vitest";
import { measureStageOverhead } from "./helpers/paper-stage-bench";

describe("failure stage: extra live-preview time per sample", () => {
  it("desktop p95 < 1 ms, worst case and typical", () => {
    const bench = measureStageOverhead();
    expect(bench.worstP95Ms).toBeLessThan(1);
    expect(bench.typicalP95Ms).toBeLessThan(1);
  });
});
