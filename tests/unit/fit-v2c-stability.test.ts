/**
 * fit-v2.0 candidate, build spec rev2 §4:
 * - T5: determinism (same input, same output, rank stability included), no
 *   input is changed (frozen inputs), and the random sequence is pinned;
 * - T6: rank stability on cards, checked value by value against an
 *   independent, simple reference implementation written here (its own PRNG,
 *   its own card map, the public `scoreFitV2` per draw, no rounding, no
 *   truncation), on an off-grid hand, a hand at 280 mm whose draws cross the
 *   API's upper bound, and a same-shell pair whose shown member switches;
 * - the pairing check: a response that is not `scoreFitV2`'s output for the
 *   given input is refused, also when the ranking order happens to match.
 */
import { describe, expect, it } from "vitest";
import {
  fitResponseSchema,
  type FitPreferences,
} from "../../src/lib/contracts/fit";
import type { HandMeasurements } from "../../src/lib/contracts/measurement";
import {
  RANK_STABILITY_DRAWS,
  RANK_STABILITY_SEED,
  SIGMA_MEAS_MM,
} from "../../src/server/fit/coefficients";
import { computePriors, type Priors } from "../../src/server/fit/priors";
import {
  attachRankStability,
  createStandardNormal,
  mulberry32,
  resampledMeasurements,
} from "../../src/server/fit/rank-stability-candidate";
import { scoreFitV1 } from "../../src/server/fit/score-v1";
import {
  planV2,
  rankV2,
  scoreFitV2,
  type FitV2Options,
} from "../../src/server/fit/score-v2-candidate";
import { groupShells } from "../../src/server/fit/shell-groups";
import type { CatalogueMouse } from "../../src/server/fit/types";
import { deepFreeze, hand, mouseRow } from "./fit-v2c-fixtures";

// ── The independent reference ─────────────────────────────────────────────

/** Textbook mulberry32 + Box–Muller, written here, not imported: [z1, z2] per draw. */
function textbookNormals(): [number, number][] {
  let a = 20261018;
  const uniform = () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: 200 }, () => {
    const r = Math.sqrt(-2 * Math.log(1 - uniform()));
    const theta = 2 * Math.PI * uniform();
    return [r * Math.cos(theta), r * Math.sin(theta)];
  });
}

interface Case {
  measurements: HandMeasurements;
  catalogue: CatalogueMouse[];
  prefs: FitPreferences;
  priors: Priors;
  options?: FitV2Options;
}

/**
 * The reference: the public engine per draw, the case's own card map, a plain
 * count, hits / 200 per baseline card (first 10). `clampHandLength` exists
 * only to show that a case can tell a truncated distribution apart.
 */
function referenceShares(
  c: Case,
  cardOf: (slug: string) => string,
  clampHandLength?: [number, number],
): Map<string, number> {
  const cardsOf = (m: HandMeasurements): string[] => {
    const order = scoreFitV2(
      m,
      c.catalogue,
      c.prefs,
      "right",
      c.priors,
      c.options,
    ).results.map((e) => cardOf(e.mouse.slug));
    return [...new Set(order)];
  };
  const baseline = cardsOf(c.measurements).slice(0, 10);
  const hits = new Map(baseline.map((card) => [card, 0]));
  for (const [z1, z2] of textbookNormals()) {
    let handLengthMm = c.measurements.handLengthMm + 6 * z1;
    if (clampHandLength) {
      handLengthMm = Math.min(
        clampHandLength[1],
        Math.max(clampHandLength[0], handLengthMm),
      );
    }
    const top5 = cardsOf({
      ...c.measurements,
      handLengthMm,
      palmWidthMm: c.measurements.palmWidthMm + 4 * z2,
    }).slice(0, 5);
    for (const card of top5) {
      if (hits.has(card)) hits.set(card, hits.get(card)! + 1);
    }
  }
  return new Map([...hits].map(([card, n]) => [card, n / 200]));
}

/** What the implementation attaches, per card (first 10), keyed like the reference. */
function implementationShares(
  c: Case,
  cardOf: (slug: string) => string,
): Map<string, number | undefined> {
  const base = scoreFitV2(
    c.measurements,
    c.catalogue,
    c.prefs,
    "right",
    c.priors,
    c.options,
  );
  const out = attachRankStability(base, { ...c, hand: "right" });
  return new Map(
    groupShells(out.results, c.catalogue)
      .slice(0, 10)
      .map((card) => [cardOf(card.mouse.slug), card.rankStability]),
  );
}

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

describe("the resampled hands: not rounded, not truncated, palm length kept", () => {
  const z = textbookNormals();

  it("an off-grid hand: every draw is centre + 6·z1 and + 4·z2 exactly, nothing else moves", () => {
    const m: HandMeasurements = {
      handLengthMm: 190.04,
      palmLengthMm: 106.37,
      palmWidthMm: 80.03,
      thumbLengthMm: 61.3,
    };
    const draws = resampledMeasurements(m);
    expect(draws).toHaveLength(200);
    draws.forEach((d, i) => {
      expect(d.handLengthMm).toBe(190.04 + 6 * z[i]![0]);
      expect(d.palmWidthMm).toBe(80.03 + 4 * z[i]![1]);
      expect(d.palmLengthMm).toBe(106.37);
      expect(d.thumbLengthMm).toBe(61.3);
    });
  });

  it("at 280 mm: draws above the API's 280 mm stay above it", () => {
    const draws = resampledMeasurements(hand(280, 98));
    const above = draws.filter((d) => d.handLengthMm > 280);
    expect(above.length).toBeGreaterThan(50);
    draws.forEach((d, i) => expect(d.handLengthMm).toBe(280 + 6 * z[i]![0]));
  });
});

// ── The T6 fixture ─────────────────────────────────────────────────────────
// Claw, stated; hand 190.04 mm (off the 0.1 mm grid) -> claw length target
// about 117.8 mm, grip width about 70.4, height 38. Every row shares the same
// shape descriptors, width and height, so near the target only the length
// decides. 11 cards:
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
  handLengthMm: 190.04,
  palmLengthMm: 110,
  palmWidthMm: 80.03,
};
const prefs: FitPreferences = { includeVertical: false, gripStyle: "claw" };
const T6: Case = { measurements, catalogue, prefs, priors };

/** The cards of the fixture, by hand: the two Twin rows are one shell. */
const CARD_OF = (slug: string) => (slug === "twin-wireless" ? "twin" : slug);

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

  it("equals the independent reference, value for value (hits / 200 exactly), off the 0.1 mm grid", () => {
    const ref = referenceShares(T6, CARD_OF);
    expect(ref.size).toBe(10);
    const got = implementationShares(T6, CARD_OF);
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

  it("an unstated grip with soft weights near r = 0.58 (palm length kept in every draw) equals the reference", () => {
    const c: Case = {
      ...T6,
      measurements: { ...measurements, palmLengthMm: 110.2 }, // r = 0.5799
      prefs: { includeVertical: false },
      options: { equalWeightsWhenUnknown: false },
    };
    expect(implementationShares(c, CARD_OF)).toEqual(
      referenceShares(c, CARD_OF),
    );
  });
});

describe("T6: draws above 280 mm are not truncated (11 synthetic cards)", () => {
  // Palm, 280 x 98 mm: length target 184.8, grip width 86.24, height 58.8.
  // Lengths 170 to 200 mm, so the ranking near the top moves with every
  // draw, including those above 280 mm.
  const boundary = Array.from({ length: 11 }, (_, i) =>
    mouseRow({
      slug: `boundary-${i}`,
      brand: `Boundary ${i}`,
      model: `Boundary ${i}`,
      lengthMm: 170 + i * 3,
      widthMm: 86.24,
      heightMm: 58.8,
    }),
  );
  const c: Case = {
    measurements: hand(280, 98),
    catalogue: boundary,
    prefs: { includeVertical: false, gripStyle: "palm" },
    priors: computePriors(boundary),
  };
  const id = (slug: string) => slug;

  it("equals the untruncated reference, and a truncated one would differ", () => {
    const want = referenceShares(c, id);
    expect(implementationShares(c, id)).toEqual(want);
    const truncated = referenceShares(c, id, [100, 280]);
    expect(truncated).not.toEqual(want);
    console.log(
      "[T6 280] untruncated:",
      JSON.stringify([...want.values()]),
      "truncated at 280 would be:",
      JSON.stringify([...truncated.values()]),
    );
  });
});

describe("T6: the shown member of a shell switches between baseline and draws", () => {
  // Same shell (brand, size, descriptors, family "twin"). Weight 60.0001 g
  // against 60 g with a [60, 60] g preference: the totals differ by about
  // 2.5e-10, inside v1's 1e-9 tie, so "Twin" ranks first by name. At a hand
  // where the two raw totals straddle a half point, groupShells shows
  // "Twin Wireless" (97 against 96); one draw away it shows "Twin". The card
  // must count as in the top 5 whichever member is shown.
  const twins = [
    mouseRow({
      slug: "twin",
      brand: "Twin",
      model: "Twin",
      lengthMm: 117.8,
      widthMm: 70.4,
      weightG: 60.0001,
    }),
    mouseRow({
      slug: "twin-wireless",
      brand: "Twin",
      model: "Twin Wireless",
      lengthMm: 117.8,
      widthMm: 70.4,
      weightG: 60,
    }),
  ];
  const twinPrefs: FitPreferences = {
    includeVertical: false,
    gripStyle: "claw",
    weightG: { min: 60, max: 60 },
  };
  const twinPriors = computePriors(twins);
  const plan = planV2(twins, "right", twinPrefs);
  const raw = (h: number) =>
    rankV2(plan, hand(h, 80), twinPrefs, twinPriors).ranked.find(
      (e) => e.mouse.slug === "twin-wireless",
    )!.score.totalRaw;
  // Bisect for the hand where Twin Wireless's raw total crosses a half point.
  const half = Math.floor(raw(200)) + 0.5;
  let lo = 190;
  let hi = 230;
  for (let i = 0; i < 65; i++) {
    const mid = (lo + hi) / 2;
    if (raw(mid) > half) lo = mid;
    else hi = mid;
  }
  const c: Case = {
    measurements: hand(lo, 80),
    catalogue: twins,
    prefs: twinPrefs,
    priors: twinPriors,
  };

  it("the baseline shows Twin Wireless, a draw shows Twin, and the card is always in: 1", () => {
    const base = scoreFitV2(
      c.measurements,
      twins,
      twinPrefs,
      "right",
      twinPriors,
    );
    expect(base.results.map((e) => e.mouse.slug)).toEqual([
      "twin",
      "twin-wireless",
    ]);
    const baseCards = groupShells(base.results, twins);
    expect(baseCards).toHaveLength(1);
    expect(baseCards[0]!.mouse.slug).toBe("twin-wireless");
    const shownInDraws = resampledMeasurements(c.measurements).map(
      (m) =>
        groupShells(
          scoreFitV2(m, twins, twinPrefs, "right", twinPriors).results,
          twins,
        )[0]!.mouse.slug,
    );
    expect(shownInDraws.filter((s) => s === "twin").length).toBeGreaterThan(
      100,
    );

    const out = attachRankStability(base, { ...c, hand: "right" });
    const cards = groupShells(out.results, twins);
    expect(cards[0]!.mouse.slug).toBe("twin-wireless");
    expect(cards[0]!.rankStability).toBe(1);
    expect(cards[0]!.variants).toEqual([
      { slug: "twin", model: "Twin", weightG: 60.0001 },
    ]);
    // The row that becomes the variant carries nothing.
    expect(out.results.find((e) => e.mouse.slug === "twin")).not.toHaveProperty(
      "rankStability",
    );
    expect(implementationShares(c, () => "twin")).toEqual(
      referenceShares(c, () => "twin"),
    );
  });
});

describe("the pairing check: rank stability refuses a response that is not this input's", () => {
  const input = {
    measurements,
    catalogue,
    prefs,
    hand: "right" as const,
    priors,
  };
  const base = scoreFitV2(measurements, catalogue, prefs, "right", priors);

  it("a v1 response", () => {
    const v1 = scoreFitV1(measurements, catalogue, prefs, "right", priors);
    expect(() => attachRankStability(v1, input)).toThrow(/fit-v2\.0/);
  });

  it("a v2 response for another hand length that ranks in the same order", () => {
    const other = scoreFitV2(
      { ...measurements, handLengthMm: measurements.handLengthMm + 0.05 },
      catalogue,
      prefs,
      "right",
      priors,
    );
    // The precondition: the order alone cannot tell them apart.
    expect(other.results.map((e) => e.mouse.slug)).toEqual(
      base.results.map((e) => e.mouse.slug),
    );
    expect(other.targets.lengthMm).not.toBe(base.targets.lengthMm);
    expect(() => attachRankStability(other, input)).toThrow(
      /not scoreFitV2's output.*response\.targets\.lengthMm/,
    );
  });

  it("a v2 response for a hand length that changes the order", () => {
    const other = scoreFitV2(
      { ...measurements, handLengthMm: 160 },
      catalogue,
      prefs,
      "right",
      priors,
    );
    expect(() => attachRankStability(other, input)).toThrow(/not scoreFitV2/);
  });

  it("an edited response: ranks reversed and totals cleared, slugs in the same order", () => {
    const n = base.results.length;
    const edited = {
      ...base,
      results: base.results.map((e, i) => ({ ...e, rank: n - i, total: 0 })),
    };
    expect(() => attachRankStability(edited, input)).toThrow(/not scoreFitV2/);
    const ranksOnly = {
      ...base,
      results: base.results.map((e, i) => ({ ...e, rank: n - i })),
    };
    expect(() => attachRankStability(ranksOnly, input)).toThrow(
      /response\.results\[0\]\.rank/,
    );
    const totalsOnly = {
      ...base,
      results: base.results.map((e) => ({ ...e, total: 0 })),
    };
    expect(() => attachRankStability(totalsOnly, input)).toThrow(
      /response\.results\[0\]\.total/,
    );
  });

  it.each([
    ["the other hand", { hand: "left" as const }],
    [
      "another stated grip",
      { prefs: { ...prefs, gripStyle: "palm" as const } },
    ],
    [
      "a weight preference",
      { prefs: { ...prefs, weightG: { min: 50, max: 58 } } },
    ],
    [
      "another thickness answer",
      { prefs: { ...prefs, palmThickness: "thick" as const } },
    ],
    ["clampLength off", { options: { clampLength: false } }],
  ] as [string, Partial<typeof input & { options: FitV2Options }>][])(
    "a response made with %s",
    (_n, change) => {
      const made = { ...input, ...change };
      const other = scoreFitV2(
        made.measurements,
        made.catalogue,
        made.prefs,
        made.hand,
        made.priors,
        made.options,
      );
      expect(() => attachRankStability(other, input)).toThrow(/not scoreFitV2/);
      // ...and the same response is accepted with the input it came from.
      expect(() => attachRankStability(other, made)).not.toThrow();
    },
  );

  it("the grouped (card) list instead of the engine's list", () => {
    const grouped = { ...base, results: groupShells(base.results, catalogue) };
    expect(() => attachRankStability(grouped, input)).toThrow(/not scoreFitV2/);
  });

  it("accepts the right pairing after a schema parse (scanId kept) and after a first attach", () => {
    const parsed = fitResponseSchema.parse({
      scanId: "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f",
      ...base,
    });
    const out = attachRankStability(parsed, input);
    expect(out).toEqual({ ...run(), scanId: parsed.scanId });
    expect(attachRankStability(run(), input)).toEqual(run());
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
    const fewBase = scoreFitV2(measurements, few, prefs, "right", fewPriors);
    const r = attachRankStability(fewBase, {
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
