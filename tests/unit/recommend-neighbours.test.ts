import { describe, expect, it } from "vitest";
import type { GripStyle } from "../../src/lib/contracts/fit";
import {
  MAX_SIMILAR_MICE,
  SIMILAR_MIN_PEOPLE,
  similarResponseSchema,
  type SimilarResponse,
} from "../../src/lib/contracts/recommend";
import {
  SIMILAR_HAND_LENGTH_RADIUS_MM,
  SIMILAR_PALM_WIDTH_RADIUS_MM,
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

/** The caller used unless a test says otherwise. Bins, not raw millimetres. */
const HAND = 180;
const PALM = 90;

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

/**
 * Two mice, both rated only by neighbours: "few" by 2 people (5, 5) and "ten"
 * by 10 (six 5s and four 4s: mean exactly 4.6). With m = 4, "few" is outranked
 * by "ten" exactly when the prior g is under 4.25:
 *   (10 + 4g) / 6 < (46 + 4g) / 14  <=>  140 + 56g < 276 + 24g  <=>  g < 4.25.
 * On their own the prior is (10 + 46) / 12 = 4.667, so "few" leads, as it does
 * by plain mean. (With only two mice that clear the floor the prior is always
 * between their means, so nothing can reverse them: it takes a third.)
 */
function fewAndTen(): Contribution[] {
  return [
    ...crowd("few", "few", [5, 5]),
    ...crowd("ten", "ten", [5, 5, 5, 5, 5, 5, 4, 4, 4, 4]),
  ];
}

/**
 * A third mouse that four neighbours rate 1. It clears the floor, so its ratings
 * are in the prior: added to `fewAndTen` the prior falls to (56 + 4) / 16 =
 * 3.75, under 4.25, so "ten" leads "few". It is listed too, last.
 */
function lowCrowd(): Contribution[] {
  return crowd("low", "low", [1, 1, 1, 1]);
}

/**
 * One person's five ratings of 1, each for a mouse nobody else rated, so each
 * of those mice has one rater at most and is never listed. Under the old rule
 * (a prior over every rating of every mouse) these ratings pulled the prior
 * from 4.667 to 3.588 and put "ten" ahead of "few"; they must move nothing.
 */
function soloLows(id: string, over: Partial<Contribution> = {}): Contribution {
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

const UNAVAILABLE: SimilarResponse = {
  available: false,
  reason: "insufficient_data",
};

// -------------------------------------------------------- the neighbour rule

describe("neighbours: who counts", () => {
  /** Two baseline neighbours plus one probe at an offset; are there 3 or 2? */
  function neighboursWithProbe(
    probe: Partial<Contribution>,
    rules = DEFAULT_SIMILAR_RULES,
  ): number | null {
    const pool = [
      ...crowd("base", "m", [4, 4]),
      person("probe", [rate("m", 4)], probe),
    ];
    const res = parsed(similarHands(caller(), pool, rules));
    return res.available ? res.neighbours : null;
  }

  it("takes hand length within 10 mm (2 bins), inclusive", () => {
    expect(SIMILAR_HAND_LENGTH_RADIUS_MM).toBe(10);
    expect(neighboursWithProbe({ handLengthBinMm: HAND + 10 })).toBe(3);
    expect(neighboursWithProbe({ handLengthBinMm: HAND - 10 })).toBe(3);
    expect(neighboursWithProbe({ handLengthBinMm: HAND + 15 })).toBe(2);
    expect(neighboursWithProbe({ handLengthBinMm: HAND - 15 })).toBe(2);
  });

  it("takes palm width within 5 mm (1 bin), inclusive", () => {
    expect(SIMILAR_PALM_WIDTH_RADIUS_MM).toBe(5);
    expect(neighboursWithProbe({ palmWidthBinMm: PALM + 5 })).toBe(3);
    expect(neighboursWithProbe({ palmWidthBinMm: PALM - 5 })).toBe(3);
    expect(neighboursWithProbe({ palmWidthBinMm: PALM + 10 })).toBe(2);
    expect(neighboursWithProbe({ palmWidthBinMm: PALM - 10 })).toBe(2);
  });

  it("needs both dimensions to be close, not either", () => {
    expect(
      neighboursWithProbe({
        handLengthBinMm: HAND + 10,
        palmWidthBinMm: PALM + 5,
      }),
    ).toBe(3);
    expect(
      neighboursWithProbe({
        handLengthBinMm: HAND + 15,
        palmWidthBinMm: PALM,
      }),
    ).toBe(2);
    expect(
      neighboursWithProbe({
        handLengthBinMm: HAND,
        palmWidthBinMm: PALM + 10,
      }),
    ).toBe(2);
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
      expect(neighboursWithProbe({ handLengthBinMm: bad })).toBe(2);
    },
  );

  it.each(BAD_BINS)(
    "a palm width bin that is %s is not a neighbour",
    (_name, bad) => {
      expect(neighboursWithProbe({ palmWidthBinMm: bad })).toBe(2);
    },
  );

  it("people with a bad bin cannot make up the floor between them", () => {
    // Each of these is "close" on the other dimension. Two of them are not two
    // neighbours: no answer.
    const nan = Number.NaN;
    const gone = undefined as unknown as number;
    const pairs: Array<[Partial<Contribution>, Partial<Contribution>]> = [
      [{ handLengthBinMm: nan }, { handLengthBinMm: nan }],
      [{ palmWidthBinMm: nan }, { palmWidthBinMm: nan }],
      [{ handLengthBinMm: gone }, { palmWidthBinMm: gone }],
      [{ handLengthBinMm: nan }, { palmWidthBinMm: Number.POSITIVE_INFINITY }],
      [
        { handLengthBinMm: Number.NEGATIVE_INFINITY },
        { palmWidthBinMm: Number.NEGATIVE_INFINITY },
      ],
    ];
    for (const [one, two] of pairs) {
      const pool = [
        person("bad1", [rate("m", 4)], one),
        person("bad2", [rate("m", 4)], two),
      ];
      expect(similarHands(caller(), pool)).toEqual(UNAVAILABLE);
    }
    // With a good neighbour beside them they are still not counted.
    const pool = [
      person("good", [rate("m", 4)]),
      person("bad1", [rate("m", 4)], { handLengthBinMm: nan }),
      person("bad2", [rate("m", 4)], { palmWidthBinMm: gone }),
    ];
    expect(similarHands(caller(), pool)).toEqual(UNAVAILABLE);
  });

  it("does not ask for the same grip by default", () => {
    expect(DEFAULT_SIMILAR_RULES.requireSameGrip).toBe(false);
    expect(neighboursWithProbe({ gripStyle: "claw" })).toBe(3);
    expect(neighboursWithProbe({ gripStyle: "fingertip" })).toBe(3);
  });

  it("asks for the same grip when the rule says so", () => {
    const rules = { ...DEFAULT_SIMILAR_RULES, requireSameGrip: true };
    expect(neighboursWithProbe({ gripStyle: "palm" }, rules)).toBe(3);
    expect(neighboursWithProbe({ gripStyle: "claw" }, rules)).toBe(2);
    expect(neighboursWithProbe({ gripStyle: "fingertip" }, rules)).toBe(2);
  });

  it("a contribution with no grip is a neighbour by default and never matches a grip", () => {
    const noGrip = {
      gripStyle: undefined as unknown as GripStyle,
    };
    expect(neighboursWithProbe(noGrip)).toBe(3);
    expect(
      neighboursWithProbe(noGrip, {
        ...DEFAULT_SIMILAR_RULES,
        requireSameGrip: true,
      }),
    ).toBe(2);
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
    // is still a person with a close hand.
    const pool = [
      ...crowd("rater", "m", [4, 4]),
      person("silent", [], { handLengthBinMm: HAND + 5 }),
    ];
    const res = parsed(similarHands(caller(), pool));
    expect(res).toMatchObject({ available: true, neighbours: 3 });
    expect(res.available && res.mice[0]?.raters).toBe(2);
  });
});

// ------------------------------------------------------------ the floor

describe("floor: how few people can stand behind an answer", () => {
  it("holds SIMILAR_MIN_PEOPLE at 2, which these tests are written for", () => {
    expect(SIMILAR_MIN_PEOPLE).toBe(2);
  });

  it("0 contributors: not available", () => {
    expect(similarHands(caller(), [])).toEqual(UNAVAILABLE);
  });

  it("0 neighbours among people far away: not available", () => {
    const far = crowd("far", "m", [5, 5, 5, 5], { handLengthBinMm: HAND + 40 });
    expect(similarHands(caller(), far)).toEqual(UNAVAILABLE);
  });

  it("1 neighbour: not available, however many people are elsewhere", () => {
    const pool = [
      person("only", [rate("m", 5)]),
      ...crowd("far", "m", [5, 5, 5], { palmWidthBinMm: PALM + 30 }),
    ];
    expect(similarHands(caller(), pool)).toEqual(UNAVAILABLE);
  });

  it("2 neighbours who rated the same mouse: available, both counted", () => {
    const res = parsed(similarHands(caller(), crowd("n", "m", [5, 3])));
    expect(res).toEqual({
      available: true,
      neighbours: 2,
      basis: { handLengthBinMm: HAND, palmWidthBinMm: PALM, gripStyle: "palm" },
      mice: [
        {
          slug: "m",
          brand: "Brand m",
          model: "Model m",
          raters: 2,
          meanSatisfaction: 4,
        },
      ],
    });
  });

  it("2 neighbours who rated different mice: no mouse has 2 raters, so not available", () => {
    const pool = [person("a", [rate("x", 5)]), person("b", [rate("y", 5)])];
    expect(similarHands(caller(), pool)).toEqual(UNAVAILABLE);
  });

  it("a mouse with exactly 1 neighbour rater is left out, and leaves no trace", () => {
    const pool = [
      person("a", [rate("shared", 4), rate("solo-secret", 5)]),
      person("b", [rate("shared", 2)]),
      person("c", []),
    ];
    const res = parsed(similarHands(caller(), pool));
    expect(slugs(res)).toEqual(["shared"]);
    expect(res).toMatchObject({ available: true, neighbours: 3 });
    expect(JSON.stringify(res)).not.toContain("solo-secret");
    // No trace: the whole answer is the one given when that rating is not there.
    const without = [
      person("a", [rate("shared", 4)]),
      person("b", [rate("shared", 2)]),
      person("c", []),
    ];
    expect(res).toEqual(similarHands(caller(), without));
    // (A pool in which that rating could change the order, so that this
    // equality has teeth, is in "what a hidden rating cannot do" below.)
  });

  it("a mouse with exactly 2 neighbour raters is listed", () => {
    const pool = [
      person("a", [rate("pair", 5)]),
      person("b", [rate("pair", 4)]),
      person("c", [rate("solo", 1)]),
    ];
    const res = parsed(similarHands(caller(), pool));
    expect(slugs(res)).toEqual(["pair"]);
  });

  it("ratings by people who are not neighbours do not make a mouse reach the floor", () => {
    const pool = [
      person("near", [rate("m", 5)]),
      person("near2", []),
      ...crowd("far", "m", [5, 5, 5], { handLengthBinMm: HAND + 50 }),
    ];
    expect(similarHands(caller(), pool)).toEqual(UNAVAILABLE);
  });
});

// ------------------------------------------------- the caller's own data

describe("the caller's own contributions", () => {
  const mine = person("mine", [rate("m", 1), rate("only-mine", 5)]);

  it("are not neighbours: one other person is still 1 neighbour", () => {
    const pool = [mine, person("other", [rate("m", 5)])];
    expect(
      similarHands(caller({ ownContributionIds: new Set(["mine"]) }), pool),
    ).toEqual(UNAVAILABLE);
  });

  it("without the exclusion that same pool would have answered", () => {
    // The previous test is only meaningful if the pool is enough for an
    // answer when the caller is not excluded.
    const pool = [mine, person("other", [rate("m", 5)])];
    const res = parsed(similarHands(caller(), pool));
    expect(res).toMatchObject({ available: true, neighbours: 2 });
  });

  it("are not counted as raters and do not move the mean", () => {
    const pool = [mine, ...crowd("n", "m", [5, 3])];
    const res = parsed(
      similarHands(caller({ ownContributionIds: new Set(["mine"]) }), pool),
    );
    expect(res).toMatchObject({ available: true, neighbours: 2 });
    expect(res.available && res.mice).toEqual([
      expect.objectContaining({ slug: "m", raters: 2, meanSatisfaction: 4 }),
    ]);
  });

  it("change nothing about the answer, whatever they hold", () => {
    const others = [...crowd("n", "m", [5, 3, 4]), ...crowd("k", "z", [2, 3])];
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
    // `fewAndTen` alone: "few" leads. Another neighbour, "other", rated five
    // mice 1 each, and so did the caller ("mine", a neighbour by hand size too).
    // Each of those five mice has "other" as its only rater, so none is listed
    // and none is in the prior. If "mine" were counted, each would have two
    // raters, clear the floor and enter the prior, which would fall from 4.667
    // to (56 + 10) / 22 = 3.0 and put "ten" ahead.
    const base = [...fewAndTen(), soloLows("other")];
    const own = soloLows("mine");
    const c = caller({ ownContributionIds: new Set(["mine"]) });
    expect(slugs(similarHands(c, [own, ...base]))).toEqual(["few", "ten"]);
    expect(similarHands(c, [own, ...base])).toEqual(similarHands(c, base));
    // The contrast: had "mine" been someone else's, it would count, and the
    // five mice would be listed and drag the prior down.
    expect(slugs(similarHands(caller(), [own, ...base]))).toEqual([
      "ten",
      "few",
      "z1",
      "z2",
      "z3",
    ]);
  });

  it("every id the caller owns is left out, including other submissions", () => {
    const owned = ["s1", "s2", "s3"].map((id) => person(id, [rate("m", 5)]));
    const c = caller({ ownContributionIds: new Set(["s1", "s2", "s3"]) });
    expect(similarHands(c, [...owned, person("o", [rate("m", 1)])])).toEqual(
      UNAVAILABLE,
    );
  });
});

// ------------------------------------------------------------- the means

describe("per-mouse numbers", () => {
  it("raters is the neighbours who rated it; the mean is the plain mean", () => {
    const pool = [
      ...crowd("a", "m", [5, 4, 4]),
      person("b", [rate("m", 1)], { handLengthBinMm: HAND + 20 }), // not near
    ];
    const res = parsed(similarHands(caller(), pool));
    expect(res.available && res.mice).toEqual([
      {
        slug: "m",
        brand: "Brand m",
        model: "Model m",
        raters: 3,
        meanSatisfaction: 13 / 3,
      },
    ]);
  });

  it("returns the real mean even when the ranking score differs from it", () => {
    // "m": 2 neighbours at 5. "dud": four neighbours at 1. The prior is
    // (10 + 4) / 6 = 2.33, so the score of "m" is (10 + 4 * 2.33) / 6 = 3.22,
    // far below 5. The visitor still sees 5. Five far-away people at 1 are
    // there too, and are in nobody's count.
    const pool = [
      ...crowd("n", "m", [5, 5]),
      ...crowd("d", "dud", [1, 1, 1, 1]),
      ...crowd("f", "m", [1, 1, 1, 1, 1], { handLengthBinMm: HAND + 40 }),
    ];
    expect(shrunkScore(2, 5, 14 / 6)).toBeCloseTo(3.2222, 3);
    const res = parsed(similarHands(caller(), pool));
    expect(res.available && res.mice[0]).toMatchObject({
      slug: "m",
      raters: 2,
      meanSatisfaction: 5,
    });
  });

  it("is exactly sum / n for a mean with no short decimal", () => {
    const res = parsed(
      similarHands(caller(), crowd("n", "m", [5, 4, 4, 5, 4])),
    );
    expect(res.available && res.mice[0]?.meanSatisfaction).toBe(22 / 5);
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
      ...crowd("ok", "m", [4, 4]),
      ...bad.map((v, i) => person(`bad${i}`, [rate("m", v)])),
    ];
    const res = parsed(similarHands(caller(), pool));
    expect(res).toMatchObject({ available: true, neighbours: 2 + bad.length });
    expect(res.available && res.mice).toEqual([
      expect.objectContaining({ raters: 2, meanSatisfaction: 4 }),
    ]);
  });

  it("takes 1 and 5, the ends of the scale", () => {
    const res = parsed(similarHands(caller(), crowd("e", "m", [1, 5])));
    expect(res.available && res.mice).toEqual([
      expect.objectContaining({ raters: 2, meanSatisfaction: 3 }),
    ]);
  });

  it("leaves out a mouse a contributor names twice, rather than pick one", () => {
    const pool = [
      person("twice", [rate("m", 5), rate("m", 1), rate("n", 4)]),
      person("b", [rate("m", 3), rate("n", 4)]),
      person("c", [rate("m", 3)]),
    ];
    const res = parsed(similarHands(caller(), pool));
    expect(res.available && res.mice).toEqual([
      expect.objectContaining({ slug: "n", raters: 2, meanSatisfaction: 4 }),
      expect.objectContaining({ slug: "m", raters: 2, meanSatisfaction: 3 }),
    ]);
  });

  it("shows one name per slug whatever the order of the pool", () => {
    const named = (id: string, brand: string, model: string) =>
      person(id, [{ slug: "m", brand, model, satisfaction: 4 }]);
    const pool = [
      named("a", "Zed", "Alpha"),
      named("b", "Acme", "Pro"),
      named("c", "Acme", "Basic"),
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
   * 10 neighbours rate "steady" (6 fives, 4 fours: mean exactly 4.6). Two of
   * them also rate "flashy" at 5, and four of them rate "dud" at 1. The
   * neighbours' plain mean for flashy is higher (5 against 4.6), but only two
   * of them say so, and these neighbours rate mice low in general: prior g =
   * (46 + 10 + 4) / 16 = 3.75, under the 4.25 at which two 5s fall under ten
   * 4.6s, so flashy = (10 + 4g) / 6 = 4.167 and steady = (46 + 4g) / 14 =
   * 4.357. The ones who disagree are neighbours: ratings from far away do not
   * count (see "what a hidden rating cannot do").
   */
  function steadyVsFlashy(): Contribution[] {
    const people = crowd("s", "steady", [5, 5, 5, 5, 5, 5, 4, 4, 4, 4]);
    const rated = (c: Contribution, extra: ContributedRating[]) => ({
      ...c,
      ratings: [...c.ratings, ...extra],
    });
    return people.map((c, i) => {
      if (i < 2) return rated(c, [rate("flashy", 5)]);
      if (i < 6) return rated(c, [rate("dud", 1)]);
      return c;
    });
  }

  it("two 5s that the neighbours' other ratings put in doubt do not outrank ten 4.6s", () => {
    const res = parsed(similarHands(caller(), steadyVsFlashy()));
    expect(slugs(res)).toEqual(["steady", "flashy", "dud"]);
    // The numbers shown are the plain ones, not the shrunk ones.
    expect(res.available && res.mice).toEqual([
      expect.objectContaining({
        slug: "steady",
        raters: 10,
        meanSatisfaction: 4.6,
      }),
      expect.objectContaining({
        slug: "flashy",
        raters: 2,
        meanSatisfaction: 5,
      }),
      expect.objectContaining({
        slug: "dud",
        raters: 4,
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
      ...crowd("a", "loved", [5, 5, 5]),
      ...crowd("b", "meh", [3, 3, 3]),
      ...crowd("far", "loved", [5, 5, 5, 5], { palmWidthBinMm: PALM + 30 }),
    ];
    expect(slugs(similarHands(caller(), pool))).toEqual(["loved", "meh"]);
  });

  it("an exact tie goes to more raters, whatever the slug order", () => {
    // Both score exactly 4: 2 raters and 3 raters, all 4s, nobody else.
    const pool = [
      person("p1", [rate("a-two", 4), rate("b-three", 4)]),
      person("p2", [rate("a-two", 4), rate("b-three", 4)]),
      person("p3", [rate("b-three", 4)]),
    ];
    expect(slugs(similarHands(caller(), pool))).toEqual(["b-three", "a-two"]);
  });

  it("then goes to the slug, in code-unit order", () => {
    const pool = [
      person("p1", [rate("a-2", 4), rate("a-10", 4), rate("a-1", 4)]),
      person("p2", [rate("a-2", 4), rate("a-10", 4), rate("a-1", 4)]),
    ];
    const next = prng(11);
    for (let i = 0; i < 10; i++) {
      const order = slugs(similarHands(caller(), shuffled(pool, next)));
      expect(order).toEqual(["a-1", "a-10", "a-2"]);
    }
    // Upper case sorts before lower case in code-unit order, not in a locale's.
    const mixed = [
      person("p1", [rate("b", 4), rate("B", 4)]),
      person("p2", [rate("b", 4), rate("B", 4)]),
    ];
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
    // "x": two 5s. "y": 5, 5, 4 (more raters, lower mean). Both people who rate
    // "x" rate "y" too, and a third rates "y" alone, so the prior is
    // (10 + 14) / 5 = 4.8. A prior weight of 1e6 (a positive number is all the
    // rule asks for) squeezes both scores to within a millionth of 4.8, and "x"
    // scores about 8e-7 above "y": far over the 1e-9 tie guard, far under 1e-3.
    // A guard as wide as 1e-3 or 0.01 would call it a tie and put "y" first, as
    // it has more raters.
    const weight = 1e6;
    const gap =
      shrunkScore(2, 5, 4.8, weight) - shrunkScore(3, 14 / 3, 4.8, weight);
    expect(gap).toBeGreaterThan(1e-7);
    expect(gap).toBeLessThan(1e-5);
    const pool = [
      person("p1", [rate("x", 5), rate("y", 5)]),
      person("p2", [rate("x", 5), rate("y", 5)]),
      person("p3", [rate("y", 4)]),
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
    // Seven mice, each rated by the same two neighbours with the stars above,
    // so the order is known.
    const stars = [5, 5, 4, 4, 3, 2, 1];
    const both = () => stars.map((s, i) => rate(`m${i}`, s));
    const pool = [person("p1", both()), person("p2", both())];
    const res = parsed(similarHands(caller(), pool));
    expect(MAX_SIMILAR_MICE).toBe(5);
    expect(slugs(res)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
  });
});

// ------------------------------------------- the prior: one neighbour mean

describe("ranking: the prior is the neighbours' mean over the mice that clear the floor", () => {
  const ids = (res: SimilarResponse) => slugs(res);

  it("works in a small pool where everybody is a neighbour", () => {
    // A: 2 people rate 5. B: 10 people rate 4.6 on average (six 5s, four 4s).
    // C: 20 people rate 2. Everyone is a neighbour and all three mice clear the
    // floor, so a prior that is a mouse's own mean would be its plain mean.
    //   prior g = (2*5 + 10*4.6 + 20*2) / 32 = (10 + 46 + 40) / 32 = 3.0
    //   A = (2*5 + 4*3) / (2 + 4)   = 22 / 6  = 3.667
    //   B = (10*4.6 + 4*3) / (10+4) = 58 / 14 = 4.143
    //   C = (20*2 + 4*3) / (20 + 4) = 52 / 24 = 2.167
    // so B, A, C. By plain mean it is A (5), B (4.6), C (2).
    const pool = [
      ...crowd("a", "mouse-a", [5, 5]),
      ...crowd("b", "mouse-b", [5, 5, 5, 5, 5, 5, 4, 4, 4, 4]),
      ...crowd(
        "c",
        "mouse-c",
        Array.from({ length: 20 }, () => 2),
      ),
    ];
    expect(shrunkScore(2, 5, 3)).toBeCloseTo(22 / 6, 12);
    expect(shrunkScore(10, 4.6, 3)).toBeCloseTo(58 / 14, 12);
    expect(shrunkScore(20, 2, 3)).toBeCloseTo(52 / 24, 12);

    const res = parsed(similarHands(caller(), pool));
    expect(ids(res)).toEqual(["mouse-b", "mouse-a", "mouse-c"]);
    expect(res).toMatchObject({ available: true, neighbours: 32 });
    // What is shown is still the neighbours' plain mean, not the shrunk score.
    expect(res.available && res.mice).toEqual([
      expect.objectContaining({
        slug: "mouse-b",
        raters: 10,
        meanSatisfaction: 46 / 10,
      }),
      expect.objectContaining({
        slug: "mouse-a",
        raters: 2,
        meanSatisfaction: 5,
      }),
      expect.objectContaining({
        slug: "mouse-c",
        raters: 20,
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
    // H: 50 people (ten 5s, forty 4s: mean 4.2). S: 2 people (4, 4: mean 4.0).
    // T: 100 people (ninety 5s, ten 4s: mean 4.9), the third mouse that lifts
    // the prior above both H and S.
    //   prior g = (210 + 8 + 490) / 152 = 708 / 152 = 4.658
    //   H = (210 + 4g) / 54 = 4.234   S = (8 + 4g) / 6 = 4.439
    //   T = (490 + 4g) / 104 = 4.891
    // so T, S, H, though by plain mean it is T (4.9), H (4.2), S (4.0).
    const pool = [
      ...crowd("h", "mouse-h", [...Array(10).fill(5), ...Array(40).fill(4)]),
      ...crowd("s", "mouse-s", [4, 4]),
      ...crowd("t", "mouse-t", [...Array(90).fill(5), ...Array(10).fill(4)]),
    ];
    const g = 708 / 152;
    expect(shrunkScore(50, 4.2, g)).toBeCloseTo(4.2339, 4);
    expect(shrunkScore(2, 4, g)).toBeCloseTo(4.4386, 4);
    expect(shrunkScore(100, 4.9, g)).toBeCloseTo(4.8907, 4);

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
    // `fewAndTen` alone: g = 4.667 is between 4.6 and 5.
    //   few = (2*5 + 4*4.667) / 6  = 4.778
    //   ten = (46 + 4*4.667) / 14  = 4.619
    // "few" stays ahead, as by plain mean. It takes a prior under 4.25 to
    // reverse them (see `fewAndTen`), and the next test shows one.
    const res = similarHands(caller(), fewAndTen());
    expect(ids(res)).toEqual(["few", "ten"]);
    expect(ids(res)).toEqual(
      ids(
        similarHands(caller(), fewAndTen(), {
          ...DEFAULT_SIMILAR_RULES,
          priorWeight: 0,
        }),
      ),
    );
    expect(shrunkScore(2, 5, 56 / 12)).toBeGreaterThan(
      shrunkScore(10, 4.6, 56 / 12),
    );
  });

  it("a third mouse that clears the floor can reverse the two", () => {
    // `fewAndTen` plus "low", four 1s: prior (56 + 4) / 16 = 3.75, under 4.25.
    const pool = [...fewAndTen(), ...lowCrowd()];
    expect(ids(similarHands(caller(), pool))).toEqual(["ten", "few", "low"]);
    expect(
      ids(
        similarHands(caller(), pool, {
          ...DEFAULT_SIMILAR_RULES,
          priorWeight: 0,
        }),
      ),
    ).toEqual(["few", "ten", "low"]);
  });

  it("with only two mice that clear the floor, the prior never reverses them", () => {
    // The prior is a weighted mean of the two plain means, so it lies between
    // them, and a prior between two means leaves their order alone. Random
    // pairs of mice (whole-number ratings, 2 to 12 raters each).
    const next = prng(77);
    let checked = 0;
    for (let i = 0; i < 300; i++) {
      const ratingsOf = (): number[] =>
        Array.from(
          { length: 2 + Math.floor(next() * 11) },
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
    // `fewAndTen` plus "twenty": 20 people, ten 3s and ten 4s (mean 3.5).
    //   over ratings: g = (10 + 46 + 70) / 32 = 3.9375
    //     few = (10 + 4*3.9375) / 6 = 4.292    ten = (46 + 15.75) / 14 = 4.411
    //   over mice:    g = (5 + 4.6 + 3.5) / 3 = 4.367
    //     few = (10 + 4*4.367) / 6 = 4.578     ten = (46 + 17.47) / 14 = 4.533
    // The first puts "ten" ahead, the second "few": the pool tells them apart.
    const pool = [
      ...fewAndTen(),
      ...crowd(
        "t",
        "twenty",
        [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
      ),
    ];
    const overRatings = 126 / 32;
    const overMice = (5 + 4.6 + 3.5) / 3;
    expect(shrunkScore(2, 5, overRatings)).toBeLessThan(
      shrunkScore(10, 4.6, overRatings),
    );
    expect(shrunkScore(2, 5, overMice)).toBeGreaterThan(
      shrunkScore(10, 4.6, overMice),
    );
    expect(ids(similarHands(caller(), pool))).toEqual(["ten", "few", "twenty"]);
  });

  it("a mouse with exactly the floor of raters is in the prior", () => {
    // `fewAndTen` plus "pair", two neighbours at 1: the prior falls from 4.667
    // to (56 + 2) / 14 = 4.143, under 4.25, and "ten" leads. With one rater it
    // would be hidden and would move nothing (next section).
    const pool = [...fewAndTen(), ...crowd("pair", "pair", [1, 1])];
    expect(SIMILAR_MIN_PEOPLE).toBe(2);
    expect(ids(similarHands(caller(), pool))).toEqual(["ten", "few", "pair"]);
  });

  it("a mouse that falls outside the top five is still in the prior", () => {
    // Five mice that every ranking puts at the top, "few", "p1".."p3" (two 5s
    // each) and "ten" (mean 4.6), and "low", twenty 1s, which ranks sixth and is
    // not listed. The prior with "low" is (86 + 20) / 38 = 2.79, and with it
    // "ten" leads; without it the prior is 86 / 18 = 4.78 and "ten" is last.
    const top = [
      ...fewAndTen(),
      ...crowd("p1", "p1", [5, 5]),
      ...crowd("p2", "p2", [5, 5]),
      ...crowd("p3", "p3", [5, 5]),
    ];
    const low = crowd(
      "low",
      "low",
      Array.from({ length: 20 }, () => 1),
    );
    const without = parsed(similarHands(caller(), top));
    const withLow = parsed(similarHands(caller(), [...top, ...low]));
    expect(ids(without)).toEqual(["few", "p1", "p2", "p3", "ten"]);
    expect(ids(withLow)).toEqual(["ten", "few", "p1", "p2", "p3"]);
    expect(MAX_SIMILAR_MICE).toBe(5);
  });

  it.each([
    ["off the 1 to 5 scale", () => [rate("few", 0), rate("ten", 6)]],
    [
      "below 1 or above 5 by a fraction",
      () => [rate("few", 0.9), rate("ten", 5.1)],
    ],
    ["between two whole numbers", () => [rate("few", 2.5), rate("ten", 4.5)]],
    [
      "not a number or infinite",
      () => [rate("few", Number.NaN), rate("ten", Number.POSITIVE_INFINITY)],
    ],
    [
      "named twice by the same person",
      () => [rate("few", 1), rate("few", 1), rate("ten", 1), rate("ten", 1)],
    ],
  ])("leaves out a rating that is %s", (_name, ratings) => {
    // The same filter as everywhere else. Somebody who is a neighbour and whose
    // every rating is one of these is a neighbour who rated nothing: the answer
    // is the one for the same pool where they rated nothing.
    const base = [...fewAndTen(), ...lowCrowd()];
    const withOdd = [...base, person("odd", ratings())];
    const withNothing = [...base, person("odd", [])];
    expect(similarHands(caller(), withOdd)).toEqual(
      similarHands(caller(), withNothing),
    );
    expect(ids(similarHands(caller(), withOdd))).toEqual(["ten", "few", "low"]);
  });

  it("does not depend on the order of the pool", () => {
    const small = [
      ...crowd("a", "mouse-a", [5, 5]),
      ...crowd("b", "mouse-b", [5, 5, 5, 5, 5, 5, 4, 4, 4, 4]),
      ...crowd(
        "c",
        "mouse-c",
        Array.from({ length: 20 }, () => 2),
      ),
    ];
    const withExtras = [
      ...fewAndTen(),
      ...lowCrowd(),
      soloLows("other"),
      soloLows("far", { handLengthBinMm: HAND + 50 }),
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
   * `fewAndTen`, with one of its ten raters also rating "secret", a mouse nobody
   * else rated, as `s` (or not at all, for `null`).
   */
  function poolWithVictim(s: number | null): Contribution[] {
    return fewAndTen().map((c) =>
      c.id === "ten0" && s !== null
        ? { ...c, ratings: [...c.ratings, rate("secret", s)] }
        : c,
    );
  }

  /** `k` people, each rating a mouse of their own with 4: nobody else rates it. */
  function probes(k: number, over: Partial<Contribution>): Contribution[] {
    return Array.from({ length: k }, (_, i) =>
      person(`probe${i}`, [rate(`probe-mouse-${i}`, 4)], over),
    );
  }

  it.each([
    ["near the caller", {}],
    ["far from the caller", far],
  ])(
    "the answer is the same whatever a hidden mouse's one rater said, with probes %s",
    (_name, over) => {
      // The attack: a victim rates "secret" with s; the attacker adds k people
      // who each rate a mouse of their own with 4, and watches the order of
      // "few" and "ten" (the response never contains "secret"). Under a prior
      // over every rating of every mouse, the order flips at the first k that
      // is 4s + 3 (there the two scores are an exact tie, and a tie goes to
      // "ten", the mouse with more raters), so each s has its own k, and the
      // flip point gives s away. The checks just below take 4s + 4, where "ten"
      // is strictly ahead, and 4s + 2, where "few" still leads. Here, for
      // every s and every k, the whole answer must be the one for the pool
      // where "secret" was never rated.
      const premise = (s: number, k: number): number =>
        (56 + s + 4 * k) / (13 + k); // the prior under that rule
      for (let s = 1; s <= 5; s++) {
        const k = 4 * s + 4;
        expect(shrunkScore(2, 5, premise(s, k))).toBeLessThan(
          shrunkScore(10, 4.6, premise(s, k)),
        );
        expect(shrunkScore(2, 5, premise(s, k - 2))).toBeGreaterThan(
          shrunkScore(10, 4.6, premise(s, k - 2)),
        );
      }
      for (let s = 1; s <= 5; s++) {
        for (let k = 0; k <= 30; k++) {
          const extra = probes(k, over);
          const without = similarHands(caller(), [
            ...poolWithVictim(null),
            ...extra,
          ]);
          expect(slugs(without)).toEqual(["few", "ten"]);
          expect(
            similarHands(caller(), [...poolWithVictim(s), ...extra]),
          ).toEqual(without);
        }
      }
    },
  );

  it("a mouse with one neighbour rater is not in the prior, whatever the rater gave it", () => {
    // `soloLows`: one neighbour rates five mice 1 each, and nobody else rates
    // them. They are never listed. Counted, they would pull the prior from
    // 4.667 to 3.588 and put "ten" ahead of "few"; the answer must be the one
    // where that person rated nothing.
    const base = fewAndTen();
    const hidden = similarHands(caller(), [...base, soloLows("other")]);
    const nothing = similarHands(caller(), [...base, person("other", [])]);
    expect(slugs(nothing)).toEqual(["few", "ten"]);
    expect(hidden).toEqual(nothing);
  });

  it("people who are not neighbours move nothing, whatever they rated", () => {
    // Far away: five solo mice rated 1, three unrelated mice rated 1 and 5, and
    // a crowd that rated the listed mice themselves 1. None of it is in any
    // neighbour count, so none of it is in the prior or the means.
    const base = [...fewAndTen(), ...lowCrowd()];
    const noise = [
      soloLows("far-solo", far),
      person("far-one", [rate("u1", 1), rate("u2", 1), rate("u3", 1)], far),
      person("far-five", [rate("u1", 5), rate("u2", 5), rate("u3", 5)], far),
      ...crowd(
        "far-few",
        "few",
        Array.from({ length: 10 }, () => 1),
        far,
      ),
      ...crowd(
        "far-ten",
        "ten",
        Array.from({ length: 10 }, () => 5),
        far,
      ),
    ];
    expect(similarHands(caller(), [...base, ...noise])).toEqual(
      similarHands(caller(), base),
    );
    expect(slugs(similarHands(caller(), base))).toEqual(["ten", "few", "low"]);
    // Whatever they say, 1 or 5.
    for (const stars of [1, 5]) {
      const crowdFar = crowd(
        "far-all",
        "ten",
        Array.from({ length: 12 }, () => stars),
        far,
      );
      expect(similarHands(caller(), [...base, ...crowdFar])).toEqual(
        similarHands(caller(), base),
      );
    }
  });
});

// ------------------------------------------------- determinism, immutability

describe("determinism", () => {
  const next = prng(2026);
  const mice = ["m0", "m1", "m2", "m3", "m4", "m5", "m6"];
  const pool: Contribution[] = Array.from({ length: 40 }, (_, i) =>
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
  return Array.from({ length: 90 }, (_, i) => {
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

/**
 * A plain, differently-shaped restatement of the rules, to compare the engine
 * with. It uses integer sums, so its means are exact. The prior is one mean
 * over the neighbours' ratings of the mice that at least two neighbours rated
 * (the population below has no rating off the scale and none named twice).
 */
function oracle(c: Caller, pool: readonly Contribution[]) {
  const others = pool.filter((p) => !c.ownContributionIds.has(p.id));
  const near = others.filter(
    (p) =>
      Math.abs(p.handLengthBinMm - c.handLengthBinMm) <= 10 &&
      Math.abs(p.palmWidthBinMm - c.palmWidthBinMm) <= 5,
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
  const clearing = [...rows.entries()].filter(([, row]) => row.nearN >= 2);
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
          ownContributionIds: new Set([`c${hand % 90}`, `c${(palm * 7) % 90}`]),
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
        want.neighbours >= 2 && want.listed.length > 0,
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
    "a caller at %i mm / %i mm gets only the people within the radius",
    (hand, palm) => {
      const inside = [
        person("in1", [rate("m", 4)], {
          handLengthBinMm: hand,
          palmWidthBinMm: palm,
        }),
        person("in2", [rate("m", 2)], {
          handLengthBinMm: hand + (hand === 280 ? -10 : 10),
          palmWidthBinMm: palm + (palm === 150 ? -5 : 5),
        }),
      ];
      const outside = [
        person("out1", [rate("m", 5)], {
          handLengthBinMm: hand + (hand === 280 ? -15 : 15),
          palmWidthBinMm: palm,
        }),
        person("out2", [rate("m", 5)], {
          handLengthBinMm: hand,
          palmWidthBinMm: palm + (palm === 150 ? -10 : 10),
        }),
      ];
      const c = caller({ handLengthBinMm: hand, palmWidthBinMm: palm });
      const res = parsed(similarHands(c, [...outside, ...inside]));
      expect(res).toMatchObject({
        available: true,
        neighbours: 2,
        basis: { handLengthBinMm: hand, palmWidthBinMm: palm },
      });
      expect(res.available && res.mice[0]).toMatchObject({
        raters: 2,
        meanSatisfaction: 3,
      });
    },
  );

  it("does not look past the range: a pool past 280 is not pulled in", () => {
    const pool = [
      ...crowd("a", "m", [4, 4], { handLengthBinMm: 285 }),
      ...crowd("b", "m", [4, 4], { handLengthBinMm: 295 }),
    ];
    const res = similarHands(
      caller({ handLengthBinMm: 280, palmWidthBinMm: 90 }),
      pool,
    );
    // Only the 285s are within 10 mm: 2 neighbours.
    expect(res).toMatchObject({ available: true, neighbours: 2 });
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
      ...crowd("secret-id-", "m", [5, 1, 4]),
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

  it("a caller who is one of two raters learns nothing of the other from the answer", () => {
    const other = person("other", [rate("m", 5)]);
    const me = person("me", [rate("m", 1)]);
    const c = caller({ ownContributionIds: new Set(["me"]) });
    // With only one other rater there is no answer to difference against.
    expect(similarHands(c, [me, other])).toEqual(UNAVAILABLE);
    // Whatever `me` says, the answer is the same: it cannot be used to probe.
    for (const stars of [1, 2, 3, 4, 5]) {
      const probe = person("me", [rate("m", stars)]);
      expect(similarHands(c, [probe, other])).toEqual(UNAVAILABLE);
    }
  });

  it("one neighbour changing a rating moves only a mean, and only at the floor or above", () => {
    const pair = (second: number) => [
      person("a", [rate("m", 4)]),
      person("b", [rate("m", second)]),
    ];
    const at = (second: number) => {
      const res = similarHands(caller(), pair(second));
      return res.available ? res.mice[0]!.meanSatisfaction : null;
    };
    expect(at(2)).toBe(3);
    expect(at(4)).toBe(4);
    // And with a single neighbour there is nothing to see at all.
    expect(similarHands(caller(), [person("a", [rate("m", 4)])])).toEqual(
      UNAVAILABLE,
    );
  });
});
