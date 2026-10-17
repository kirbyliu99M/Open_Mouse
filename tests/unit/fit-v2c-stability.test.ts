/**
 * fit-v2.0 candidate, build spec rev2 §4:
 * - T5: determinism (same input, same output, rank stability included), no
 *   input is changed (frozen inputs), and the random sequence is pinned;
 * - T6: rank stability on a synthetic catalogue of 11 cards, checked value by
 *   value against an independent, simple reference implementation written
 *   here (its own PRNG, its own grouping, the public `scoreFitV2` per draw).
 */
import { describe, expect, it } from "vitest";
import type { FitPreferences } from "../../src/lib/contracts/fit";
import type { HandMeasurements } from "../../src/lib/contracts/measurement";
import {
  RANK_STABILITY_DRAWS,
  RANK_STABILITY_SEED,
  SIGMA_MEAS_MM,
} from "../../src/server/fit/coefficients";
import { computePriors } from "../../src/server/fit/priors";
import {
  attachRankStability,
  createStandardNormal,
  mulberry32,
} from "../../src/server/fit/rank-stability-candidate";
import { scoreFitV1 } from "../../src/server/fit/score-v1";
import { scoreFitV2 } from "../../src/server/fit/score-v2-candidate";
import { groupShells } from "../../src/server/fit/shell-groups";
import type { CatalogueMouse } from "../../src/server/fit/types";
import { deepFreeze, mouseRow } from "./fit-v2c-fixtures";

// ── T5: the random sequence ───────────────────────────────────────────────
// Values from a textbook mulberry32 and Box–Muller run outside the repo code.

describe("T5: the pinned random sequence", () => {
  it("the seed is the fixed constant", () => {
    expect(RANK_STABILITY_SEED).toBe(20261018);
    expect(RANK_STABILITY_DRAWS).toBe(200);
    expect(SIGMA_MEAS_MM).toEqual({ handLength: 6, palmWidth: 4 });
  });

  it("mulberry32's first uniforms, exactly", () => {
    const u = mulberry32(RANK_STABILITY_SEED);
    expect(Array.from({ length: 8 }, () => u() * 4294967296)).toEqual([
      2680775599, 3432565243, 2069015649, 1166166522, 1224702332, 3106802961,
      1538116412, 326522800,
    ]);
  });

  it("the first eight standard normals (cos, sin of each pair)", () => {
    const z = createStandardNormal(RANK_STABILITY_SEED);
    const got = Array.from({ length: 8 }, () => z());
    const want = [
      0.42567673895888586, -1.3326734511920335, -0.15454941734571875,
      1.1360604289175738, -0.13651464136686667, -0.8079133022192312,
      0.8362494123151374, 0.4328934208784125,
    ];
    got.forEach((v, i) => expect(v).toBeCloseTo(want[i]!, 14));
  });
});

// ── The T6 fixture ─────────────────────────────────────────────────────────
// Claw, stated; hand 190 mm -> claw length target 117.8 mm, grip width 70.4,
// height 38. Every row shares the same shape descriptors, width and height,
// so near the target only the length decides. 11 cards:
//   best 117.8 | twin 112.5 (two rows, one shell) | c1 114 | c2 115 |
//   c3 121 | c4 122 | edge 125 | far 92 | x1 88 | x2 85 | x3 82
// best has at most three cards closer to any target on either side, so it is
// always in the top 5. far and the x rows have a grip width far off (92 mm and
// up against 70.4), so they never reach the top 5; far is card 8, x3 card 11.
// lefty (117.8, left-handed) would be the best of all but is excluded.

const near = (slug: string, lengthMm: number, model = slug) =>
  mouseRow({ slug, brand: `B-${slug}`, model, lengthMm, widthMm: 70.4 });
const farRow = (slug: string, lengthMm: number, widthMm: number) =>
  mouseRow({ slug, brand: `B-${slug}`, model: slug, lengthMm, widthMm });

const catalogue: CatalogueMouse[] = [
  near("best", 117.8),
  mouseRow({
    slug: "twin",
    brand: "Twin",
    model: "Twin",
    lengthMm: 112.5,
    widthMm: 70.4,
  }),
  mouseRow({
    slug: "twin-wireless",
    brand: "Twin",
    model: "Twin Wireless",
    lengthMm: 112.5,
    widthMm: 70.4,
    weightG: 55,
  }),
  near("c1", 114),
  near("c2", 115),
  near("c3", 121),
  near("c4", 122),
  near("edge", 125),
  farRow("far", 92, 92),
  farRow("x1", 88, 98),
  farRow("x2", 85, 104),
  farRow("x3", 82, 110),
  mouseRow({
    slug: "lefty",
    brand: "Lefty",
    model: "Lefty",
    lengthMm: 117.8,
    widthMm: 70.4,
    handCompatibility: "left",
  }),
];
const priors = computePriors(catalogue);
const measurements: HandMeasurements = {
  handLengthMm: 190,
  palmLengthMm: 110,
  palmWidthMm: 80,
};
const prefs: FitPreferences = { includeVertical: false, gripStyle: "claw" };

/** The cards of the fixture, by hand: the two Twin rows are one shell. */
const CARD_OF: Record<string, string> = Object.fromEntries(
  catalogue.map((m) => [m.slug, m.slug === "twin-wireless" ? "twin" : m.slug]),
);

/**
 * The reference: a textbook PRNG, the public engine per draw, the fixture's
 * own card map, and a plain count. Returns hits / 200 per card.
 */
function referenceShares(): Map<string, number> {
  let a = RANK_STABILITY_SEED;
  const uniform = () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const cardsOf = (m: HandMeasurements): string[] => {
    const order = scoreFitV2(m, catalogue, prefs, "right", priors).results.map(
      (e) => CARD_OF[e.mouse.slug]!,
    );
    return [...new Set(order)];
  };
  const baseline = cardsOf(measurements).slice(0, 10);
  const hits = new Map(baseline.map((c) => [c, 0]));
  for (let d = 0; d < 200; d++) {
    const u1 = uniform();
    const u2 = uniform();
    const r = Math.sqrt(-2 * Math.log(1 - u1));
    const z1 = r * Math.cos(2 * Math.PI * u2);
    const z2 = r * Math.sin(2 * Math.PI * u2);
    const top5 = cardsOf({
      ...measurements,
      handLengthMm: measurements.handLengthMm + 6 * z1,
      palmWidthMm: measurements.palmWidthMm + 4 * z2,
    }).slice(0, 5);
    for (const c of top5) if (hits.has(c)) hits.set(c, hits.get(c)! + 1);
  }
  return new Map([...hits].map(([c, n]) => [c, n / 200]));
}

function run() {
  const base = scoreFitV2(measurements, catalogue, prefs, "right", priors);
  return attachRankStability(base, {
    measurements,
    catalogue,
    prefs,
    hand: "right",
    priors,
  });
}

describe("T6: rank stability on cards", () => {
  const out = run();
  const cards = groupShells(out.results, catalogue);

  it("the fixture has 11 cards, the twins on one, lefty excluded", () => {
    expect(cards).toHaveLength(11);
    const twin = cards.find((c) => c.mouse.slug === "twin")!;
    expect(twin.variants?.map((v) => v.slug)).toEqual(["twin-wireless"]);
    expect(out.excluded.map((e) => e.slug)).toEqual(["lefty"]);
    expect(out.results.some((e) => e.mouse.slug === "lefty")).toBe(false);
  });

  it("equals the independent reference, value for value (hits / 200 exactly)", () => {
    const ref = referenceShares();
    expect(ref.size).toBe(10);
    const got = new Map(
      cards.slice(0, 10).map((c) => [CARD_OF[c.mouse.slug]!, c.rankStability]),
    );
    expect(got).toEqual(ref);
    // For the record (also proves the middle case is really in the middle).
    console.log(
      "[T6] shares:",
      JSON.stringify(Object.fromEntries(got.entries())),
    );
  });

  it("the obviously best card is 1, a far card in the top 10 is 0, some are in between", () => {
    const share = (slug: string) =>
      cards.find((c) => c.mouse.slug === slug)!.rankStability;
    expect(cards[0]!.mouse.slug).toBe("best");
    expect(share("best")).toBe(1);
    expect(cards.findIndex((c) => c.mouse.slug === "far")).toBeLessThan(10);
    expect(share("far")).toBe(0);
    const middle = cards
      .slice(0, 10)
      .filter((c) => c.rankStability! > 0 && c.rankStability! < 1);
    expect(middle.length).toBeGreaterThanOrEqual(3);
  });

  it("only the first 10 cards carry it, and a variant row never does", () => {
    expect(cards.slice(0, 10).every((c) => c.rankStability !== undefined)).toBe(
      true,
    );
    expect(cards[10]).not.toHaveProperty("rankStability");
    // Ungrouped: exactly the ten shown rows carry it; the twin variant does not.
    expect(out.results.filter((e) => "rankStability" in e)).toHaveLength(10);
    expect(
      out.results.find((e) => e.mouse.slug === "twin-wireless"),
    ).not.toHaveProperty("rankStability");
  });

  it("every value is in [0, 1] on the 1/200 grid", () => {
    for (const c of cards.slice(0, 10)) {
      const v = c.rankStability!;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(Number.isInteger(Math.round(v * 200))).toBe(true);
      expect(Math.round(v * 200) / 200).toBe(v);
    }
  });

  it("leaves everything else of the response as scoreFitV2 made it", () => {
    const base = scoreFitV2(measurements, catalogue, prefs, "right", priors);
    const strip = out.results.map((e) => {
      const { rankStability: _s, ...rest } = e;
      void _s;
      return rest;
    });
    expect(strip).toEqual(base.results);
    expect({ ...out, results: [] }).toEqual({ ...base, results: [] });
  });
});

describe("T6: what rank stability refuses", () => {
  const input = {
    measurements,
    catalogue,
    prefs,
    hand: "right" as const,
    priors,
  };

  it("a v1 response", () => {
    const v1 = scoreFitV1(measurements, catalogue, prefs, "right", priors);
    expect(() => attachRankStability(v1, input)).toThrow(/fit-v2\.0/);
  });

  it("a v2 response for other inputs", () => {
    const other = scoreFitV2(
      { ...measurements, handLengthMm: 160 },
      catalogue,
      prefs,
      "right",
      priors,
    );
    expect(() => attachRankStability(other, input)).toThrow(/not scoreFitV2/);
  });

  it("nothing ranked: returns the response unchanged", () => {
    const empty = scoreFitV2(measurements, [], prefs, "right", priors);
    expect(attachRankStability(empty, { ...input, catalogue: [] })).toEqual(
      empty,
    );
  });

  it("fewer than five cards: every card is always in, so 1", () => {
    const few = catalogue.slice(0, 4); // best + twins (one card) + c1
    const fewPriors = computePriors(few);
    const base = scoreFitV2(measurements, few, prefs, "right", fewPriors);
    const r = attachRankStability(base, {
      ...input,
      catalogue: few,
      priors: fewPriors,
    });
    const shares = groupShells(r.results, few).map((c) => c.rankStability);
    expect(shares).toEqual([1, 1, 1]);
  });
});

describe("T5: determinism and untouched inputs", () => {
  it("two calls give deeply equal responses, rank stability included", () => {
    expect(run()).toEqual(run());
  });

  it("frozen inputs: no throw, the same output, nothing changed", () => {
    const before = structuredClone({ catalogue, measurements, prefs });
    const frozen = deepFreeze(
      structuredClone({ catalogue, measurements, prefs }),
    );
    const frozenPriors = deepFreeze(computePriors(frozen.catalogue));
    const base = scoreFitV2(
      frozen.measurements,
      frozen.catalogue,
      frozen.prefs,
      "right",
      frozenPriors,
    );
    const out = attachRankStability(deepFreeze(base), {
      measurements: frozen.measurements,
      catalogue: frozen.catalogue,
      prefs: frozen.prefs,
      hand: "right",
      priors: frozenPriors,
    });
    expect(out).toEqual(run());
    expect(frozen).toEqual(before);
  });

  it("an unstated grip and the default options are deterministic too", () => {
    const open: FitPreferences = { includeVertical: false };
    const once = () =>
      attachRankStability(
        scoreFitV2(measurements, catalogue, open, "right", priors),
        { measurements, catalogue, prefs: open, hand: "right", priors },
      );
    expect(once()).toEqual(once());
  });
});
