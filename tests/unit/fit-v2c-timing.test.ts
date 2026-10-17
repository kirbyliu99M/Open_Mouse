/**
 * fit-v2.0 candidate, build spec rev2 §4 T12: a timing record, not a gate.
 * Prints the cold (first call in this worker) and warm (median of three)
 * time of `scoreFitV2` + `attachRankStability` on the seed catalogue with no
 * grip stated, for the PR description. Nothing here asserts a time; the
 * assertions only check the output is sane on the real catalogue.
 */
import { describe, expect, it } from "vitest";
import type { FitPreferences } from "../../src/lib/contracts/fit";
import { RANK_STABILITY_DRAWS } from "../../src/server/fit/coefficients";
import { attachRankStability } from "../../src/server/fit/rank-stability-candidate";
import { planV2, scoreFitV2 } from "../../src/server/fit/score-v2-candidate";
import { groupShells } from "../../src/server/fit/shell-groups";
import { hand, seedCatalogue, seedPriors } from "./fit-v2c-fixtures";

describe("T12: timing record (not asserted)", () => {
  it("cold and warm, seed catalogue, no grip stated", () => {
    const m = hand(181.7, 70.3, 0.56);
    const prefs: FitPreferences = { includeVertical: false };
    const once = () => {
      const t0 = performance.now();
      const base = scoreFitV2(m, seedCatalogue, prefs, "right", seedPriors);
      const out = attachRankStability(base, {
        measurements: m,
        catalogue: seedCatalogue,
        prefs,
        hand: "right",
        priors: seedPriors,
      });
      return { ms: performance.now() - t0, out };
    };
    const cold = once();
    const warm = [once(), once(), once()]
      .map((r) => r.ms)
      .sort((a, b) => a - b);
    const rankable = planV2(seedCatalogue, "right", prefs).rankable.length;
    console.log(
      `[T12] node ${process.version}; catalogue ${seedCatalogue.length} listed rows, ${rankable} rankable (right hand); ` +
        `grip not stated; ${RANK_STABILITY_DRAWS} draws; ` +
        `cold ${cold.ms.toFixed(0)} ms, warm median ${warm[1]!.toFixed(0)} ms (min ${warm[0]!.toFixed(0)}, max ${warm[2]!.toFixed(0)})`,
    );

    const cards = groupShells(cold.out.results, seedCatalogue);
    const shares = cards.slice(0, 10).map((c) => c.rankStability);
    expect(shares.every((v) => v !== undefined && v >= 0 && v <= 1)).toBe(true);
    expect(cards.slice(10).some((c) => c.rankStability !== undefined)).toBe(
      false,
    );
    console.log(`[T12] top-10 card shares: ${JSON.stringify(shares)}`);
  });
});
