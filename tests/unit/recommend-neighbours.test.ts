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
    // a and b tie on neighbours' mean (4, 2 raters each). If the caller's own
    // 5 for b were in the prior, b would pull ahead of a on the shrunk score.
    const base = [
      person("n1", [rate("a", 4), rate("b", 4)]),
      person("n2", [rate("a", 4), rate("b", 4)]),
    ];
    // `mine` is far from the caller (another scan, another hand size), so it
    // is no neighbour either way: it can only act through the prior.
    const own = person("mine", [rate("b", 5)], { handLengthBinMm: HAND + 50 });
    const c = caller({ ownContributionIds: new Set(["mine"]) });
    expect(slugs(similarHands(c, [own, ...base]))).toEqual(["a", "b"]);
    expect(similarHands(c, [own, ...base])).toEqual(similarHands(c, base));
    // The contrast: had `mine` been someone else's, the prior would put b ahead.
    expect(slugs(similarHands(caller(), [own, ...base]))).toEqual(["b", "a"]);
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
    // 2 raters at 5; five far-away people at 1 pull the prior down, so the
    // score is far below 5. The visitor still sees 5.
    const pool = [
      ...crowd("n", "m", [5, 5]),
      ...crowd("f", "m", [1, 1, 1, 1, 1], { handLengthBinMm: HAND + 40 }),
    ];
    const res = parsed(similarHands(caller(), pool));
    expect(res.available && res.mice[0]?.meanSatisfaction).toBe(5);
  });

  it("is exactly sum / n for a mean with no short decimal", () => {
    const res = parsed(
      similarHands(caller(), crowd("n", "m", [5, 4, 4, 5, 4])),
    );
    expect(res.available && res.mice[0]?.meanSatisfaction).toBe(22 / 5);
  });

  it("ignores a rating off the 1 to 5 scale, and does not clamp it", () => {
    const pool = [
      ...crowd("ok", "m", [4, 4]),
      person("bad1", [rate("m", 6)]),
      person("bad2", [rate("m", 0)]),
      person("bad3", [rate("m", Number.NaN)]),
      person("bad4", [rate("m", Number.POSITIVE_INFINITY)]),
    ];
    const res = parsed(similarHands(caller(), pool));
    expect(res).toMatchObject({ available: true, neighbours: 6 });
    expect(res.available && res.mice).toEqual([
      expect.objectContaining({ raters: 2, meanSatisfaction: 4 }),
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
  it("shrunkScore: one 5 does not beat eight 4.6s when the prior is below both", () => {
    // With weight 4 the two cross at a prior of about 4.43: above it the lone 5
    // is pulled up by the prior as much as the eight 4.6s are, and may lead.
    // The prior is the mouse's own mean among everyone, so a prior that high
    // means everyone loves it, and then it should lead.
    for (const prior of [1, 2, 3, 4, 4.2, 4.4]) {
      expect(shrunkScore(1, 5, prior)).toBeLessThan(shrunkScore(8, 4.6, prior));
    }
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
   * them also rate "flashy" at 5; six people far away rated it 2. The
   * neighbours' plain mean for flashy is higher (5 against 4.6), but only two
   * of them say so and the world disagrees.
   */
  function steadyVsFlashy(): Contribution[] {
    const steady = crowd("s", "steady", [5, 5, 5, 5, 5, 5, 4, 4, 4, 4]);
    const flashyNear = [
      person("s0", [rate("steady", 5), rate("flashy", 5)]),
      person("s1", [rate("steady", 5), rate("flashy", 5)]),
    ];
    const rest = steady.slice(2);
    const flashyFar = crowd("f", "flashy", [2, 2, 2, 2, 2, 2], {
      handLengthBinMm: HAND + 50,
    });
    return [...flashyNear, ...rest, ...flashyFar];
  }

  it("two 5s that everyone else disputes do not outrank ten 4.6s", () => {
    const res = parsed(similarHands(caller(), steadyVsFlashy()));
    expect(slugs(res)).toEqual(["steady", "flashy"]);
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
    ]);
  });

  it("with no prior weight the same pool ranks by plain mean (contrast)", () => {
    const res = similarHands(caller(), steadyVsFlashy(), {
      ...DEFAULT_SIMILAR_RULES,
      priorWeight: 0,
    });
    expect(slugs(res)).toEqual(["flashy", "steady"]);
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

  it("gives the same mean for any order of values a float sum would feel", () => {
    // These six values add to four different floats depending on the order.
    const values = [1.1, 2.2, 3.3, 4.4, 1.7, 2.9];
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
    const own = Object.freeze(new Set(["c1"]));
    expect(() =>
      similarHands(caller({ ownContributionIds: own }), frozen),
    ).not.toThrow();
    expect(frozen).toEqual(pool);
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
 * with. It uses integer sums, so its means are exact.
 */
function oracle(c: Caller, pool: readonly Contribution[]) {
  const others = pool.filter((p) => !c.ownContributionIds.has(p.id));
  const near = others.filter(
    (p) =>
      Math.abs(p.handLengthBinMm - c.handLengthBinMm) <= 10 &&
      Math.abs(p.palmWidthBinMm - c.palmWidthBinMm) <= 5,
  );
  const rows = new Map<
    string,
    { nearSum: number; nearN: number; allSum: number; allN: number }
  >();
  for (const p of others) {
    const isNear = near.includes(p);
    for (const r of p.ratings) {
      const row = rows.get(r.slug) ?? {
        nearSum: 0,
        nearN: 0,
        allSum: 0,
        allN: 0,
      };
      row.allSum += r.satisfaction;
      row.allN += 1;
      if (isNear) {
        row.nearSum += r.satisfaction;
        row.nearN += 1;
      }
      rows.set(r.slug, row);
    }
  }
  const listed = [...rows.entries()]
    .filter(([, row]) => row.nearN >= 2)
    .map(([slug, row]) => ({
      slug,
      raters: row.nearN,
      mean: row.nearSum / row.nearN,
      score: (row.nearSum + 4 * (row.allSum / row.allN)) / (row.nearN + 4),
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
