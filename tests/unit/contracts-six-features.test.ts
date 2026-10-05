import { describe, expect, it } from "vitest";
import { FIT_BANDS, fitBandSchema } from "../../src/lib/contracts/fit-bands";
import {
  HOME_TOP_MICE_COUNT,
  homeTopMiceResponseSchema,
} from "../../src/lib/contracts/home";
import {
  MAX_SIMILAR_MICE,
  SIMILAR_MIN_PEOPLE,
  similarResponseSchema,
} from "../../src/lib/contracts/recommend";
import {
  HOME_TOP_MICE_PATH,
  SURVEY_PATH,
  similarPath,
} from "../../src/lib/contracts/routes";
import {
  CONTRIBUTION_BIN_MM,
  MAX_RATED_MICE,
  PAIN_POINTS,
  SURVEY_CONSENT_VERSION,
  surveySubmissionSchema,
  surveySubmitResponseSchema,
} from "../../src/lib/contracts/survey";

const SCAN = "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f";
const rating = (slug: string) => ({
  slug,
  satisfaction: 4,
  duration: "1_to_6_months",
  painPoints: ["length"],
});
const submission = {
  scanId: SCAN,
  consent: { accepted: true, version: SURVEY_CONSENT_VERSION },
  gripStyle: "claw",
  ratings: [rating("logitech-ergo-m575")],
};
const accepts =
  (schema: { safeParse: (v: unknown) => { success: boolean } }) =>
  (v: unknown) =>
    schema.safeParse(v).success;
const survey = accepts(surveySubmissionSchema);
const similar = accepts(similarResponseSchema);
const home = accepts(homeTopMiceResponseSchema);

describe("pinned numbers", () => {
  // The limits are literal on purpose: a test that built its input from the
  // constant would pass for any value of it.
  it("keeps the agreed numbers", () => {
    expect(MAX_RATED_MICE).toBe(5);
    expect(HOME_TOP_MICE_COUNT).toBe(3);
    expect(MAX_SIMILAR_MICE).toBe(5);
    expect(SIMILAR_MIN_PEOPLE).toBe(2);
    expect(CONTRIBUTION_BIN_MM).toBe(5);
  });
});

describe("fitBandSchema", () => {
  it("lists the bands best first and accepts only those", () => {
    expect(FIT_BANDS).toEqual(["very_good", "good", "fair", "poor"]);
    expect(fitBandSchema.safeParse("good").success).toBe(true);
    expect(fitBandSchema.safeParse("excellent").success).toBe(false);
  });
});

describe("surveySubmissionSchema", () => {
  it("accepts a ticked, well-formed submission", () => {
    expect(survey(submission)).toBe(true);
  });

  it("refuses without the consent tick, or with a stale version", () => {
    expect(
      survey({
        ...submission,
        consent: { accepted: false, version: SURVEY_CONSENT_VERSION },
      }),
    ).toBe(false);
    const missing: Record<string, unknown> = { ...submission };
    delete missing.consent;
    expect(survey(missing)).toBe(false);
    expect(
      survey({
        ...submission,
        consent: { accepted: true, version: "survey-consent-v0" },
      }),
    ).toBe(false);
  });

  it("refuses free text, measurements and any other extra field at every level", () => {
    for (const extra of [
      { comment: "great" },
      { handLengthMm: 190 },
      { email: "someone@example.com" },
    ]) {
      expect(survey({ ...submission, ...extra })).toBe(false);
      expect(
        survey({
          ...submission,
          ratings: [{ ...rating("a"), ...extra }],
        }),
      ).toBe(false);
      expect(
        survey({
          ...submission,
          consent: { ...submission.consent, ...extra },
        }),
      ).toBe(false);
    }
  });

  it("bounds the ratings: one to five, none twice", () => {
    expect(survey({ ...submission, ratings: [] })).toBe(false);
    const five = Array.from({ length: 5 }, (_, i) => rating(`mouse-${i}`));
    const six = Array.from({ length: 6 }, (_, i) => rating(`mouse-${i}`));
    expect(survey({ ...submission, ratings: five })).toBe(true);
    expect(survey({ ...submission, ratings: six })).toBe(false);
    expect(survey({ ...submission, ratings: [rating("a"), rating("a")] })).toBe(
      false,
    );
  });

  it("keeps satisfaction to whole numbers 1 to 5", () => {
    for (const ok of [1, 5]) {
      expect(
        survey({
          ...submission,
          ratings: [{ ...rating("a"), satisfaction: ok }],
        }),
      ).toBe(true);
    }
    for (const bad of [0, 6, 3.5]) {
      expect(
        survey({
          ...submission,
          ratings: [{ ...rating("a"), satisfaction: bad }],
        }),
      ).toBe(false);
    }
  });

  it("requires a UUID scan id", () => {
    for (const bad of ["not-a-uuid", "", "../../account"]) {
      expect(survey({ ...submission, scanId: bad })).toBe(false);
    }
  });

  it("accepts only the listed grips, durations and pain points", () => {
    expect(survey({ ...submission, gripStyle: "fist" })).toBe(false);
    expect(
      survey({
        ...submission,
        ratings: [{ ...rating("a"), duration: "forever" }],
      }),
    ).toBe(false);
    expect(
      survey({
        ...submission,
        ratings: [{ ...rating("a"), painPoints: ["ugly"] }],
      }),
    ).toBe(false);
  });

  it("names each pain point once, and at most the listed ones", () => {
    expect(
      survey({
        ...submission,
        ratings: [{ ...rating("a"), painPoints: [...PAIN_POINTS] }],
      }),
    ).toBe(true);
    expect(
      survey({
        ...submission,
        ratings: [{ ...rating("a"), painPoints: ["length", "length"] }],
      }),
    ).toBe(false);
    expect(
      survey({
        ...submission,
        ratings: [
          { ...rating("a"), painPoints: Array(100).fill("length") as string[] },
        ],
      }),
    ).toBe(false);
  });

  it("bounds the slug", () => {
    expect(
      survey({ ...submission, ratings: [{ ...rating(""), slug: "" }] }),
    ).toBe(false);
    expect(survey({ ...submission, ratings: [rating("x".repeat(100))] })).toBe(
      true,
    );
    expect(survey({ ...submission, ratings: [rating("x".repeat(101))] })).toBe(
      false,
    );
  });

  it("defaults painPoints to an empty list", () => {
    const parsed = surveySubmissionSchema.parse({
      ...submission,
      ratings: [{ slug: "a", satisfaction: 3 }],
    });
    expect(parsed.ratings[0]?.painPoints).toEqual([]);
  });
});

describe("surveySubmitResponseSchema", () => {
  it("says whether the contribution can be withdrawn, and nothing else", () => {
    const ok = accepts(surveySubmitResponseSchema);
    expect(ok({ stored: true, withdrawable: false })).toBe(true);
    expect(ok({ stored: true })).toBe(false);
    expect(ok({ stored: false, withdrawable: false })).toBe(false);
    expect(ok({ stored: true, withdrawable: true, contributionId: "x" })).toBe(
      false,
    );
  });
});

describe("similarResponseSchema", () => {
  const mouse = {
    slug: "logitech-ergo-m575",
    brand: "Logitech",
    model: "Ergo M575",
    raters: 7,
    meanSatisfaction: 4.1,
  };
  const available = {
    available: true,
    neighbours: 12,
    basis: { handLengthBinMm: 185, palmWidthBinMm: 85, gripStyle: "claw" },
    mice: [mouse],
  };

  it("accepts the two shapes", () => {
    expect(similar(available)).toBe(true);
    expect(similar({ available: false, reason: "insufficient_data" })).toBe(
      true,
    );
  });

  it("never mixes them: an unavailable answer carries no mice", () => {
    expect(
      similar({
        available: false,
        reason: "insufficient_data",
        mice: [mouse],
      }),
    ).toBe(false);
    expect(similar({ ...available, mice: [] })).toBe(false);
  });

  it("carries aggregates only: no extra field at any level", () => {
    expect(similar({ ...available, contributors: ["a"] })).toBe(false);
    expect(
      similar({ ...available, mice: [{ ...mouse, contributorId: "x" }] }),
    ).toBe(false);
    expect(
      similar({
        ...available,
        basis: { ...available.basis, handLengthMm: 187 },
      }),
    ).toBe(false);
  });

  it("is never one person's answer", () => {
    expect(similar({ ...available, neighbours: 1 })).toBe(false);
    expect(
      similar({ ...available, neighbours: 2, mice: [{ ...mouse, raters: 1 }] }),
    ).toBe(false);
    expect(
      similar({ ...available, neighbours: 2, mice: [{ ...mouse, raters: 2 }] }),
    ).toBe(true);
  });

  it("cannot have more raters than neighbours, or a mouse twice", () => {
    expect(similar({ ...available, neighbours: 6 })).toBe(false);
    expect(similar({ ...available, mice: [mouse, mouse] })).toBe(false);
  });

  it("keeps the mean on the 1 to 5 scale and the list to five mice", () => {
    expect(
      similar({ ...available, mice: [{ ...mouse, meanSatisfaction: 5.5 }] }),
    ).toBe(false);
    expect(
      similar({ ...available, mice: [{ ...mouse, meanSatisfaction: 0.5 }] }),
    ).toBe(false);
    const mice = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ ...mouse, slug: `m-${i}` }));
    expect(similar({ ...available, mice: mice(5) })).toBe(true);
    expect(similar({ ...available, mice: mice(6) })).toBe(false);
  });

  it("states the caller's profile only in whole bins", () => {
    expect(
      similar({
        ...available,
        basis: { ...available.basis, handLengthBinMm: 187 },
      }),
    ).toBe(false);
    expect(
      similar({
        ...available,
        basis: { ...available.basis, palmWidthBinMm: 86 },
      }),
    ).toBe(false);
  });
});

describe("homeTopMiceResponseSchema", () => {
  const mouse = { slug: "a", brand: "Logitech", model: "A" };

  it("holds one to three mice", () => {
    expect(home({ mice: [mouse] })).toBe(true);
    expect(home({ mice: [mouse, mouse, mouse] })).toBe(true);
    expect(home({ mice: [mouse, mouse, mouse, mouse] })).toBe(false);
    expect(home({ mice: [] })).toBe(false);
    expect(home({ mice: [{ ...mouse, slug: "" }] })).toBe(false);
  });

  it("carries no score, no rank and no measurement, at either level", () => {
    for (const extra of [
      { total: 90 },
      { rank: 1 },
      { score: 90 },
      { handLengthMm: 190 },
    ]) {
      expect(home({ mice: [{ ...mouse, ...extra }] })).toBe(false);
      expect(home({ mice: [mouse], ...extra })).toBe(false);
    }
    expect(home({ mice: [mouse], scores: [90] })).toBe(false);
  });
});

describe("paths", () => {
  it("builds the new routes", () => {
    expect(SURVEY_PATH).toBe("/api/survey");
    expect(HOME_TOP_MICE_PATH).toBe("/api/home/top-mice");
    expect(similarPath(SCAN)).toBe(`/api/scans/${SCAN}/similar`);
  });

  it("encodes a hostile scan id, as the other scan paths do", () => {
    expect(similarPath("../../account")).toBe(
      "/api/scans/..%2F..%2Faccount/similar",
    );
    expect(similarPath("a?b#c")).toBe("/api/scans/a%3Fb%23c/similar");
  });
});
