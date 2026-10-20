import { describe, expect, it } from "vitest";
import type { GripStyle } from "../../src/lib/contracts/fit";
import {
  MAX_SIMILAR_MICE,
  SIMILAR_MIN_PEOPLE,
  similarResponseSchema,
  type SimilarResponse,
} from "../../src/lib/contracts/recommend";
import {
  SIMILAR_HAND_LENGTH_CELL_MM,
  SIMILAR_PALM_WIDTH_CELL_MM,
  SIMILAR_PRIOR_WEIGHT,
} from "../../src/server/recommend/constants";
import {
  DEFAULT_SIMILAR_RULES,
  shrunkScore,
  similarHands,
  type Caller,
  type Contribution,
  type ContributedRating,
} from "../../src/server/recommend/neighbours";

// ---------------------------------------------------------------- helpers

/**
 * The caller used unless a test says otherwise. Bins, not raw millimetres. The
 * hand length cell is 180 to 199 mm (20 mm cells on a grid anchored at 0) and
 * the palm width cell 90 to 99 mm (10 mm cells), so the caller sits inside both
 * and a probe 5 mm either way can still be in the cell, or across a grid line.
 */
const HAND = 190;
const PALM = 95;

function caller(over: Partial<Caller> = {}): Caller {
  return {
    handLengthBinMm: HAND,
    palmWidthBinMm: PALM,
    gripStyle: "palm",
    ownContributionIds: new Set(),
    ...over,
  };
}

/** A rating of a catalogue mouse; brand and model follow from the slug. */
function rate(slug: string, satisfaction: number): ContributedRating {
  return { slug, brand: `Brand ${slug}`, model: `Model ${slug}`, satisfaction };
}

function person(
  id: string,
  ratings: ContributedRating[],
  over: Partial<Contribution> = {},
): Contribution {
  return {
    id,
    handLengthBinMm: HAND,
    palmWidthBinMm: PALM,
    gripStyle: "palm",
    ratings,
    ...over,
  };
}

/** `n` neighbours, ids `<prefix>0..`, each rating `slug` with the given value. */
function crowd(
  prefix: string,
  slug: string,
  satisfactions: readonly number[],
  over: Partial<Contribution> = {},
): Contribution[] {
  return satisfactions.map((s, i) =>
    person(`${prefix}${i}`, [rate(slug, s)], over),
  );
}

/** `n` copies of one value. */
const same = (n: number, value: number): number[] =>
  Array.from({ length: n }, () => value);

/** mulberry32: a tiny seeded generator, so no test uses Math.random. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], next: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Sixteen 5s and four 4s: 20 ratings, sum 96, mean exactly 4.8. */
const BIG = [...same(16, 5), ...same(4, 4)];

/**
 * Two mice, both rated only by neighbours: "few" by 5 people (all 5s, mean 5,
 * the floor exactly) and "big" by 20 (mean 4.8). With m = 4, "few" is
 * outranked by "big" exactly when the prior g is under 4.4:
 *   (25 + 4g) / 9 < (96 + 4g) / 24  <=>  600 + 96g < 864 + 36g  <=>  g < 4.4.
 * On their own the prior is (25 + 96) / 25 = 4.84, so "few" leads, as it does
 * by plain mean. (With only two mice that clear the floor the prior is always
 * between their means, so nothing can reverse them: it takes a third.)
 */
function fewAndBig(): Contribution[] {
  return [...crowd("few", "few", same(5, 5)), ...crowd("big", "big", BIG)];
}

/**
 * A third mouse that exactly the floor of neighbours rate 1. It clears the
 * floor, so its ratings are in the prior: added to `fewAndBig` the prior falls
 * to (121 + 5) / 30 = 4.2, under 4.4, so "big" leads "few". It is listed too,
 * last.
 */
function lowCrowd(): Contribution[] {
  return crowd("low", "low", same(5, 1));
}

/**
 * Four people (one under the floor) who each rate the same five mice 1, so each
 * of those mice has 4 raters and is never listed. Under the old rule (a prior
 * over every rating of every mouse) these ratings pulled the prior from 4.84 to
 * (121 + 20) / 45 = 3.13 and put "big" ahead of "few"; they must move nothing.
 * A fifth person who rated the same five mice (see `underFloorLow`) would take
 * each of them over the floor.
 */
function underFloorLows(
  prefix: string,
  over: Partial<Contribution> = {},
): Contribution[] {
  return [0, 1, 2, 3].map((i) => underFloorLow(`${prefix}${i}`, over));
}

function underFloorLow(
  id: string,
  over: Partial<Contribution> = {},
): Contribution {
  return person(
    id,
    ["z1", "z2", "z3", "z4", "z5"].map((slug) => rate(slug, 1)),
    over,
  );
}

function parsed(response: SimilarResponse): SimilarResponse {
  return similarResponseSchema.parse(response);
}

function slugs(response: SimilarResponse): string[] {
  return response.available ? response.mice.map((m) => m.slug) : [];
}

/** The answer without `basis`, which repeats the caller's own bin. */
function withoutBasis(response: SimilarResponse): unknown {
  if (!response.available) return response;
  return { ...response, basis: undefined };
}

const UNAVAILABLE: SimilarResponse = {
  available: false,
  reason: "insufficient_data",
};

// -------------------------------------------------------- the neighbour rule

describe("neighbours: who counts", () => {
  /**
   * The floor minus one baseline neighbours plus one probe at an offset: is the
   * probe a neighbour (the pool then reaches the floor and the answer counts
   * `SIMILAR_MIN_PEOPLE`) or not (`null`, one short)?
   */
  function neighboursWithProbe(
    probe: Partial<Contribution>,
    rules = DEFAULT_SIMILAR_RULES,
    who: Caller = caller(),
  ): number | null {
    const pool = [
      ...crowd("base", "m", same(SIMILAR_MIN_PEOPLE - 1, 4)),
      person("probe", [rate("m", 4)], probe),
    ];
    const res = parsed(similarHands(who, pool, rules));
    return res.available ? res.neighbours : null;
  }
  const IN = SIMILAR_MIN_PEOPLE;

  it("cuts hand length every 20 mm and palm width every 10 mm", () => {
    expect(SIMILAR_HAND_LENGTH_CELL_MM).toBe(20);
    expect(SIMILAR_PALM_WIDTH_CELL_MM).toBe(10);
    expect(DEFAULT_SIMILAR_RULES.handLengthCellMm).toBe(20);
    expect(DEFAULT_SIMILAR_RULES.palmWidthCellMm).toBe(10);
  });

  it("takes everybody in the caller's hand length cell, lower edge in, upper edge out", () => {
    // The caller is at 190 mm: the cell is 180 to 199 mm.
    expect(neighboursWithProbe({ handLengthBinMm: 180 })).toBe(IN);
    expect(neighboursWithProbe({ handLengthBinMm: 185 })).toBe(IN);
    expect(neighboursWithProbe({ handLengthBinMm: 195 })).toBe(IN);
    expect(neighboursWithProbe({ handLengthBinMm: 175 })).toBeNull();
    expect(neighboursWithProbe({ handLengthBinMm: 200 })).toBeNull();
    expect(neighboursWithProbe({ handLengthBinMm: 205 })).toBeNull();
  });

  it("takes everybody in the caller's palm width cell, lower edge in, upper edge out", () => {
    // The caller is at 95 mm: the cell is 90 to 99 mm.
    expect(neighboursWithProbe({ palmWidthBinMm: 90 })).toBe(IN);
    expect(neighboursWithProbe({ palmWidthBinMm: 95 })).toBe(IN);
    expect(neighboursWithProbe({ palmWidthBinMm: 85 })).toBeNull();
    expect(neighboursWithProbe({ palmWidthBinMm: 100 })).toBeNull();
    expect(neighboursWithProbe({ palmWidthBinMm: 105 })).toBeNull();
  });

  it("needs both dimensions in the cell, not either", () => {
    expect(
      neighboursWithProbe({ handLengthBinMm: 180, palmWidthBinMm: 90 }),
    ).toBe(IN);
    expect(
      neighboursWithProbe({ handLengthBinMm: 200, palmWidthBinMm: PALM }),
    ).toBeNull();
    expect(
      neighboursWithProbe({ handLengthBinMm: HAND, palmWidthBinMm: 100 }),
    ).toBeNull();
    expect(
      neighboursWithProbe({ handLengthBinMm: 200, palmWidthBinMm: 100 }),
    ).toBeNull();
  });

  it("is a cell, not a distance: 5 mm across a grid line is out, 15 mm inside a cell is in", () => {
    // Caller at the top of the cell (195 mm) and at its bottom (180 mm).
    const top = caller({ handLengthBinMm: 195 });
    const bottom = caller({ handLengthBinMm: 180 });
    expect(
      neighboursWithProbe({ handLengthBinMm: 200 }, undefined, top),
    ).toBeNull();
    expect(neighboursWithProbe({ handLengthBinMm: 180 }, undefined, top)).toBe(
      IN,
    ); // 15 mm away
    expect(
      neighboursWithProbe({ handLengthBinMm: 175 }, undefined, bottom),
    ).toBeNull();
    expect(
      neighboursWithProbe({ handLengthBinMm: 195 }, undefined, bottom),
    ).toBe(IN); // 15 mm away
    // The same for palm width: 90 and 95 are one cell, 100 is the next.
    const palmTop = caller({ palmWidthBinMm: 95 });
    const palmBottom = caller({ palmWidthBinMm: 90 });
    expect(
      neighboursWithProbe({ palmWidthBinMm: 100 }, undefined, palmTop),
    ).toBeNull();
    expect(
      neighboursWithProbe({ palmWidthBinMm: 85 }, undefined, palmBottom),
    ).toBeNull();
    expect(
      neighboursWithProbe({ palmWidthBinMm: 95 }, undefined, palmBottom),
    ).toBe(IN);
  });

  it("the grid is anchored at 0, not at the caller", () => {
    // Callers at 200 and at 215 mm: the cell is 200 to 219 mm for both, and a
    // contributor at 195 or 220 mm is outside it, whichever of the two asks.
    const inside = (hand: number) =>
      crowd("c", "m", same(SIMILAR_MIN_PEOPLE - 1, 4), {
        handLengthBinMm: hand,
      });
    const probeAt = (callerHand: number, probeHand: number): number | null => {
      const pool = [
        ...inside(205),
        person("probe", [rate("m", 4)], { handLengthBinMm: probeHand }),
      ];
      const res = parsed(
        similarHands(caller({ handLengthBinMm: callerHand }), pool),
      );
      return res.available ? res.neighbours : null;
    };
    for (const callerHand of [200, 215]) {
      expect(probeAt(callerHand, 200)).toBe(IN);
      expect(probeAt(callerHand, 215)).toBe(IN);
      expect(probeAt(callerHand, 195)).toBeNull();
      expect(probeAt(callerHand, 220)).toBeNull();
    }
  });

  it("a rule can set another cell width", () => {
    const rules = { ...DEFAULT_SIMILAR_RULES, handLengthCellMm: 10 };
    // 10 mm cells: 190 to 199 for the caller at 190.
    expect(neighboursWithProbe({ handLengthBinMm: 195 }, rules)).toBe(IN);
    expect(neighboursWithProbe({ handLengthBinMm: 185 }, rules)).toBeNull();
  });

  const BAD_BINS: Array<[string, number]> = [
    ["NaN", Number.NaN],
    ["missing", undefined as unknown as number],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ];

  it.each(BAD_BINS)(
    "a hand length bin that is %s is not a neighbour",
    (_name, bad) => {
      expect(neighboursWithProbe({ handLengthBinMm: bad })).toBeNull();
    },
  );

  it.each(BAD_BINS)(
    "a palm width bin that is %s is not a neighbour",
    (_name, bad) => {
      expect(neighboursWithProbe({ palmWidthBinMm: bad })).toBeNull();
    },
  );

  it("people with a bad bin cannot make up the floor between them", () => {
    // Each of these is "close" on the other dimension. Even a whole floor's
    // worth of them is no neighbour at all: no answer.
    const nan = Number.NaN;
    const gone = undefined as unknown as number;
    const kinds: Array<Partial<Contribution>> = [
      { handLengthBinMm: nan },
      { palmWidthBinMm: nan },
      { handLengthBinMm: gone },
      { palmWidthBinMm: gone },
      { handLengthBinMm: Number.POSITIVE_INFINITY },
      { palmWidthBinMm: Number.POSITIVE_INFINITY },
      { handLengthBinMm: Number.NEGATIVE_INFINITY },
      { palmWidthBinMm: Number.NEGATIVE_INFINITY },
    ];
    const bad = kinds.flatMap((over, i) =>
      Array.from({ length: SIMILAR_MIN_PEOPLE }, (_, j) =>
        person(`bad${i}-${j}`, [rate("m", 4)], over),
      ),
    );
    expect(similarHands(caller(), bad)).toEqual(UNAVAILABLE);
    // With good neighbours one short of the floor beside them, they still are
    // not counted.
    const pool = [
      ...crowd("good", "m", same(SIMILAR_MIN_PEOPLE - 1, 4)),
      ...bad,
    ];
    expect(similarHands(caller(), pool)).toEqual(UNAVAILABLE);
  });

  it("does not ask for the same grip by default", () => {
    expect(DEFAULT_SIMILAR_RULES.requireSameGrip).toBe(false);
    expect(neighboursWithProbe({ gripStyle: "claw" })).toBe(IN);
    expect(neighboursWithProbe({ gripStyle: "fingertip" })).toBe(IN);
  });

  it("asks for the same grip when the rule says so", () => {
    const rules = { ...DEFAULT_SIMILAR_RULES, requireSameGrip: true };
    expect(neighboursWithProbe({ gripStyle: "palm" }, rules)).toBe(IN);
    expect(neighboursWithProbe({ gripStyle: "claw" }, rules)).toBeNull();
    expect(neighboursWithProbe({ gripStyle: "fingertip" }, rules)).toBeNull();
  });

  it("a contribution with no grip is a neighbour by default and never matches a grip", () => {
    const noGrip = {
      gripStyle: undefined as unknown as GripStyle,
    };
    expect(neighboursWithProbe(noGrip)).toBe(IN);
    expect(
      neighboursWithProbe(noGrip, {
        ...DEFAULT_SIMILAR_RULES,
        requireSameGrip: true,
      }),
    ).toBeNull();
  });

  it("the grip is required by the type", () => {
    // @ts-expect-error gripStyle is not optional: the server always stores one
    const missing: Contribution = {
      id: "x",
      handLengthBinMm: HAND,
      palmWidthBinMm: PALM,
      ratings: [],
    };
    expect(missing.id).toBe("x");
  });

  it("counts a neighbour who rated nothing in the catalogue", () => {
    // Someone who only named a mouse outside the catalogue has no ratings, but
    // is still a person in the cell.
    const pool = [
      ...crowd("rater", "m", same(SIMILAR_MIN_PEOPLE, 4)),
      person("silent", [], { handLengthBinMm: 185 }),
    ];
    const res = parsed(similarHands(caller(), pool));
    expect(res).toMatchObject({
      available: true,
      neighbours: SIMILAR_MIN_PEOPLE + 1,
    });
    expect(res.available && res.mice[0]?.raters).toBe(SIMILAR_MIN_PEOPLE);
  });
});

// ------------------------------------------------------------ the floor

describe("floor: how few people can stand behind an answer", () => {
  it("holds SIMILAR_MIN_PEOPLE at 5, which these tests are written for", () => {
    expect(SIMILAR_MIN_PEOPLE).toBe(5);
  });

  it("0 contributors: not available", () => {
    expect(similarHands(caller(), [])).toEqual(UNAVAILABLE);
  });

  it("0 neighbours among people far away: not available", () => {
    const far = crowd("far", "m", same(8, 5), { handLengthBinMm: HAND + 40 });
    expect(similarHands(caller(), far)).toEqual(UNAVAILABLE);
  });

  it("one under the floor: not available, however many people are elsewhere", () => {
    const pool = [
      ...crowd("only", "m", same(SIMILAR_MIN_PEOPLE - 1, 5)),
      ...crowd("far", "m", same(20, 5), { palmWidthBinMm: PALM + 30 }),
    ];
    expect(similarHands(caller(), pool)).toEqual(UNAVAILABLE);
  });

  it("exactly 5 neighbours who rated the same mouse: available, all counted", () => {
    const res = parsed(
      similarHands(caller(), crowd("n", "m", [5, 3, 4, 4, 4])),
    );
    expect(res).toEqual({
      available: true,
      neighbours: 5,
      basis: { handLengthBinMm: HAND, palmWidthBinMm: PALM, gripStyle: "palm" },
      mice: [
        {
          slug: "m",
          brand: "Brand m",
          model: "Model m",
          raters: 5,
          meanSatisfaction: 4,
        },
      ],
    });
  });

  it("5 neighbours who rated different mice: no mouse has 5 raters, so not available", () => {
    const pool = ["a", "b", "c", "d", "e"].map((slug) =>
      person(`p-${slug}`, [rate(slug, 5)]),
    );
    expect(similarHands(caller(), pool)).toEqual(UNAVAILABLE);
  });

  it("4 and 4 on either side of a grid line are not 8: neither side has an answer", () => {
    const left = crowd("l", "m", same(4, 4), { handLengthBinMm: 195 });
    const right = crowd("r", "m", same(4, 4), { handLengthBinMm: 200 });
    for (const hand of [180, 195, 200, 215]) {
      expect(
        similarHands(caller({ handLengthBinMm: hand }), [...left, ...right]),
      ).toEqual(UNAVAILABLE);
    }
  });

  it("a mouse with exactly 4 neighbour raters is left out, and leaves no trace", () => {
    const five = (secret: boolean) =>
      Array.from({ length: 5 }, (_, i) =>
        person(`p${i}`, [
          rate("shared", 3 + (i % 2)),
          ...(secret && i < 4 ? [rate("solo-secret", 5)] : []),
        ]),
      );
    const res = parsed(similarHands(caller(), five(true)));
    expect(slugs(res)).toEqual(["shared"]);
    expect(res).toMatchObject({ available: true, neighbours: 5 });
    expect(JSON.stringify(res)).not.toContain("solo-secret");
    // No trace: the whole answer is the one given when those ratings are not there.
    expect(res).toEqual(similarHands(caller(), five(false)));
    // (A pool in which those ratings could change the order, so that this
    // equality has teeth, is in "what a hidden rating cannot do" below.)
  });

  it("a mouse with exactly 5 neighbour raters is listed", () => {
    const pool = [
      ...crowd("a", "pair", [5, 4, 5, 4, 5]),
      ...crowd("b", "solo", [1, 1, 1, 1]),
    ];
    const res = parsed(similarHands(caller(), pool));
    expect(slugs(res)).toEqual(["pair"]);
  });

  it("ratings by people who are not neighbours do not make a mouse reach the floor", () => {
    const pool = [
      ...crowd("near", "m", same(SIMILAR_MIN_PEOPLE - 1, 5)),
      ...crowd("far", "m", same(10, 5), { handLengthBinMm: HAND + 50 }),
      ...crowd("edge", "m", same(10, 5), { handLengthBinMm: 200 }),
    ];
    expect(similarHands(caller(), pool)).toEqual(UNAVAILABLE);
  });
});

// ------------------------------------------------- the caller's own data

describe("the caller's own contributions", () => {
  const mine = person("mine", [rate("m", 1), rate("only-mine", 5)]);
  const four = crowd("other", "m", same(4, 5));

  it("are not neighbours: four other people are still 4 neighbours", () => {
    const pool = [mine, ...four];
    expect(
      similarHands(caller({ ownContributionIds: new Set(["mine"]) }), pool),
    ).toEqual(UNAVAILABLE);
  });

  it("without the exclusion that same pool would have answered", () => {
    // The previous test is only meaningful if the pool is enough for an
    // answer when the caller is not excluded.
    const pool = [mine, ...four];
    const res = parsed(similarHands(caller(), pool));
    expect(res).toMatchObject({ available: true, neighbours: 5 });
  });

  it("are not counted as raters and do not move the mean", () => {
    const pool = [mine, ...crowd("n", "m", [5, 3, 4, 4, 4])];
    const res = parsed(
      similarHands(caller({ ownContributionIds: new Set(["mine"]) }), pool),
    );
    expect(res).toMatchObject({ available: true, neighbours: 5 });
    expect(res.available && res.mice).toEqual([
      expect.objectContaining({ slug: "m", raters: 5, meanSatisfaction: 4 }),
    ]);
  });

  it("change nothing about the answer, whatever they hold", () => {
    const others = [
      ...crowd("n", "m", [5, 3, 4, 4, 4, 4]),
      ...crowd("k", "z", [2, 3, 4, 3, 2]),
    ];
    const c = caller({ ownContributionIds: new Set(["mine", "mine2"]) });
    const without = similarHands(c, others);
    const variants: Contribution[][] = [
      [mine],
      [person("mine", [rate("m", 5), rate("z", 5)])],
      [
        person("mine", [rate("m", 1)]),
        person("mine2", [rate("z", 1), rate("new", 5)], {
          handLengthBinMm: HAND + 5,
        }),
      ],
    ];
    for (const own of variants) {
      expect(similarHands(c, [...own, ...others])).toEqual(without);
    }
  });

  it("are left out of the prior too", () => {
    // `fewAndBig` alone: "few" leads. Four other neighbours rated five mice 1
    // each, and so did the caller ("mine", a neighbour by hand size too). Each
    // of those five mice has the four as its only raters, so none is listed and
    // none is in the prior. If "mine" were counted, each would have five
    // raters, clear the floor and enter the prior, which would fall from 4.84 to
    // (121 + 25) / 50 = 2.92 and put "big" ahead.
    const base = [...fewAndBig(), ...underFloorLows("other")];
    const own = underFloorLow("mine");
    const c = caller({ ownContributionIds: new Set(["mine"]) });
    expect(slugs(similarHands(c, [own, ...base]))).toEqual(["few", "big"]);
    expect(similarHands(c, [own, ...base])).toEqual(similarHands(c, base));
    // The contrast: had "mine" been someone else's, it would count, and the
    // five mice would be listed and drag the prior down.
    expect(slugs(similarHands(caller(), [own, ...base]))).toEqual([
      "big",
      "few",
      "z1",
      "z2",
      "z3",
    ]);
  });

  it("every id the caller owns is left out, including other submissions", () => {
    const owned = ["s1", "s2", "s3"].map((id) => person(id, [rate("m", 5)]));
    const c = caller({ ownContributionIds: new Set(["s1", "s2", "s3"]) });
    expect(similarHands(c, [...owned, ...crowd("o", "m", same(4, 1))])).toEqual(
      UNAVAILABLE,
    );
  });
});

// ------------------------------------------------------------- the means

describe("per-mouse numbers", () => {
  it("raters is the neighbours who rated it; the mean is the plain mean", () => {
    const pool = [
      ...crowd("a", "m", [5, 4, 4, 5, 4]),
      person("b", [rate("m", 1)], { handLengthBinMm: HAND + 20 }), // not near
    ];
    const res = parsed(similarHands(caller(), pool));
    expect(res.available && res.mice).toEqual([
      {
        slug: "m",
        brand: "Brand m",
        model: "Model m",
        raters: 5,
        meanSatisfaction: 22 / 5,
      },
    ]);
  });

  it("returns the real mean even when the ranking score differs from it", () => {
    // "m": 5 neighbours at 5. "dud": eight neighbours at 1. The prior is
    // (25 + 8) / 13 = 2.54, so the score of "m" is (25 + 4 * 2.54) / 9 = 3.906,
    // far below 5. The visitor still sees 5. Ten far-away people at 1 are
    // there too, and are in nobody's count.
    const pool = [
      ...crowd("n", "m", same(5, 5)),
      ...crowd("d", "dud", same(8, 1)),
      ...crowd("f", "m", same(10, 1), { handLengthBinMm: HAND + 40 }),
    ];
    expect(shrunkScore(5, 5, 33 / 13)).toBeCloseTo(3.906, 3);
    const res = parsed(similarHands(caller(), pool));
    expect(res.available && res.mice[0]).toMatchObject({
      slug: "m",
      raters: 5,
      meanSatisfaction: 5,
    });
  });

  it("is exactly sum / n for a mean with no short decimal", () => {
    const res = parsed(
      similarHands(caller(), crowd("n", "m", [5, 4, 4, 5, 4, 4, 4])),
    );
    expect(res.available && res.mice[0]?.meanSatisfaction).toBe(30 / 7);
  });

  it("ignores a rating that is not a whole number from 1 to 5, and does not clamp or round it", () => {
    // The survey's `satisfaction` is an integer, 1 to 5 (survey.ts).
    const bad = [
      6,
      0,
      -1,
      0.9,
      5.1,
      2.5,
      4.5,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ];
    const pool = [
      ...crowd("ok", "m", same(5, 4)),
      ...bad.map((v, i) => person(`bad${i}`, [rate("m", v)])),
    ];
    const res = parsed(similarHands(caller(), pool));
    expect(res).toMatchObject({
      available: true,
      neighbours: 5 + bad.length,
    });
    expect(res.available && res.mice).toEqual([
      expect.objectContaining({ raters: 5, meanSatisfaction: 4 }),
    ]);
  });

  it("takes 1 and 5, the ends of the scale", () => {
    const res = parsed(
      similarHands(caller(), crowd("e", "m", [1, 5, 5, 1, 3])),
    );
    expect(res.available && res.mice).toEqual([
      expect.objectContaining({ raters: 5, meanSatisfaction: 3 }),
    ]);
  });

  it("leaves out a mouse a contributor names twice, rather than pick one", () => {
    // "twice" names "m" twice (5 and 1), so their answer for "m" is left out:
    // "m" keeps the 5 others (all 3s); "n" has all 6 (twice and the 5 others).
    const others = [1, 2, 3, 4, 5].map((i) =>
      person(`b${i}`, [rate("m", 3), rate("n", 4)]),
    );
    const pool = [
      person("twice", [rate("m", 5), rate("m", 1), rate("n", 4)]),
      ...others,
    ];
    const res = parsed(similarHands(caller(), pool));
    expect(res.available && res.mice).toEqual([
      expect.objectContaining({ slug: "n", raters: 6, meanSatisfaction: 4 }),
      expect.objectContaining({ slug: "m", raters: 5, meanSatisfaction: 3 }),
    ]);
  });

  it("shows one name per slug whatever the order of the pool", () => {
    const named = (id: string, brand: string, model: string) =>
      person(id, [{ slug: "m", brand, model, satisfaction: 4 }]);
    const pool = [
      named("a", "Zed", "Alpha"),
      named("b", "Acme", "Pro"),
      named("c", "Acme", "Basic"),
      named("d", "Zed", "Alpha"),
      named("e", "Acme", "Pro"),
    ];
    const next = prng(7);
    for (let i = 0; i < 10; i++) {
      const res = similarHands(caller(), shuffled(pool, next));
      expect(res.available && res.mice[0]).toMatchObject({
        brand: "Acme",
        model: "Basic",
      });
    }
  });
});

// ------------------------------------------------------------- the ranking

describe("ranking", () => {
  it("shrunkScore: one 5 does not beat eight 4.6s when the prior is under about 4.43", () => {
    // With weight 4 the two cross at a prior of about 4.43 (the lone 5 trails
    // exactly when 28g < 124, g < 4.4286): above it the lone 5 is pulled up by
    // the prior more than the eight 4.6s are, and leads. The prior is the
    // neighbours' mean over the mice that clear the floor, so a prior that high
    // means they rate those mice high, and then a 5 should lead.
    for (const prior of [1, 2, 3, 4, 4.2, 4.4]) {
      expect(shrunkScore(1, 5, prior)).toBeLessThan(shrunkScore(8, 4.6, prior));
    }
    expect(shrunkScore(1, 5, 4.45)).toBeGreaterThan(shrunkScore(8, 4.6, 4.45));
  });

  it.each([
    [5, 4.6],
    [4.9, 4.5],
    [4, 3.5],
  ])(
    "shrunkScore: 2 raters at %s fall under 8 raters at %s exactly when a + prior < 2b",
    (a, b) => {
      // (2a + 4g) / 6 < (8b + 4g) / 12  <=>  a + g < 2b  <=>  g < 2b - a
      expect(SIMILAR_PRIOR_WEIGHT).toBe(4);
      const edge = 2 * b - a;
      expect(shrunkScore(2, a, edge - 0.01)).toBeLessThan(
        shrunkScore(8, b, edge - 0.01),
      );
      expect(shrunkScore(2, a, edge + 0.01)).toBeGreaterThan(
        shrunkScore(8, b, edge + 0.01),
      );
    },
  );

  it("shrunkScore: 5 raters at 5 fall under 20 raters at 4.8 exactly when the prior is under 4.4", () => {
    // The pair `fewAndBig` is built on (the floor of five against twenty).
    expect(shrunkScore(5, 5, 4.39)).toBeLessThan(shrunkScore(20, 4.8, 4.39));
    expect(shrunkScore(5, 5, 4.41)).toBeGreaterThan(shrunkScore(20, 4.8, 4.41));
  });

  it("shrunkScore: a prior between two means (inclusive) never reverses them", () => {
    // score - prior = n * (mean - prior) / (n + m): it has the sign of
    // (mean - prior), so the higher mean stays at or above the prior and the
    // lower at or below it, whatever the two group sizes.
    const grid = (from: number, to: number, step: number): number[] => {
      const out: number[] = [];
      for (let v = from; v <= to + 1e-9; v += step) out.push(v);
      return out;
    };
    let checked = 0;
    for (const a of grid(1.5, 5, 0.5)) {
      for (const b of grid(1, a - 0.5, 0.5)) {
        for (const g of grid(b, a, 0.25)) {
          for (let n1 = 1; n1 <= 12; n1++) {
            for (let n2 = 1; n2 <= 12; n2++) {
              expect(shrunkScore(n1, a, g)).toBeGreaterThan(
                shrunkScore(n2, b, g),
              );
              checked += 1;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("shrunkScore: moves from the prior toward the mean as n grows", () => {
    expect(shrunkScore(0, 5, 3)).toBe(3);
    const at = (n: number) => shrunkScore(n, 5, 3);
    expect(at(1)).toBeGreaterThan(3);
    expect(at(2)).toBeGreaterThan(at(1));
    expect(at(100)).toBeLessThan(5);
    expect(at(100)).toBeGreaterThan(4.9);
    expect(shrunkScore(SIMILAR_PRIOR_WEIGHT, 5, 3)).toBe(4);
  });

  /**
   * 20 neighbours rate "steady" (sixteen 5s, four 4s: mean exactly 4.8). Five of
   * them also rate "flashy" at 5, and five of them rate "dud" at 1. The
   * neighbours' plain mean for flashy is higher (5 against 4.8), but only five
   * of them say so, and these neighbours rate mice low in general: prior g =
   * (96 + 25 + 5) / 30 = 4.2, under the 4.4 at which five 5s fall under twenty
   * 4.8s, so flashy = (25 + 4g) / 9 = 4.644 and steady = (96 + 4g) / 24 = 4.7.
   * The ones who disagree are neighbours: ratings from far away do not count
   * (see "what a hidden rating cannot do").
   */
  function steadyVsFlashy(): Contribution[] {
    const people = crowd("s", "steady", BIG);
    const rated = (c: Contribution, extra: ContributedRating[]) => ({
      ...c,
      ratings: [...c.ratings, ...extra],
    });
    return people.map((c, i) => {
      if (i < 5) return rated(c, [rate("flashy", 5)]);
      if (i < 10) return rated(c, [rate("dud", 1)]);
      return c;
    });
  }

  it("five 5s that the neighbours' other ratings put in doubt do not outrank twenty 4.8s", () => {
    const res = parsed(similarHands(caller(), steadyVsFlashy()));
    expect(slugs(res)).toEqual(["steady", "flashy", "dud"]);
    // The numbers shown are the plain ones, not the shrunk ones.
    expect(res.available && res.mice).toEqual([
      expect.objectContaining({
        slug: "steady",
        raters: 20,
        meanSatisfaction: 4.8,
      }),
      expect.objectContaining({
        slug: "flashy",
        raters: 5,
        meanSatisfaction: 5,
      }),
      expect.objectContaining({
        slug: "dud",
        raters: 5,
        meanSatisfaction: 1,
      }),
    ]);
  });

  it("with no prior weight the same pool ranks by plain mean (contrast)", () => {
    const res = similarHands(caller(), steadyVsFlashy(), {
      ...DEFAULT_SIMILAR_RULES,
      priorWeight: 0,
    });
    expect(slugs(res)).toEqual(["flashy", "steady", "dud"]);
  });

  it("a mouse everyone loves keeps its lead", () => {
    const pool = [
      ...crowd("a", "loved", same(5, 5)),
      ...crowd("b", "meh", same(5, 3)),
      ...crowd("far", "loved", same(8, 5), { palmWidthBinMm: PALM + 30 }),
    ];
    expect(slugs(similarHands(caller(), pool))).toEqual(["loved", "meh"]);
  });

  it("an exact tie goes to more raters, whatever the slug order", () => {
    // Both score exactly 4: 5 raters and 6 raters, all 4s, nobody else.
    const pool = [
      ...[1, 2, 3, 4, 5].map((i) =>
        person(`p${i}`, [rate("a-five", 4), rate("b-six", 4)]),
      ),
      person("p6", [rate("b-six", 4)]),
    ];
    expect(slugs(similarHands(caller(), pool))).toEqual(["b-six", "a-five"]);
  });

  it("then goes to the slug, in code-unit order", () => {
    const same5 = (rates: string[]) =>
      [1, 2, 3, 4, 5].map((i) =>
        person(
          `p${i}`,
          rates.map((s) => rate(s, 4)),
        ),
      );
    const pool = same5(["a-2", "a-10", "a-1"]);
    const next = prng(11);
    for (let i = 0; i < 10; i++) {
      const order = slugs(similarHands(caller(), shuffled(pool, next)));
      expect(order).toEqual(["a-1", "a-10", "a-2"]);
    }
    // Upper case sorts before lower case in code-unit order, not in a locale's.
    const mixed = same5(["b", "B"]);
    expect(slugs(similarHands(caller(), mixed))).toEqual(["B", "b"]);
  });

  it("scores equal on paper but a float apart are still a tie", () => {
    // `few`: 5 raters, sum 6; `many`: 10 raters, sum 12. Mean 1.2 for both and
    // nobody else rated either, so the scores are equal on paper. In floats the
    // first comes out 1.2000000000000002 and the second 1.2. They are a tie,
    // and the tie goes to the mouse with more raters although "a-few" sorts first.
    const few = [1, 1, 1, 1, 2];
    const many = [1, 1, 1, 1, 1, 1, 1, 1, 2, 2];
    const pool = many.map((m, i) => {
      const ratings = [rate("b-many", m)];
      if (i < few.length) ratings.push(rate("a-few", few[i]!));
      return person(`p${i}`, ratings);
    });
    expect(slugs(similarHands(caller(), pool))).toEqual(["b-many", "a-few"]);
  });

  it("scores a hair apart (a millionth) are not a tie: the higher one leads, with fewer raters", () => {
    // "x": five 5s. "y": 5, 5, 5, 5, 5, 4 (more raters, lower mean). The five
    // who rate "x" rate "y" 5 too, and a sixth rates "y" 4, so the prior is
    // (25 + 29) / 11 = 4.909. A prior weight of 1e6 (a positive number is all
    // the rule asks for) squeezes both scores to within a millionth of 4.909,
    // and "x" scores about 9e-7 above "y": far over the 1e-9 tie guard, far
    // under 1e-3. A guard as wide as 1e-3 or 0.01 would call it a tie and put
    // "y" first, as it has more raters.
    const weight = 1e6;
    const gap =
      shrunkScore(5, 5, 54 / 11, weight) -
      shrunkScore(6, 29 / 6, 54 / 11, weight);
    expect(gap).toBeGreaterThan(1e-7);
    expect(gap).toBeLessThan(1e-5);
    const pool = [
      ...[1, 2, 3, 4, 5].map((i) =>
        person(`p${i}`, [rate("x", 5), rate("y", 5)]),
      ),
      person("p6", [rate("y", 4)]),
    ];
    const rules = { ...DEFAULT_SIMILAR_RULES, priorWeight: weight };
    const next = prng(13);
    for (let i = 0; i < 10; i++) {
      expect(
        slugs(similarHands(caller(), shuffled(pool, next), rules)),
      ).toEqual(["x", "y"]);
    }
  });

  it("lists at most MAX_SIMILAR_MICE, the best of them", () => {
    // Seven mice, each rated by the same five neighbours with the stars above,
    // so the order is known.
    const stars = [5, 5, 4, 4, 3, 2, 1];
    const both = () => stars.map((s, i) => rate(`m${i}`, s));
    const pool = [1, 2, 3, 4, 5].map((i) => person(`p${i}`, both()));
    const res = parsed(similarHands(caller(), pool));
    expect(MAX_SIMILAR_MICE).toBe(5);
    expect(slugs(res)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
  });
});

// ------------------------------------------- the prior: one neighbour mean

describe("ranking: the prior is the neighbours' mean over the mice that clear the floor", () => {
  const ids = (res: SimilarResponse) => slugs(res);

  it("works in a small pool where everybody is a neighbour", () => {
    // A: 5 people rate 5. B: 20 people rate 4.8 on average (sixteen 5s, four
    // 4s). C: 40 people rate 2. Everyone is a neighbour and all three mice
    // clear the floor, so a prior that is a mouse's own mean would be its plain
    // mean.
    //   prior g = (5*5 + 20*4.8 + 40*2) / 65 = (25 + 96 + 80) / 65 = 3.092
    //   A = (25 + 4g) / 9   = 4.152
    //   B = (96 + 4g) / 24  = 4.515
    //   C = (80 + 4g) / 44  = 2.099
    // so B, A, C. By plain mean it is A (5), B (4.8), C (2).
    const pool = [
      ...crowd("a", "mouse-a", same(5, 5)),
      ...crowd("b", "mouse-b", BIG),
      ...crowd("c", "mouse-c", same(40, 2)),
    ];
    const g = 201 / 65;
    expect(shrunkScore(5, 5, g)).toBeCloseTo(4.1523, 3);
    expect(shrunkScore(20, 4.8, g)).toBeCloseTo(4.5154, 3);
    expect(shrunkScore(40, 2, g)).toBeCloseTo(2.0993, 3);

    const res = parsed(similarHands(caller(), pool));
    expect(ids(res)).toEqual(["mouse-b", "mouse-a", "mouse-c"]);
    expect(res).toMatchObject({ available: true, neighbours: 65 });
    // What is shown is still the neighbours' plain mean, not the shrunk score.
    expect(res.available && res.mice).toEqual([
      expect.objectContaining({
        slug: "mouse-b",
        raters: 20,
        meanSatisfaction: 96 / 20,
      }),
      expect.objectContaining({
        slug: "mouse-a",
        raters: 5,
        meanSatisfaction: 5,
      }),
      expect.objectContaining({
        slug: "mouse-c",
        raters: 40,
        meanSatisfaction: 2,
      }),
    ]);
    // The contrast: with no prior it is the plain-mean order.
    const plain = similarHands(caller(), pool, {
      ...DEFAULT_SIMILAR_RULES,
      priorWeight: 0,
    });
    expect(ids(plain)).toEqual(["mouse-a", "mouse-b", "mouse-c"]);
  });

  it("a prior above both means lets the smaller group's lower mean pass (the other direction)", () => {
    // H: 50 people (ten 5s, forty 4s: mean 4.2). S: 5 people (all 4: mean 4.0).
    // T: 100 people (ninety 5s, ten 4s: mean 4.9), the third mouse that lifts
    // the prior above both H and S.
    //   prior g = (210 + 20 + 490) / 155 = 720 / 155 = 4.645
    //   H = (210 + 4g) / 54 = 4.233   S = (20 + 4g) / 9 = 4.287
    //   T = (490 + 4g) / 104 = 4.890
    // so T, S, H, though by plain mean it is T (4.9), H (4.2), S (4.0).
    const pool = [
      ...crowd("h", "mouse-h", [...same(10, 5), ...same(40, 4)]),
      ...crowd("s", "mouse-s", same(5, 4)),
      ...crowd("t", "mouse-t", [...same(90, 5), ...same(10, 4)]),
    ];
    const g = 720 / 155;
    expect(shrunkScore(50, 4.2, g)).toBeCloseTo(4.233, 3);
    expect(shrunkScore(5, 4, g)).toBeCloseTo(4.2867, 3);
    expect(shrunkScore(100, 4.9, g)).toBeCloseTo(4.8903, 3);

    const res = parsed(similarHands(caller(), pool));
    expect(ids(res)).toEqual(["mouse-t", "mouse-s", "mouse-h"]);
    // What is shown is still each group's plain mean.
    expect(res.available && res.mice.map((m) => m.meanSatisfaction)).toEqual([
      4.9, 4, 4.2,
    ]);
    const plain = similarHands(caller(), pool, {
      ...DEFAULT_SIMILAR_RULES,
      priorWeight: 0,
    });
    expect(ids(plain)).toEqual(["mouse-t", "mouse-h", "mouse-s"]);
  });

  it("a prior between two means leaves their order alone", () => {
    // `fewAndBig` alone: g = 4.84 is between 4.8 and 5.
    //   few = (25 + 4 * 4.84) / 9   = 4.929
    //   big = (96 + 4 * 4.84) / 24  = 4.807
    // "few" stays ahead, as by plain mean. It takes a prior under 4.4 to
    // reverse them (see `fewAndBig`), and the next test shows one.
    const res = similarHands(caller(), fewAndBig());
    expect(ids(res)).toEqual(["few", "big"]);
    expect(ids(res)).toEqual(
      ids(
        similarHands(caller(), fewAndBig(), {
          ...DEFAULT_SIMILAR_RULES,
          priorWeight: 0,
        }),
      ),
    );
    expect(shrunkScore(5, 5, 121 / 25)).toBeGreaterThan(
      shrunkScore(20, 4.8, 121 / 25),
    );
  });

  it("a third mouse that clears the floor can reverse the two", () => {
    // `fewAndBig` plus "low", five 1s: prior (121 + 5) / 30 = 4.2, under 4.4.
    const pool = [...fewAndBig(), ...lowCrowd()];
    expect(ids(similarHands(caller(), pool))).toEqual(["big", "few", "low"]);
    expect(
      ids(
        similarHands(caller(), pool, {
          ...DEFAULT_SIMILAR_RULES,
          priorWeight: 0,
        }),
      ),
    ).toEqual(["few", "big", "low"]);
  });

  it("with only two mice that clear the floor, the prior never reverses them", () => {
    // The prior is a weighted mean of the two plain means, so it lies between
    // them, and a prior between two means leaves their order alone. Random
    // pairs of mice (whole-number ratings, 5 to 16 raters each).
    const next = prng(77);
    let checked = 0;
    for (let i = 0; i < 300; i++) {
      const ratingsOf = (): number[] =>
        Array.from(
          { length: 5 + Math.floor(next() * 12) },
          () => 1 + Math.floor(next() * 5),
        );
      const a = ratingsOf();
      const b = ratingsOf();
      const sum = (v: number[]) => v.reduce((x, y) => x + y, 0);
      // Means must differ by more than the tie guard for the order to be defined.
      if (sum(a) * b.length === sum(b) * a.length) continue;
      const pool = [...crowd("a", "mouse-a", a), ...crowd("b", "mouse-b", b)];
      const res = similarHands(caller(), pool);
      const plain = similarHands(caller(), pool, {
        ...DEFAULT_SIMILAR_RULES,
        priorWeight: 0,
      });
      expect(ids(res)).toEqual(ids(plain));
      checked += 1;
    }
    expect(checked).toBeGreaterThan(200);
  });

  it("is a mean over ratings, not a mean of the mice's means", () => {
    // `fewAndBig` plus "forty": 40 people, ten 3s and thirty 4s (mean 3.75).
    //   over ratings: g = (121 + 150) / 65 = 4.169
    //     few = (25 + 4g) / 9 = 4.631      big = (96 + 4g) / 24 = 4.695
    //   over mice:    g = (5 + 4.8 + 3.75) / 3 = 4.517
    //     few = (25 + 4g) / 9 = 4.785      big = (96 + 4g) / 24 = 4.753
    // The first puts "big" ahead, the second "few": the pool tells them apart.
    const pool = [
      ...fewAndBig(),
      ...crowd("f", "forty", [...same(10, 3), ...same(30, 4)]),
    ];
    const overRatings = 271 / 65;
    const overMice = (5 + 4.8 + 3.75) / 3;
    expect(shrunkScore(5, 5, overRatings)).toBeLessThan(
      shrunkScore(20, 4.8, overRatings),
    );
    expect(shrunkScore(5, 5, overMice)).toBeGreaterThan(
      shrunkScore(20, 4.8, overMice),
    );
    expect(ids(similarHands(caller(), pool))).toEqual(["big", "few", "forty"]);
  });

  it("a mouse with exactly the floor of raters is in the prior, one fewer is not", () => {
    // `fewAndBig` plus "pair", five neighbours at 1: the prior falls from 4.84
    // to (121 + 5) / 30 = 4.2, under 4.4, and "big" leads. With four raters it
    // would be hidden and would move nothing.
    expect(SIMILAR_MIN_PEOPLE).toBe(5);
    const withFive = [...fewAndBig(), ...crowd("pair", "pair", same(5, 1))];
    expect(ids(similarHands(caller(), withFive))).toEqual([
      "big",
      "few",
      "pair",
    ]);
    const withFour = [...fewAndBig(), ...crowd("pair", "pair", same(4, 1))];
    expect(ids(similarHands(caller(), withFour))).toEqual(["few", "big"]);
  });

  it("a mouse that falls outside the top five is still in the prior", () => {
    // Five mice that every ranking puts at the top, "few", "p1".."p3" (five 5s
    // each) and "big" (mean 4.8), and "low", twenty 1s, which ranks sixth and is
    // not listed. The prior with "low" is (196 + 20) / 60 = 3.6, and with it
    // "big" leads; without it the prior is 196 / 40 = 4.9 and "big" is last.
    const top = [
      ...fewAndBig(),
      ...crowd("p1", "p1", same(5, 5)),
      ...crowd("p2", "p2", same(5, 5)),
      ...crowd("p3", "p3", same(5, 5)),
    ];
    const low = crowd("low", "low", same(20, 1));
    const without = parsed(similarHands(caller(), top));
    const withLow = parsed(similarHands(caller(), [...top, ...low]));
    expect(ids(without)).toEqual(["few", "p1", "p2", "p3", "big"]);
    expect(ids(withLow)).toEqual(["big", "few", "p1", "p2", "p3"]);
    expect(MAX_SIMILAR_MICE).toBe(5);
  });

  it.each([
    ["off the 1 to 5 scale", () => [rate("few", 0), rate("big", 6)]],
    [
      "below 1 or above 5 by a fraction",
      () => [rate("few", 0.9), rate("big", 5.1)],
    ],
    ["between two whole numbers", () => [rate("few", 2.5), rate("big", 4.5)]],
    [
      "not a number or infinite",
      () => [rate("few", Number.NaN), rate("big", Number.POSITIVE_INFINITY)],
    ],
    [
      "named twice by the same person",
      () => [rate("few", 1), rate("few", 1), rate("big", 1), rate("big", 1)],
    ],
  ])("leaves out a rating that is %s", (_name, ratings) => {
    // The same filter as everywhere else. Somebody who is a neighbour and whose
    // every rating is one of these is a neighbour who rated nothing: the answer
    // is the one for the same pool where they rated nothing.
    const base = [...fewAndBig(), ...lowCrowd()];
    const withOdd = [...base, person("odd", ratings())];
    const withNothing = [...base, person("odd", [])];
    expect(similarHands(caller(), withOdd)).toEqual(
      similarHands(caller(), withNothing),
    );
    expect(ids(similarHands(caller(), withOdd))).toEqual(["big", "few", "low"]);
  });

  it("does not depend on the order of the pool", () => {
    const small = [
      ...crowd("a", "mouse-a", same(5, 5)),
      ...crowd("b", "mouse-b", BIG),
      ...crowd("c", "mouse-c", same(40, 2)),
    ];
    const withExtras = [
      ...fewAndBig(),
      ...lowCrowd(),
      ...underFloorLows("other"),
      ...underFloorLows("far", { handLengthBinMm: HAND + 50 }),
    ];
    const next = prng(31);
    for (const pool of [small, withExtras]) {
      const expected = JSON.stringify(similarHands(caller(), pool));
      for (let i = 0; i < 25; i++) {
        expect(
          JSON.stringify(similarHands(caller(), shuffled(pool, next))),
        ).toBe(expected);
      }
    }
  });
});

// ------------------------------------------- what a hidden rating cannot do

describe("what a hidden rating cannot do", () => {
  const far = { handLengthBinMm: HAND + 50 };

  /**
   * `fewAndBig`, with one of its twenty "big" raters also rating "secret", a
   * mouse nobody else rated, as `s` (or not at all, for `null`).
   */
  function poolWithVictim(s: number | null): Contribution[] {
    return fewAndBig().map((c) =>
      c.id === "big0" && s !== null
        ? { ...c, ratings: [...c.ratings, rate("secret", s)] }
        : c,
    );
  }

  /** `k` people, each rating a mouse of their own with 1: nobody else rates it. */
  function probes(k: number, over: Partial<Contribution>): Contribution[] {
    return Array.from({ length: k }, (_, i) =>
      person(`probe${i}`, [rate(`probe-mouse-${i}`, 1)], over),
    );
  }

  it.each([
    ["near the caller", {}],
    ["far from the caller", far],
  ])(
    "the answer is the same whatever a hidden mouse's one rater said, with probes %s",
    (_name, over) => {
      // The attack: a victim rates "secret" with s; the attacker adds k people
      // who each rate a mouse of their own with 1, and watches the order of
      // "few" and "big" (the response never contains "secret"). Under a prior
      // over every rating of every mouse, the prior is
      // (121 + s + k) / (26 + k) and "few" falls under "big" once it is under
      // 4.4, which happens at a k that depends on s, so the flip point gives s
      // away. Here, for every s and every k, the whole answer must be the one
      // for the pool where "secret" was never rated.
      const flipAt = (s: number): number => {
        for (let k = 0; k <= 60; k++) {
          const g = (121 + s + k) / (26 + k);
          if (shrunkScore(5, 5, g) < shrunkScore(20, 4.8, g)) return k;
        }
        return Infinity;
      };
      // The premise has teeth: under that rule the flip point is not the same
      // for every s.
      expect(new Set([1, 2, 3, 4, 5].map(flipAt)).size).toBeGreaterThan(1);
      for (let s = 1; s <= 5; s++) {
        for (let k = 0; k <= 30; k++) {
          const extra = probes(k, over);
          const without = similarHands(caller(), [
            ...poolWithVictim(null),
            ...extra,
          ]);
          expect(slugs(without)).toEqual(["few", "big"]);
          expect(
            similarHands(caller(), [...poolWithVictim(s), ...extra]),
          ).toEqual(without);
        }
      }
    },
  );

  it("a mouse one rater under the floor is not in the prior, whatever the raters gave it", () => {
    // `underFloorLows`: four neighbours rate five mice 1 each, and nobody else
    // rates them. They are never listed. Counted, they would pull the prior
    // from 4.84 to 3.13 and put "big" ahead of "few"; the answer must be the
    // one where those people rated nothing.
    const base = fewAndBig();
    const hidden = similarHands(caller(), [
      ...base,
      ...underFloorLows("other"),
    ]);
    const nothing = similarHands(caller(), [
      ...base,
      ...[0, 1, 2, 3].map((i) => person(`other${i}`, [])),
    ]);
    expect(slugs(nothing)).toEqual(["few", "big"]);
    expect(hidden).toEqual(nothing);
  });

  it("people who are not neighbours move nothing, whatever they rated", () => {
    // Far away, and just across a grid line: five solo mice rated 1 by enough
    // people to clear the floor, unrelated mice rated 1 and 5, and a crowd that
    // rated the listed mice themselves 1. None of it is in any neighbour count,
    // so none of it is in the prior or the means.
    const base = [...fewAndBig(), ...lowCrowd()];
    const across = { handLengthBinMm: 200 };
    const noise = [
      ...underFloorLows("far-solo", far),
      underFloorLow("far-solo-5", far),
      ...underFloorLows("across-solo", across),
      underFloorLow("across-solo-5", across),
      ...crowd("far-one", "u1", same(6, 1), far),
      ...crowd("far-five", "u1", same(6, 5), far),
      ...crowd("far-few", "few", same(10, 1), far),
      ...crowd("far-big", "big", same(10, 5), far),
      ...crowd("across-few", "few", same(10, 1), across),
    ];
    expect(similarHands(caller(), [...base, ...noise])).toEqual(
      similarHands(caller(), base),
    );
    expect(slugs(similarHands(caller(), base))).toEqual(["big", "few", "low"]);
    // Whatever they say, 1 or 5.
    for (const stars of [1, 5]) {
      const crowdFar = crowd("far-all", "big", same(12, stars), far);
      expect(similarHands(caller(), [...base, ...crowdFar])).toEqual(
        similarHands(caller(), base),
      );
    }
  });
});

// ------------------------------------- fixed cells: what the caller can ask

/** Every hand length and palm width bin in the cell 180 to 199 / 90 to 99 mm. */
const HAND_POSITIONS = [180, 185, 190, 195];
const PALM_POSITIONS = [90, 95];

describe("fixed cells: one cell, one answer", () => {
  /** A pool that spreads people over several cells and has a mix of ratings. */
  function spread(): Contribution[] {
    const next = prng(606);
    const mice = ["a", "b", "c", "d", "e", "f"];
    return Array.from({ length: 220 }, (_, i) =>
      person(
        `c${i}`,
        mice
          .filter(() => next() < 0.7)
          .map((slug) => rate(slug, 1 + Math.floor(next() * 5))),
        {
          handLengthBinMm: 160 + 5 * Math.floor(next() * 12),
          palmWidthBinMm: 80 + 5 * Math.floor(next() * 6),
        },
      ),
    );
  }

  it("a caller anywhere inside the cell gets exactly the same answer", () => {
    const pool = spread();
    const first = similarHands(
      caller({ handLengthBinMm: 180, palmWidthBinMm: 90 }),
      pool,
    );
    expect(first.available).toBe(true);
    for (const hand of HAND_POSITIONS) {
      for (const palm of PALM_POSITIONS) {
        const res = similarHands(
          caller({ handLengthBinMm: hand, palmWidthBinMm: palm }),
          pool,
        );
        expect(withoutBasis(res)).toEqual(withoutBasis(first));
        // basis still repeats the caller's own bin (the contract is unchanged).
        expect(res.available && res.basis).toEqual({
          handLengthBinMm: hand,
          palmWidthBinMm: palm,
          gripStyle: "palm",
        });
      }
    }
  });

  it("holds for every cell of the pool, whatever the pool's order", () => {
    const pool = spread();
    const next = prng(8);
    for (const handCell of [160, 180, 200]) {
      for (const palmCell of [80, 90, 100]) {
        const answers = new Set<string>();
        for (const hand of [
          handCell,
          handCell + 5,
          handCell + 10,
          handCell + 15,
        ]) {
          for (const palm of [palmCell, palmCell + 5]) {
            const res = similarHands(
              caller({ handLengthBinMm: hand, palmWidthBinMm: palm }),
              shuffled(pool, next),
            );
            answers.add(JSON.stringify(withoutBasis(res)));
          }
        }
        expect(answers.size).toBe(1);
      }
    }
  });

  it("people on either side of a grid line are not neighbours of each other", () => {
    // Five at 195 mm and five at 200 mm, the same palm cell: each caller gets
    // only the five of their own cell, and the answers share no person.
    const low = crowd("low", "m", [5, 5, 5, 5, 5], { handLengthBinMm: 195 });
    const high = crowd("high", "m", [1, 1, 1, 1, 1], { handLengthBinMm: 200 });
    const pool = [...low, ...high];
    const below = parsed(similarHands(caller({ handLengthBinMm: 195 }), pool));
    const above = parsed(similarHands(caller({ handLengthBinMm: 200 }), pool));
    expect(below).toMatchObject({ available: true, neighbours: 5 });
    expect(above).toMatchObject({ available: true, neighbours: 5 });
    expect(below.available && below.mice[0]?.meanSatisfaction).toBe(5);
    expect(above.available && above.mice[0]?.meanSatisfaction).toBe(1);
    // The same across a palm width grid line (95 and 100).
    const palmLow = crowd("pl", "m", same(5, 4), { palmWidthBinMm: 95 });
    const palmHigh = crowd("ph", "m", same(5, 2), { palmWidthBinMm: 100 });
    const palmPool = [...palmLow, ...palmHigh];
    const p1 = parsed(similarHands(caller({ palmWidthBinMm: 95 }), palmPool));
    const p2 = parsed(similarHands(caller({ palmWidthBinMm: 100 }), palmPool));
    expect(p1.available && p1.mice[0]?.meanSatisfaction).toBe(4);
    expect(p2.available && p2.mice[0]?.meanSatisfaction).toBe(2);
  });

  it("the old example (170, 175, 180, 190 mm rating 4, 5, 2, 1) cannot be subtracted into one rating", () => {
    // With a window that followed the caller (+-10 mm), a caller at 180 mm got
    // 4 raters, mean 3, and a caller at 175 mm got 3 raters, mean 3.6667:
    // 4 * 3 - 3 * 3.6667 = 1, the rating of the 190 mm hand. Under fixed cells
    // the four hands are in two cells: [160, 180) holds 170 and 175 and
    // [180, 200) holds 180 and 190.
    const hands = [170, 175, 180, 190];
    const stars = [4, 5, 2, 1];
    const four = hands.map((hand, i) =>
      person(`h${hand}`, [rate("m", stars[i]!)], { handLengthBinMm: hand }),
    );
    // As they are, nobody has an answer: two people in a cell are under the
    // floor, so there is nothing to subtract, from any position.
    for (let hand = 160; hand <= 195; hand += 5) {
      expect(similarHands(caller({ handLengthBinMm: hand }), four)).toEqual(
        UNAVAILABLE,
      );
    }
    // With three more people in each cell, so that each reaches the floor, the
    // two cells answer. Cell 160 to 179: 4, 5 and three 3s (sum 18, mean 3.6).
    // Cell 180 to 199: 2, 1 and three 3s (sum 12, mean 2.4).
    const filler = (prefix: string, hand: number) =>
      crowd(prefix, "m", [3, 3, 3], { handLengthBinMm: hand });
    const pool = [...four, ...filler("fa", 165), ...filler("fb", 185)];
    const answers = new Map<number, SimilarResponse>();
    for (let hand = 160; hand <= 195; hand += 5) {
      answers.set(
        hand,
        parsed(similarHands(caller({ handLengthBinMm: hand }), pool)),
      );
    }
    const totals = new Set<string>();
    for (const [hand, res] of answers) {
      expect(res.available).toBe(true);
      expect(res.available && res.neighbours).toBe(5);
      expect(res.available && res.mice[0]?.raters).toBe(5);
      const mean = res.available ? res.mice[0]!.meanSatisfaction : 0;
      expect(mean).toBe(hand < 180 ? 3.6 : 2.4);
      totals.add(JSON.stringify(withoutBasis(res)));
    }
    // Two answers in all, for 8 positions: two groups of five people that share
    // nobody. Whichever two a caller subtracts, they get a whole cell's total
    // (18 or 12) or zero, never the rating of one person.
    expect(totals.size).toBe(2);
    const sums = new Set(
      [...answers.values()].map((r) =>
        r.available ? r.mice[0]!.raters * r.mice[0]!.meanSatisfaction : 0,
      ),
    );
    expect([...sums].sort((a, b) => a - b)).toEqual([12, 18]);
    for (const a of sums) {
      for (const b of sums) {
        const diff = Math.abs(a - b);
        expect([0, 6]).toContain(diff);
      }
    }
  });
});

// ------------------------------------------------- determinism, immutability

describe("determinism", () => {
  const next = prng(2026);
  const mice = ["m0", "m1", "m2", "m3", "m4", "m5", "m6"];
  const pool: Contribution[] = Array.from({ length: 300 }, (_, i) =>
    person(
      `c${i}`,
      mice
        .filter(() => next() < 0.6)
        .map((slug) => rate(slug, 1 + Math.floor(next() * 5))),
      {
        handLengthBinMm: HAND + 5 * (Math.floor(next() * 7) - 3),
        palmWidthBinMm: PALM + 5 * (Math.floor(next() * 5) - 2),
        gripStyle: (["palm", "claw", "fingertip"] as const)[
          Math.floor(next() * 3)
        ]!,
      },
    ),
  );

  it("gives the same answer twice, bit for bit", () => {
    const first = similarHands(caller(), pool);
    const second = similarHands(caller(), pool);
    expect(first.available).toBe(true); // the pool is big enough to mean something
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(second).toEqual(first);
  });

  it("does not depend on the order of the pool", () => {
    const expected = JSON.stringify(similarHands(caller(), pool));
    const shuffler = prng(99);
    for (let i = 0; i < 25; i++) {
      expect(
        JSON.stringify(similarHands(caller(), shuffled(pool, shuffler))),
      ).toBe(expected);
    }
  });

  it("does not depend on the order of ratings inside a contribution", () => {
    const expected = JSON.stringify(similarHands(caller(), pool));
    const shuffler = prng(5);
    for (let i = 0; i < 10; i++) {
      const reordered = pool.map((c) => ({
        ...c,
        ratings: shuffled(c.ratings, shuffler),
      }));
      expect(JSON.stringify(similarHands(caller(), reordered))).toBe(expected);
    }
  });

  it("gives the same mean for any order of the values", () => {
    // Ratings are whole numbers (a fraction is ignored), so a sum is exact in
    // any order and the ascending sort is only a guard: this checks the visible
    // result, not the sort. Values of 1.1 and its kin, whose float sums depend
    // on the order, can no longer get in.
    const values = [1, 2, 3, 4, 5, 4, 3, 5, 2, 4, 4, 3, 1];
    const base = values.map((v, i) => person(`v${i}`, [rate("m", v)]));
    const shuffler = prng(3);
    const means = new Set<number>();
    for (let i = 0; i < 40; i++) {
      const res = similarHands(caller(), shuffled(base, shuffler));
      if (res.available) means.add(res.mice[0]!.meanSatisfaction);
    }
    expect(means.size).toBe(1);
  });

  it("does not change what it is given", () => {
    const frozen = pool.map((c) =>
      Object.freeze({
        ...c,
        ratings: Object.freeze(c.ratings.map((r) => Object.freeze({ ...r }))),
      }),
    );
    Object.freeze(frozen);
    // `Object.freeze` does not stop a Set from changing (add, delete and clear
    // still work on a frozen Set), so this one throws when they are called.
    class ReadOnlySet extends Set<string> {
      constructor(values: readonly string[]) {
        super();
        for (const value of values) super.add(value);
      }
      override add(value: string): this {
        throw new Error(`add(${value}) on the caller's ownContributionIds`);
      }
      override delete(value: string): boolean {
        throw new Error(`delete(${value}) on the caller's ownContributionIds`);
      }
      override clear(): void {
        throw new Error("clear() on the caller's ownContributionIds");
      }
    }
    const own = new ReadOnlySet(["c1"]);
    expect(() => own.add("x")).toThrow();
    expect(() =>
      similarHands(caller({ ownContributionIds: own }), frozen),
    ).not.toThrow();
    expect(frozen).toEqual(pool);
    expect([...own]).toEqual(["c1"]);
  });

  it("returns a fresh object each time", () => {
    expect(similarHands(caller(), [])).not.toBe(similarHands(caller(), []));
  });
});

// ------------------------------------------------------------- the contract

/** A population wide enough to hit every branch, from a seeded generator. */
function population(): Contribution[] {
  const next = prng(4242);
  const mice = Array.from({ length: 8 }, (_, i) => `mouse-${i}`);
  return Array.from({ length: POPULATION_SIZE }, (_, i) => {
    const count = Math.floor(next() * 5);
    const picked = shuffled(mice, next).slice(0, count);
    return person(
      `c${i}`,
      picked.map((slug) => rate(slug, 1 + Math.floor(next() * 5))),
      {
        handLengthBinMm: 150 + 5 * Math.floor(next() * 13),
        palmWidthBinMm: 70 + 5 * Math.floor(next() * 7),
        gripStyle: (["palm", "claw", "fingertip"] as const)[
          Math.floor(next() * 3)
        ]!,
      },
    );
  });
}
const POPULATION_SIZE = 150;

/**
 * A plain, differently-shaped restatement of the rules, to compare the engine
 * with. It uses integer sums, so its means are exact. A neighbour is somebody
 * in the same 20 mm by 10 mm cell (found by integer division, not the engine's
 * `Math.floor` of a quotient). The prior is one mean over the neighbours'
 * ratings of the mice that at least five neighbours rated (the population below
 * has no rating off the scale and none named twice).
 */
function oracle(c: Caller, pool: readonly Contribution[]) {
  const others = pool.filter((p) => !c.ownContributionIds.has(p.id));
  const cell = (mm: number, width: number) => (mm - (mm % width)) / width;
  const near = others.filter(
    (p) =>
      cell(p.handLengthBinMm, 20) === cell(c.handLengthBinMm, 20) &&
      cell(p.palmWidthBinMm, 10) === cell(c.palmWidthBinMm, 10),
  );
  const rows = new Map<string, { nearSum: number; nearN: number }>();
  for (const p of near) {
    for (const r of p.ratings) {
      const row = rows.get(r.slug) ?? { nearSum: 0, nearN: 0 };
      row.nearSum += r.satisfaction;
      row.nearN += 1;
      rows.set(r.slug, row);
    }
  }
  const clearing = [...rows.entries()].filter(([, row]) => row.nearN >= 5);
  let priorSum = 0;
  let priorN = 0;
  for (const [, row] of clearing) {
    priorSum += row.nearSum;
    priorN += row.nearN;
  }
  const globalMean = priorSum / priorN;
  const listed = clearing
    .map(([slug, row]) => ({
      slug,
      raters: row.nearN,
      mean: row.nearSum / row.nearN,
      score: (row.nearSum + 4 * globalMean) / (row.nearN + 4),
    }))
    .sort(
      (a, b) =>
        (Math.abs(a.score - b.score) > 1e-9 ? b.score - a.score : 0) ||
        b.raters - a.raters ||
        (a.slug < b.slug ? -1 : 1),
    )
    .slice(0, 5);
  return { neighbours: near.length, listed };
}

describe("against the contract and a plain restatement", () => {
  const pool = population();
  const callers: Caller[] = [];
  for (let hand = 150; hand <= 210; hand += 10) {
    for (const palm of [70, 80, 95]) {
      callers.push(
        caller({
          handLengthBinMm: hand,
          palmWidthBinMm: palm,
          gripStyle: (["palm", "claw", "fingertip"] as const)[(hand / 10) % 3]!,
          ownContributionIds: new Set([
            `c${hand % POPULATION_SIZE}`,
            `c${(palm * 7) % POPULATION_SIZE}`,
          ]),
        }),
      );
    }
  }

  it("every answer passes similarResponseSchema", () => {
    let available = 0;
    for (const c of callers) {
      const res = similarHands(c, pool);
      expect(() => similarResponseSchema.parse(res)).not.toThrow();
      if (res.available) available += 1;
    }
    // Both kinds of answer are in the sample, or the loop proves little.
    expect(available).toBeGreaterThan(5);
    expect(available).toBeLessThan(callers.length);
  });

  it("agrees with the restatement on neighbours, mice, raters and means", () => {
    for (const c of callers) {
      const res = similarHands(c, pool);
      const want = oracle(c, pool);
      if (!res.available) {
        expect(want.listed).toEqual([]);
        continue;
      }
      expect(res.neighbours).toBe(want.neighbours);
      expect(
        res.mice.map((m) => [m.slug, m.raters, m.meanSatisfaction]),
      ).toEqual(want.listed.map((m) => [m.slug, m.raters, m.mean]));
      expect(res.mice.length).toBeLessThanOrEqual(MAX_SIMILAR_MICE);
      for (const m of res.mice)
        expect(m.raters).toBeLessThanOrEqual(res.neighbours);
      expect(res.basis).toEqual({
        handLengthBinMm: c.handLengthBinMm,
        palmWidthBinMm: c.palmWidthBinMm,
        gripStyle: c.gripStyle,
      });
    }
  });

  it("is unavailable exactly when the restatement lists nothing", () => {
    for (const c of callers) {
      const res = similarHands(c, pool);
      const want = oracle(c, pool);
      expect(res.available).toBe(
        want.neighbours >= SIMILAR_MIN_PEOPLE && want.listed.length > 0,
      );
    }
  });
});

describe("edges of the measured range", () => {
  it.each([
    [100, 50],
    [100, 150],
    [280, 50],
    [280, 150],
  ])(
    "a caller at %i mm / %i mm gets only the people in the same cell",
    (hand, palm) => {
      // The cells are 100 to 119 / 280 to 299 mm and 50 to 59 / 150 to 159 mm,
      // so +15 mm and +5 mm stay inside and the next bin down (hand 100, palm
      // 50) or the next cell up (hand 280, palm 150) is outside.
      const at = (dh: number, dp: number) => ({
        handLengthBinMm: hand + dh,
        palmWidthBinMm: palm + dp,
      });
      const offsets: Array<[number, number]> = [
        [0, 0],
        [15, 5],
        [5, 0],
        [10, 5],
        [0, 5],
      ];
      const stars = [4, 2, 3, 3, 3];
      const inside = offsets.map(([dh, dp], i) =>
        person(`in${i}`, [rate("m", stars[i]!)], at(dh, dp)),
      );
      const outsideHand = hand === 100 ? hand - 5 : hand + 20;
      const outsidePalm = palm === 50 ? palm - 5 : palm + 10;
      const outside = [
        person("out1", [rate("m", 5)], {
          handLengthBinMm: outsideHand,
          palmWidthBinMm: palm,
        }),
        person("out2", [rate("m", 5)], {
          handLengthBinMm: hand,
          palmWidthBinMm: outsidePalm,
        }),
      ];
      const c = caller({ handLengthBinMm: hand, palmWidthBinMm: palm });
      const res = parsed(similarHands(c, [...outside, ...inside]));
      expect(res).toMatchObject({
        available: true,
        neighbours: 5,
        basis: { handLengthBinMm: hand, palmWidthBinMm: palm },
      });
      expect(res.available && res.mice[0]).toMatchObject({
        raters: 5,
        meanSatisfaction: 3,
      });
    },
  );

  it("does not look past the cell: a pool in the next cell up is not pulled in", () => {
    const pool = [
      ...crowd("a", "m", same(5, 4), { handLengthBinMm: 285 }),
      ...crowd("b", "m", same(5, 4), { handLengthBinMm: 300 }),
    ];
    const res = similarHands(
      caller({ handLengthBinMm: 280, palmWidthBinMm: 90 }),
      pool,
    );
    // Only the 285s are in the cell 280 to 299 mm: 5 neighbours.
    expect(res).toMatchObject({ available: true, neighbours: 5 });
  });

  it.each([
    [182, 90],
    [180, 92.5],
    [Number.NaN, 90],
    [180, Number.POSITIVE_INFINITY],
    [180.5, 90],
  ])(
    "refuses a caller off the bins (%s, %s) instead of matching nobody",
    (hand, palm) => {
      expect(() =>
        similarHands(
          caller({ handLengthBinMm: hand, palmWidthBinMm: palm }),
          [],
        ),
      ).toThrow(RangeError);
    },
  );
});

// ------------------------------------------------------------- no leaks

describe("what the output can give away", () => {
  it("carries counts and means only: no id, no per-person value", () => {
    const pool = [
      ...crowd("secret-id-", "m", [5, 1, 4, 2, 3]),
      person("secret-id-x", [rate("m", 3)]),
    ];
    const res = parsed(similarHands(caller(), pool));
    expect(JSON.stringify(res)).not.toContain("secret-id");
    expect(Object.keys(res).sort()).toEqual([
      "available",
      "basis",
      "mice",
      "neighbours",
    ]);
    expect(res.available && Object.keys(res.mice[0]!).sort()).toEqual([
      "brand",
      "meanSatisfaction",
      "model",
      "raters",
      "slug",
    ]);
  });

  it("a caller who is one of five raters learns nothing of the other four from the answer", () => {
    const others = crowd("other", "m", same(4, 5));
    const c = caller({ ownContributionIds: new Set(["me"]) });
    // With only four other raters there is no answer to difference against.
    expect(similarHands(c, [person("me", [rate("m", 1)]), ...others])).toEqual(
      UNAVAILABLE,
    );
    // Whatever `me` says, the answer is the same: it cannot be used to probe.
    for (const stars of [1, 2, 3, 4, 5]) {
      const probe = person("me", [rate("m", stars)]);
      expect(similarHands(c, [probe, ...others])).toEqual(UNAVAILABLE);
    }
  });

  it("one neighbour changing a rating moves only a mean, and only at the floor or above", () => {
    const fifth = (rating: number) => [
      ...crowd("a", "m", same(4, 4)),
      person("b", [rate("m", rating)]),
    ];
    const at = (rating: number) => {
      const res = similarHands(caller(), fifth(rating));
      return res.available ? res.mice[0]!.meanSatisfaction : null;
    };
    expect(at(2)).toBe(18 / 5);
    expect(at(4)).toBe(4);
    // And with four neighbours there is nothing to see at all.
    expect(similarHands(caller(), crowd("a", "m", same(4, 4)))).toEqual(
      UNAVAILABLE,
    );
  });
});
