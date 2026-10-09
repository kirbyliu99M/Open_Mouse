import { describe, expect, it } from "vitest";
import seedRows from "../../src/db/seed/logitech.json";
import factsJson from "../../src/db/seed/logitech-facts.json";
import { fitResponseSchema } from "../../src/lib/contracts/fit";
import type { FitPreferences } from "../../src/lib/contracts/fit";
import type { HandMeasurements } from "../../src/lib/contracts/measurement";
import { computePriors, type Priors } from "../../src/server/fit/priors";
import { scoreFit } from "../../src/server/fit/score";
import { scoreFitV1 } from "../../src/server/fit/score-v1";
import { buildSeedCatalogue } from "../../src/server/fit/seed-catalogue";
import type { CatalogueMouse } from "../../src/server/fit/types";
import goldenV0 from "./fixtures/fit-golden.json";
import goldenV1 from "./fixtures/fit-golden-v1.json";

/**
 * 2026-10-09 (Kirby): a mouse excluded for `wrong_hand` still shows the total
 * it would get if it were ranked; vertical and trackball exclusions never do.
 * Both engines fill `excluded[].total` from the same function the ranked path
 * calls, so these tests compare an excluded total with a ranked one rather
 * than with a number typed in here.
 */

const seed = buildSeedCatalogue(
  seedRows as Parameters<typeof buildSeedCatalogue>[0],
  factsJson as Parameters<typeof buildSeedCatalogue>[1],
);
const seedPriors = computePriors(seed);
const SCAN_ID = "00000000-0000-4000-8000-000000000000";
const PREFS: FitPreferences = { includeVertical: false };

interface Profile {
  hand: "left" | "right";
  measurements: HandMeasurements;
  top5: { slug: string; total: number }[];
}
const profilesV0 = goldenV0 as Record<string, Profile>;
const profilesV1 = goldenV1 as Record<string, Profile>;

type Engine = (
  catalogue: readonly CatalogueMouse[],
  measurements: HandMeasurements,
  hand: "left" | "right",
  prefs?: FitPreferences,
  priors?: Priors,
) => ReturnType<typeof scoreFit>;

const v0: Engine = (catalogue, m, hand, prefs = PREFS) =>
  scoreFit(m, catalogue, prefs, hand);
const v1: Engine = (catalogue, m, hand, prefs = PREFS, priors = seedPriors) =>
  scoreFitV1(m, catalogue, prefs, hand, priors);

const engines: [string, Engine, Record<string, Profile>][] = [
  ["fit-v0", v0, profilesV0],
  ["fit-v1-candidate", v1, profilesV1],
];

/** Make a mouse the wrong hand for `hand`, whatever its shape was. */
function makeWrongHand(
  mouse: CatalogueMouse,
  hand: "left" | "right",
): CatalogueMouse {
  return hand === "right"
    ? { ...mouse, handCompatibility: "left" }
    : { ...mouse, handCompatibility: "right", shape: "ergonomic" };
}

describe.each(engines)(
  "%s: excluded wrong_hand total",
  (_name, run, golden) => {
    it.each(Object.entries(golden))(
      "%s: every excluded seed mouse gets the total it is ranked with",
      (_n, profile) => {
        const baseline = run(seed, profile.measurements, profile.hand);
        const rankedTotal = new Map(
          baseline.results.map((e) => [e.mouse.slug, e.total]),
        );
        expect(rankedTotal.size).toBeGreaterThan(20);

        // Every mouse the baseline ranks is now made for the other hand.
        const flipped = seed.map((m) =>
          rankedTotal.has(m.slug) ? makeWrongHand(m, profile.hand) : m,
        );
        const r = run(flipped, profile.measurements, profile.hand);

        expect(r.results).toEqual([]);
        const wrongHand = r.excluded.filter((e) => e.reason === "wrong_hand");
        expect(wrongHand.map((e) => e.slug).sort()).toEqual(
          [...rankedTotal.keys()].sort(),
        );
        for (const e of wrongHand) {
          expect(e.total, e.slug).toBe(rankedTotal.get(e.slug));
        }
        // The golden top 5 is the same number, so a coefficient change cannot
        // move the excluded and the ranked total apart unnoticed.
        for (const { slug, total } of profile.top5) {
          expect(wrongHand.find((e) => e.slug === slug)?.total).toBe(total);
        }
      },
    );

    it.each(Object.entries(golden))(
      "%s: ranked results do not change when other mice are excluded",
      (_n, profile) => {
        const baseline = run(seed, profile.measurements, profile.hand);
        const away = new Set(
          baseline.results.slice(0, 4).map((e) => e.mouse.slug),
        );
        const flipped = seed.map((m) =>
          away.has(m.slug) ? makeWrongHand(m, profile.hand) : m,
        );
        const r = run(flipped, profile.measurements, profile.hand);

        expect(away.size).toBe(4);
        expect(r.results.map((e) => e.mouse.slug)).toEqual(
          baseline.results
            .filter((e) => !away.has(e.mouse.slug))
            .map((e) => e.mouse.slug),
        );
        expect(r.results.every((e) => !away.has(e.mouse.slug))).toBe(true);
        const byslug = new Map(baseline.results.map((e) => [e.mouse.slug, e]));
        for (const e of r.results) {
          expect({ ...e, rank: 0 }).toEqual({
            ...byslug.get(e.mouse.slug)!,
            rank: 0,
          });
        }
      },
    );

    it.each(Object.entries(golden))(
      "%s: the ranked top 5 still matches the golden fixture",
      (_n, profile) => {
        const r = run(seed, profile.measurements, profile.hand);
        expect(
          r.results
            .slice(0, 5)
            .map((e) => ({ slug: e.mouse.slug, total: e.total })),
        ).toEqual(profile.top5);
        // The seed has no handedness, so nothing is wrong_hand and no excluded
        // entry carries a total: the golden response only changes when a
        // wrong_hand mouse exists.
        expect(r.excluded.some((e) => "total" in e)).toBe(false);
      },
    );

    it.each(Object.entries(golden))(
      "%s: vertical and trackball exclusions have no total, and the response parses",
      (_n, profile) => {
        const r = run(seed, profile.measurements, profile.hand);
        const noTotal = r.excluded.filter((e) => e.reason !== "wrong_hand");
        expect(noTotal.length).toBeGreaterThan(0);
        for (const e of noTotal) {
          expect(e).not.toHaveProperty("total");
        }
        expect(
          fitResponseSchema.safeParse({ scanId: SCAN_ID, ...r }).success,
        ).toBe(true);
      },
    );

    it.each(Object.entries(golden))(
      "%s: the whole response, with wrong_hand totals, passes fitResponseSchema.parse",
      (_n, profile) => {
        const flipped = seed.map((m, i) =>
          i % 3 === 0 ? makeWrongHand(m, profile.hand) : m,
        );
        const r = run(flipped, profile.measurements, profile.hand);
        expect(r.excluded.some((e) => e.total !== undefined)).toBe(true);
        const parsed = fitResponseSchema.parse({ scanId: SCAN_ID, ...r });
        expect(
          parsed.excluded.filter((e) => e.total !== undefined),
        ).not.toEqual([]);
        for (const e of parsed.excluded) {
          if (e.total !== undefined) {
            expect(e.reason).toBe("wrong_hand");
            expect(Number.isInteger(e.total)).toBe(true);
          }
        }
      },
    );
  },
);

describe("a left-hand-only mouse scored for a right hand", () => {
  const measurements: HandMeasurements = {
    handLengthMm: 190,
    palmLengthMm: 110,
    palmWidthMm: 80,
  };
  // Descriptors partly unknown (flare, thumb), so the neutral prior is in play.
  const rightCopy: CatalogueMouse = {
    slug: "acme-right",
    brand: "Acme",
    model: "Right",
    lengthMm: 121,
    widthMm: 68,
    heightMm: 40,
    weightG: 85,
    size: "medium",
    handCompatibility: "right",
    shape: "symmetrical",
    humpPlacement: "back_moderate",
    frontFlare: null,
    sideCurvature: null,
    thumbRest: null,
  };
  const leftOnly: CatalogueMouse = {
    ...rightCopy,
    slug: "acme-left",
    model: "Left",
    handCompatibility: "left",
  };
  // A classified neighbour, so computePriors has real flare and thumb scores.
  const classified: CatalogueMouse = {
    ...rightCopy,
    slug: "acme-classified",
    model: "Classified",
    frontFlare: "outward_slight",
    thumbRest: true,
  };
  const catalogue = [rightCopy, leftOnly, classified];
  const priors = computePriors(catalogue);

  it.each([
    ["fit-v0", v0],
    ["fit-v1-candidate", v1],
  ] as const)(
    "%s: gets the total its right-hand copy is ranked with",
    (_n, run) => {
      for (const prefs of [
        PREFS,
        { includeVertical: false, weightG: { min: 60, max: 80 } },
        { includeVertical: false, gripStyle: "fingertip" as const },
      ]) {
        const r = run(catalogue, measurements, "right", prefs, priors);
        const ranked = r.results.find((e) => e.mouse.slug === "acme-right");
        const excluded = r.excluded.find((e) => e.slug === "acme-left");
        expect(ranked).toBeDefined();
        expect(excluded?.reason).toBe("wrong_hand");
        expect(excluded?.total).toBe(ranked!.total);
        expect(r.results.map((e) => e.mouse.slug)).not.toContain("acme-left");
      }
    },
  );
});

describe("a vertical or trackball exclusion", () => {
  const measurements: HandMeasurements = {
    handLengthMm: 190,
    palmLengthMm: 110,
    palmWidthMm: 80,
  };
  const standard: CatalogueMouse = {
    slug: "acme-standard",
    brand: "Acme",
    model: "Standard",
    lengthMm: 120,
    widthMm: 68,
    heightMm: 40,
    weightG: 85,
    size: "medium",
    handCompatibility: null,
    shape: "symmetrical",
    humpPlacement: null,
    frontFlare: null,
    sideCurvature: null,
    thumbRest: null,
  };
  const vertical: CatalogueMouse = {
    ...standard,
    slug: "acme-vertical",
    model: "Vertical",
    lengthMm: 108,
    heightMm: 71,
  };
  const trackball: CatalogueMouse = {
    ...standard,
    slug: "acme-trackball",
    model: "Trackball",
    formFactor: "trackball",
  };

  it("v0 leaves the total off a vertical exclusion", () => {
    const r = v0([standard, vertical], measurements, "right");
    expect(r.excluded).toEqual([
      {
        slug: "acme-vertical",
        brand: "Acme",
        model: "Vertical",
        reason: "vertical_form_factor",
      },
    ]);
  });

  it("v1 leaves the total off vertical and trackball exclusions", () => {
    const r = v1(
      [standard, vertical, trackball],
      measurements,
      "right",
      PREFS,
      computePriors([standard]),
    );
    expect(r.excluded.map((e) => [e.slug, e.reason])).toEqual([
      ["acme-vertical", "vertical_form_factor"],
      ["acme-trackball", "trackball_form_factor"],
    ]);
    for (const e of r.excluded) expect(e).not.toHaveProperty("total");
    expect(r.results.map((e) => e.mouse.slug)).toEqual(["acme-standard"]);
  });
});

describe.each([
  ["fit-v0", v0],
  ["fit-v1-candidate", v1],
] as const)("%s: wrong_hand total depends on the form factor", (_n, run) => {
  const measurements: HandMeasurements = {
    handLengthMm: 180,
    palmLengthMm: 102,
    palmWidthMm: 74,
  };
  // Made for the right hand only; scanned with a left hand, shape ergonomic
  // so the left-hand rule excludes it as wrong_hand.
  const rightOnly: CatalogueMouse = {
    slug: "acme-right-only",
    brand: "Acme",
    model: "Right Only",
    lengthMm: 118,
    widthMm: 68,
    heightMm: 40,
    weightG: 85,
    size: "medium",
    handCompatibility: "right",
    shape: "ergonomic",
    humpPlacement: null,
    frontFlare: null,
    sideCurvature: null,
    thumbRest: null,
  };
  const other: CatalogueMouse = {
    ...rightOnly,
    slug: "acme-any",
    model: "Any",
    handCompatibility: null,
  };
  const excludedFor = (mouse: CatalogueMouse) => {
    const r = run(
      [mouse, other],
      measurements,
      "left",
      PREFS,
      computePriors([mouse, other]),
    );
    return r.excluded.find((e) => e.slug === mouse.slug);
  };

  it("a right-only trackball for a left hand is wrong_hand with no total", () => {
    const e = excludedFor({ ...rightOnly, formFactor: "trackball" });
    expect(e?.reason).toBe("wrong_hand");
    expect(e).not.toHaveProperty("total");
  });

  it("a right-only vertical (form factor) for a left hand is wrong_hand with no total", () => {
    const e = excludedFor({ ...rightOnly, formFactor: "vertical" });
    expect(e?.reason).toBe("wrong_hand");
    expect(e).not.toHaveProperty("total");
  });

  it("a right-only vertical by height/length ratio for a left hand has no total", () => {
    const e = excludedFor({ ...rightOnly, lengthMm: 108, heightMm: 71 });
    expect(e?.reason).toBe("wrong_hand");
    expect(e).not.toHaveProperty("total");
  });

  it("a right-only standard mouse for a left hand is wrong_hand with a total", () => {
    const e = excludedFor({ ...rightOnly, formFactor: "standard" });
    expect(e?.reason).toBe("wrong_hand");
    expect(typeof e?.total).toBe("number");
  });

  it("a right-only mouse with an unknown (absent) form factor is treated as standard and keeps its total", () => {
    expect(rightOnly.formFactor).toBeUndefined();
    const e = excludedFor(rightOnly);
    expect(e?.reason).toBe("wrong_hand");
    expect(typeof e?.total).toBe("number");
  });
});
