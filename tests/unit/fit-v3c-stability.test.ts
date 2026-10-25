/**
 * fit-v3.0 candidate (未拍板): rank stability of the v3 engine. The shares are
 * the v2 measure (200 resampled hands, first five cards) with `rankV3` doing
 * the ranking, calibration included.
 */
import { describe, expect, it } from "vitest";
import {
  fitResponseSchema,
  type FitPreferences,
  type FitReference,
} from "../../src/lib/contracts/fit";
import { attachRankStability } from "../../src/server/fit/rank-stability-candidate";
import { attachRankStabilityV3 } from "../../src/server/fit/rank-stability-v3-candidate";
import { scoreFitV2 } from "../../src/server/fit/score-v2-candidate";
import { scoreFitV3 } from "../../src/server/fit/score-v3-candidate";
import { groupShells } from "../../src/server/fit/shell-groups";
import { hand, seedCatalogue, seedPriors } from "./fit-v2c-fixtures";

const SCAN_ID = "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f";
const m = hand(190, 65.7);
const reference: FitReference = {
  slug: "logitech-g903-hero",
  grips: ["palm", "claw"],
  feel: { length: 0, width: 0, height: 0 },
  specialUse: false,
};
const prefs: FitPreferences = {
  includeVertical: false,
  references: [reference],
};

const input = (p: FitPreferences, measurements = m) => ({
  measurements,
  catalogue: seedCatalogue,
  prefs: p,
  hand: "right" as const,
  priors: seedPriors,
});

describe("attachRankStabilityV3", () => {
  const base = scoreFitV3(m, seedCatalogue, prefs, "right", seedPriors);
  const rich = attachRankStabilityV3(base, input(prefs));

  it("puts a share in [0, 1] on the shown row of the first ten cards, and nothing else changes", () => {
    const cards = groupShells(rich.results, seedCatalogue);
    const withShare = cards.filter((c) => c.rankStability !== undefined);
    expect(withShare).toHaveLength(10);
    for (const c of withShare) {
      expect(c.rankStability).toBeGreaterThanOrEqual(0);
      expect(c.rankStability).toBeLessThanOrEqual(1);
      // a whole number of the 200 draws
      expect(
        Math.abs(c.rankStability! * 200 - Math.round(c.rankStability! * 200)),
      ).toBeLessThan(1e-9);
    }
    const { results: a, ...restRich } = rich;
    const { results: b, ...restBase } = base;
    expect(restRich).toEqual(restBase);
    expect(a.map((e) => e.mouse.slug)).toEqual(b.map((e) => e.mouse.slug));
    expect(
      fitResponseSchema.safeParse({
        scanId: SCAN_ID,
        ...rich,
        results: cards,
      }).success,
    ).toBe(true);
  });

  it("the baseline top card stays near the top in some resamples, and shares are not all equal", () => {
    const cards = groupShells(rich.results, seedCatalogue).filter(
      (c) => c.rankStability !== undefined,
    );
    expect(cards[0]!.rankStability).toBeGreaterThan(0);
    expect(new Set(cards.map((c) => c.rankStability)).size).toBeGreaterThan(1);
  });

  it("references change the shares: same hand with and without them differ on at least one top card", () => {
    const plainPrefs: FitPreferences = { includeVertical: false };
    const plain = attachRankStabilityV3(
      scoreFitV3(m, seedCatalogue, plainPrefs, "right", seedPriors),
      input(plainPrefs),
    );
    const sharesOf = (r: typeof rich) =>
      new Map(
        groupShells(r.results, seedCatalogue)
          .filter((c) => c.rankStability !== undefined)
          .map((c) => [c.mouse.slug, c.rankStability!]),
      );
    const withRefs = sharesOf(rich);
    const without = sharesOf(plain);
    const slugs = new Set([...withRefs.keys(), ...without.keys()]);
    const differing = [...slugs].filter(
      (slug) => withRefs.get(slug) !== without.get(slug),
    );
    expect(differing.length).toBeGreaterThan(0);
    // and the calibration is really inside the resampling: the two baselines
    // are different rankings to begin with
    expect(rich.results.map((e) => e.mouse.slug)).not.toEqual(
      plain.results.map((e) => e.mouse.slug),
    );
  });

  it("is deterministic (fixed seed)", () => {
    expect(attachRankStabilityV3(base, input(prefs))).toEqual(rich);
  });

  it("refuses a response from another engine or another input", () => {
    const v2 = scoreFitV2(
      m,
      seedCatalogue,
      { includeVertical: false },
      "right",
      seedPriors,
    );
    expect(() => attachRankStabilityV3(v2, input(prefs))).toThrow(
      /fit-v3\.0-candidate\.0/,
    );
    expect(() =>
      attachRankStabilityV3(base, input(prefs, hand(191, 65.7))),
    ).toThrow(/not scoreFitV3's output/);
    expect(() =>
      attachRankStabilityV3(base, input({ includeVertical: false })),
    ).toThrow(/not scoreFitV3's output/);
  });

  it("the v2 attach step still refuses a v3 response", () => {
    expect(() =>
      attachRankStability(base, {
        measurements: m,
        catalogue: seedCatalogue,
        prefs,
        hand: "right",
        priors: seedPriors,
      }),
    ).toThrow();
  });
});
