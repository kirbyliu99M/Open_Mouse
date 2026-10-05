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
  handMeasurementsSchema,
  scanMeasurementsResponseSchema,
} from "../../src/lib/contracts/measurement";
import {
  HOME_TOP_MICE_PATH,
  SURVEY_PATH,
  scanMeasurementsPath,
  similarPath,
} from "../../src/lib/contracts/routes";
import {
  CONTRIBUTION_BIN_MM,
  MAIN_USES,
  MAX_FEEDBACK_CHARS,
  MAX_RATED_MICE,
  OTHER_MOUSE_BRANDS,
  PAIN_POINTS,
  SIZE_FEELS,
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

  it("keeps the candidate comment limit (未拍板)", () => {
    expect(MAX_FEEDBACK_CHARS).toBe(500);
  });

  it("names the consent version the free-text survey needs (candidate)", () => {
    expect(SURVEY_CONSENT_VERSION).toBe("survey-consent-v2-draft");
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
    // The first draft's text did not mention free text: its tick no longer counts.
    expect(
      survey({
        ...submission,
        consent: { accepted: true, version: "survey-consent-v1-draft" },
      }),
    ).toBe(false);
  });

  it("refuses measurements and any other extra field at every level", () => {
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

  it("bounds the ratings: five at most, none twice, and some mouse named", () => {
    expect(survey({ ...submission, ratings: [] })).toBe(false);
    const noRatings: Record<string, unknown> = { ...submission };
    delete noRatings.ratings;
    expect(survey(noRatings)).toBe(false);
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

describe("surveySubmissionSchema v2 fields", () => {
  const other = { brand: "razer", sizeFeel: "large" };

  it("accepts a person who names only a mouse that is not in the catalogue", () => {
    const noRatings: Record<string, unknown> = {
      ...submission,
      otherMouse: other,
    };
    delete noRatings.ratings;
    expect(survey(noRatings)).toBe(true);
    expect(survey({ ...submission, ratings: [], otherMouse: other })).toBe(
      true,
    );
  });

  it("lists the answers Kirby chose: three uses and three size feels (2026-10-06)", () => {
    expect(MAIN_USES).toEqual(["office", "gaming", "mixed"]);
    expect(SIZE_FEELS).toEqual(["small", "just_right", "large"]);
  });

  it("lists the candidate brands (未拍板), each a slug, ending with other", () => {
    // Literal on purpose: a change to the list is a contract PR and must fail here.
    expect(OTHER_MOUSE_BRANDS).toEqual([
      "logitech",
      "razer",
      "steelseries",
      "corsair",
      "hyperx",
      "asus",
      "msi",
      "acer",
      "zowie",
      "glorious",
      "pulsar",
      "finalmouse",
      "vaxee",
      "endgame_gear",
      "cooler_master",
      "microsoft",
      "apple",
      "hp",
      "dell",
      "lenovo",
      "xiaomi",
      "anker",
      "elecom",
      "kensington",
      "other",
    ]);
  });

  it("takes a main use from the list, or none", () => {
    for (const use of MAIN_USES) {
      expect(survey({ ...submission, mainUse: use })).toBe(true);
    }
    for (const bad of ["streaming", "creative", "development", "", null, 1]) {
      expect(survey({ ...submission, mainUse: bad })).toBe(false);
    }
    expect(survey(submission)).toBe(true);
  });

  it("marks at most one mouse as the current one, across both kinds", () => {
    const current = (slug: string) => ({ ...rating(slug), current: true });
    expect(
      survey({ ...submission, ratings: [current("a"), rating("b")] }),
    ).toBe(true);
    expect(
      survey({ ...submission, ratings: [current("a"), current("b")] }),
    ).toBe(false);
    expect(
      survey({
        ...submission,
        ratings: [current("a")],
        otherMouse: { ...other, current: true },
      }),
    ).toBe(false);
    expect(
      survey({
        ...submission,
        ratings: [rating("a")],
        otherMouse: { ...other, current: true },
      }),
    ).toBe(true);
  });

  it("defaults current to false, on both kinds", () => {
    const parsed = surveySubmissionSchema.parse({
      ...submission,
      otherMouse: other,
    });
    expect(parsed.ratings[0]?.current).toBe(false);
    expect(parsed.otherMouse?.current).toBe(false);
  });

  it("takes the other mouse's brand from the list and its size feel from the three", () => {
    for (const brand of OTHER_MOUSE_BRANDS) {
      expect(survey({ ...submission, otherMouse: { ...other, brand } })).toBe(
        true,
      );
    }
    for (const sizeFeel of SIZE_FEELS) {
      expect(
        survey({ ...submission, otherMouse: { ...other, sizeFeel } }),
      ).toBe(true);
    }
    for (const brand of [
      "Razer",
      "",
      "   ",
      "unlisted",
      "razer ",
      "x".repeat(60),
      null,
      0,
      ["razer"],
    ]) {
      expect(survey({ ...submission, otherMouse: { ...other, brand } })).toBe(
        false,
      );
    }
    // The old five-level values: only just_right is still a size feel.
    for (const sizeFeel of [
      "huge",
      "too_small",
      "slightly_small",
      "slightly_large",
      "too_large",
      "",
      null,
    ]) {
      expect(
        survey({ ...submission, otherMouse: { ...other, sizeFeel } }),
      ).toBe(false);
    }
    const missing: Record<string, unknown> = { ...other };
    delete missing.sizeFeel;
    expect(survey({ ...submission, otherMouse: missing })).toBe(false);
    const noBrand: Record<string, unknown> = { ...other };
    delete noBrand.brand;
    expect(survey({ ...submission, otherMouse: noBrand })).toBe(false);
  });

  it("trims the comment before counting it", () => {
    const parsed = surveySubmissionSchema.parse({
      ...submission,
      feedback: "  Nice.  ",
    });
    expect(parsed.feedback).toBe("Nice.");
    expect(survey({ ...submission, feedback: `  ${"x".repeat(500)}  ` })).toBe(
      true,
    );
  });

  it("allows one open comment of 1 to 500 characters, or none", () => {
    expect(survey({ ...submission, feedback: "x" })).toBe(true);
    expect(survey({ ...submission, feedback: "x".repeat(500) })).toBe(true);
    expect(survey({ ...submission, feedback: "x".repeat(501) })).toBe(false);
    expect(survey({ ...submission, feedback: "" })).toBe(false);
    expect(survey({ ...submission, feedback: "  \n " })).toBe(false);
    expect(survey({ ...submission, feedback: 5 })).toBe(false);
  });

  it("lets the grip be left out, for the server to fill in", () => {
    const noGrip: Record<string, unknown> = { ...submission };
    delete noGrip.gripStyle;
    expect(survey(noGrip)).toBe(true);
  });

  it("refuses control characters and unpaired surrogates in the comment", () => {
    for (const bad of [
      "a\u0000b",
      "\u0000",
      "a\u0001b",
      "a\u000bb",
      "a\u000cb",
      "a\u001fb",
      "a\u007fb",
      "a\u0085b",
      "a\u009fb",
      "a\ud800b",
      "a\udc00b",
    ]) {
      expect(survey({ ...submission, feedback: bad })).toBe(false);
    }
  });

  it("lets the comment run over several lines", () => {
    expect(survey({ ...submission, feedback: "line one\nline two\ttab" })).toBe(
      true,
    );
    expect(survey({ ...submission, feedback: "line one\r\nline two" })).toBe(
      true,
    );
    expect(survey({ ...submission, feedback: "great 👍 mouse" })).toBe(true);
  });

  it("refuses an email address or a phone number in the comment", () => {
    for (const bad of [
      "write to me at someone@example.com",
      "call 0912 345 678",
      "+886 912 345 678",
      "(02) 2345 6789",
    ]) {
      expect(survey({ ...submission, feedback: bad })).toBe(false);
    }
    expect(
      survey({ ...submission, feedback: "used it from 2026-10-02, 3000 dpi" }),
    ).toBe(true);
  });

  it("refuses an extra field inside the other mouse", () => {
    expect(
      survey({ ...submission, otherMouse: { ...other, model: "Viper" } }),
    ).toBe(false);
    expect(
      survey({ ...submission, otherMouse: { ...other, satisfaction: 4 } }),
    ).toBe(false);
  });
});

describe("scanMeasurementsResponseSchema", () => {
  const body = {
    scanId: SCAN,
    hand: "right",
    measurements: { handLengthMm: 185, palmLengthMm: 105, palmWidthMm: 84 },
  };
  const measured = accepts(scanMeasurementsResponseSchema);

  it("accepts the viewer's inputs, with or without finger lengths", () => {
    expect(measured(body)).toBe(true);
    expect(
      measured({
        ...body,
        measurements: { ...body.measurements, indexLengthMm: 70 },
      }),
    ).toBe(true);
  });

  it("is the stored scan's own measurements schema, not a copy", () => {
    expect(scanMeasurementsResponseSchema.shape.measurements).toBe(
      handMeasurementsSchema,
    );
  });

  it("holds the same cross-field invariants as the stored scan", () => {
    // Each value is inside its own field's range, so only the invariant can refuse it.
    expect(
      measured({
        ...body,
        measurements: {
          handLengthMm: 100,
          palmLengthMm: 105,
          palmWidthMm: 84,
        },
      }),
    ).toBe(false);
    expect(
      measured({
        ...body,
        measurements: {
          ...body.measurements,
          handLengthMm: 120,
          middleLengthMm: 125,
        },
      }),
    ).toBe(false);
    expect(
      measured({
        ...body,
        measurements: { ...body.measurements, handLengthMm: 300 },
      }),
    ).toBe(false);
  });

  it("needs a UUID scan id, a hand and measurements, and carries nothing else", () => {
    expect(measured({ ...body, scanId: "not-a-uuid" })).toBe(false);
    expect(measured({ ...body, hand: "both" })).toBe(false);
    for (const key of ["scanId", "hand", "measurements"]) {
      const without: Record<string, unknown> = { ...body };
      delete without[key];
      expect(measured(without)).toBe(false);
    }
    expect(measured({ ...body, measurements: null })).toBe(false);
    expect(
      measured({
        ...body,
        measurements: { ...body.measurements, indexLengthMm: null },
      }),
    ).toBe(false);
    expect(measured({ ...body, gripStyleStated: "claw" })).toBe(false);
    expect(
      measured({
        ...body,
        measurements: { ...body.measurements, photo: "data:image/png" },
      }),
    ).toBe(false);
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

  it("never echoes what the person typed or chose", () => {
    const ok = accepts(surveySubmitResponseSchema);
    const base = { stored: true, withdrawable: true };
    for (const extra of [
      { feedback: "great" },
      { otherMouse: { brand: "Razer", sizeFeel: "just_right" } },
      { brand: "Razer" },
      { mainUse: "gaming" },
      { ratings: [] },
    ]) {
      expect(ok({ ...base, ...extra })).toBe(false);
    }
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
    expect(scanMeasurementsPath(SCAN)).toBe(`/api/scans/${SCAN}/measurements`);
  });

  it("encodes a hostile scan id, as the other scan paths do", () => {
    expect(similarPath("../../account")).toBe(
      "/api/scans/..%2F..%2Faccount/similar",
    );
    expect(similarPath("a?b#c")).toBe("/api/scans/a%3Fb%23c/similar");
    expect(scanMeasurementsPath("../../account")).toBe(
      "/api/scans/..%2F..%2Faccount/measurements",
    );
  });
});
