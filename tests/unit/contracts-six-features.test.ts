import { describe, expect, it } from "vitest";
import { FIT_BANDS, fitBandSchema } from "../../src/lib/contracts/fit-bands";
import {
  HOME_TOP_MICE_COUNT,
  homeTopMiceResponseSchema,
} from "../../src/lib/contracts/home";
import { similarResponseSchema } from "../../src/lib/contracts/recommend";
import {
  HOME_TOP_MICE_PATH,
  SURVEY_PATH,
  similarPath,
} from "../../src/lib/contracts/routes";
import {
  MAX_RATED_MICE,
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

describe("fitBandSchema", () => {
  it("lists the bands best first and accepts only those", () => {
    expect(FIT_BANDS[0]).toBe("very_good");
    expect(FIT_BANDS[FIT_BANDS.length - 1]).toBe("poor");
    expect(fitBandSchema.safeParse("good").success).toBe(true);
    expect(fitBandSchema.safeParse("excellent").success).toBe(false);
  });
});

describe("surveySubmissionSchema", () => {
  it("accepts a ticked, well-formed submission", () => {
    expect(surveySubmissionSchema.safeParse(submission).success).toBe(true);
  });

  it("refuses without the consent tick", () => {
    const unticked = {
      ...submission,
      consent: { accepted: false, version: SURVEY_CONSENT_VERSION },
    };
    expect(surveySubmissionSchema.safeParse(unticked).success).toBe(false);
    const missing: Record<string, unknown> = { ...submission };
    delete missing.consent;
    expect(surveySubmissionSchema.safeParse(missing).success).toBe(false);
  });

  it("refuses a stale consent version", () => {
    const body = {
      ...submission,
      consent: { accepted: true, version: "survey-consent-v0" },
    };
    expect(surveySubmissionSchema.safeParse(body).success).toBe(false);
  });

  it("refuses free text, hand measurements and any other extra field", () => {
    for (const extra of [
      { comment: "great" },
      { handLengthMm: 190 },
      { email: "someone@example.com" },
    ]) {
      expect(
        surveySubmissionSchema.safeParse({ ...submission, ...extra }).success,
      ).toBe(false);
    }
  });

  it("bounds the ratings: at least one, at most five, none twice", () => {
    expect(
      surveySubmissionSchema.safeParse({ ...submission, ratings: [] }).success,
    ).toBe(false);
    const tooMany = Array.from({ length: MAX_RATED_MICE + 1 }, (_, i) =>
      rating(`mouse-${i}`),
    );
    expect(
      surveySubmissionSchema.safeParse({ ...submission, ratings: tooMany })
        .success,
    ).toBe(false);
    const twice = [rating("a"), rating("a")];
    expect(
      surveySubmissionSchema.safeParse({ ...submission, ratings: twice })
        .success,
    ).toBe(false);
  });

  it("keeps satisfaction to whole numbers 1 to 5", () => {
    for (const bad of [0, 6, 3.5]) {
      const body = {
        ...submission,
        ratings: [{ ...rating("a"), satisfaction: bad }],
      };
      expect(surveySubmissionSchema.safeParse(body).success).toBe(false);
    }
  });

  it("defaults painPoints to an empty list", () => {
    const body = { ...submission, ratings: [{ slug: "a", satisfaction: 3 }] };
    const parsed = surveySubmissionSchema.parse(body);
    expect(parsed.ratings[0]?.painPoints).toEqual([]);
  });
});

describe("surveySubmitResponseSchema", () => {
  it("says whether the contribution can be withdrawn", () => {
    expect(
      surveySubmitResponseSchema.safeParse({
        stored: true,
        withdrawable: false,
      }).success,
    ).toBe(true);
    expect(surveySubmitResponseSchema.safeParse({ stored: true }).success).toBe(
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
    expect(similarResponseSchema.safeParse(available).success).toBe(true);
    expect(
      similarResponseSchema.safeParse({
        available: false,
        reason: "insufficient_data",
      }).success,
    ).toBe(true);
  });

  it("never mixes them: an unavailable answer carries no mice", () => {
    expect(
      similarResponseSchema.safeParse({
        available: false,
        reason: "insufficient_data",
        mice: [mouse],
      }).success,
    ).toBe(false);
    expect(
      similarResponseSchema.safeParse({ ...available, mice: [] }).success,
    ).toBe(false);
  });

  it("carries aggregates only, no per-person field", () => {
    const leaky = { ...available, mice: [{ ...mouse, contributorId: "x" }] };
    expect(similarResponseSchema.safeParse(leaky).success).toBe(false);
    const outOfScale = {
      ...available,
      mice: [{ ...mouse, meanSatisfaction: 5.5 }],
    };
    expect(similarResponseSchema.safeParse(outOfScale).success).toBe(false);
  });
});

describe("homeTopMiceResponseSchema", () => {
  const mouse = { slug: "a", brand: "Logitech", model: "A" };

  it("holds one to three mice", () => {
    expect(homeTopMiceResponseSchema.safeParse({ mice: [mouse] }).success).toBe(
      true,
    );
    const tooMany = Array.from(
      { length: HOME_TOP_MICE_COUNT + 1 },
      () => mouse,
    );
    expect(homeTopMiceResponseSchema.safeParse({ mice: tooMany }).success).toBe(
      false,
    );
    expect(homeTopMiceResponseSchema.safeParse({ mice: [] }).success).toBe(
      false,
    );
  });

  it("carries no score, no rank and no measurement", () => {
    for (const extra of [
      { total: 90 },
      { rank: 1 },
      { score: 90 },
      { handLengthMm: 190 },
    ]) {
      expect(
        homeTopMiceResponseSchema.safeParse({ mice: [{ ...mouse, ...extra }] })
          .success,
      ).toBe(false);
    }
  });
});

describe("paths", () => {
  it("builds the new routes", () => {
    expect(SURVEY_PATH).toBe("/api/survey");
    expect(HOME_TOP_MICE_PATH).toBe("/api/home/top-mice");
    expect(similarPath(SCAN)).toBe(`/api/scans/${SCAN}/similar`);
  });
});
