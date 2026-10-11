import { describe, expect, it } from "vitest";
import {
  brandChips,
  buildSubmission,
  canRemoveMouse,
  canSubmit,
  draftFromRating,
  editBodyFrom,
  emptyForm,
  emptyOtherDraft,
  emptyRatingDraft,
  extraSlotsLeft,
  failureLine,
  feedbackLength,
  filterChoices,
  formMouseCount,
  hasSendableMouse,
  isOverCap,
  miceInBody,
  otherTaken,
  ratingFromDraft,
  sortChoices,
  togglePain,
  withFeedback,
  withMainUse,
  withOther,
  withRating,
  withoutOther,
  withoutRating,
  type CatalogueChoice,
  type FormState,
} from "../../src/app/account/questionnaire-model";
import {
  MAX_ACCOUNT_MICE,
  MAX_FEEDBACK_CHARS,
  MAX_RATED_MICE,
  PAIN_POINTS,
  SURVEY_CONSENT_VERSION,
  surveyEditSchema,
  surveyMineResponseSchema,
  surveySubmissionSchema,
  type SurveyMineResponse,
} from "../../src/lib/contracts/survey";
import { en, zhTW } from "../../src/lib/copy/questionnaire";

const SCAN = "6f1c1b6e-8d0e-4a0f-9d63-0b1a2c3d4e5f";

const mine = (body: unknown): SurveyMineResponse =>
  surveyMineResponseSchema.parse(body);

const ANSWERS = mine({
  mainUse: "gaming",
  feedback: "  手感偏小  ",
  ratings: [
    {
      slug: "logitech-g-pro-x-superlight-2",
      satisfaction: 4,
      duration: "6_to_12_months",
      painPoints: ["length"],
      current: true,
    },
    {
      slug: "razer-deathadder-v3",
      satisfaction: 3,
      painPoints: [],
      current: false,
    },
  ],
  otherMice: [{ brand: "zowie", sizeFeel: "large", current: false }],
});

function formWith(patch: Partial<FormState>): FormState {
  return { ...emptyForm(), ...patch };
}

const SUPERLIGHT = {
  slug: "logitech-g-pro-x-superlight-2",
  brand: "Logitech",
  model: "G Pro X Superlight 2",
};

describe("the first-time form's body", () => {
  it("is not sendable without the consent, or without a mouse the contract takes", () => {
    const rated = formWith({
      current: {
        kind: "rating",
        draft: { ...emptyRatingDraft("a"), satisfaction: 4 },
      },
    });
    expect(canSubmit(rated)).toBe(false);
    expect(buildSubmission(rated, SCAN)).toBeNull();
    expect(canSubmit(formWith({ consent: true }))).toBe(false);
    // A catalogue mouse with no score cannot be sent: the contract needs one.
    const unscored = formWith({
      consent: true,
      current: { kind: "rating", draft: emptyRatingDraft("a") },
    });
    expect(hasSendableMouse(unscored)).toBe(false);
    expect(buildSubmission(unscored, SCAN)).toBeNull();
    expect(canSubmit({ ...rated, consent: true })).toBe(true);
  });

  it("a brand-only current mouse needs nothing more than the consent", () => {
    const form = formWith({
      consent: true,
      current: {
        kind: "other",
        draft: { ...emptyOtherDraft(), brand: "razer" },
      },
    });
    expect(canSubmit(form)).toBe(true);
    const body = buildSubmission(form, SCAN);
    expect(body?.otherMouse).toEqual({
      brand: "razer",
      sizeFeel: "just_right",
      current: true,
    });
    expect(body?.ratings).toEqual([]);
  });

  it("builds a body the contract accepts, with the current mouse marked and the rest not", () => {
    const form = formWith({
      consent: true,
      mainUse: "mixed",
      feedback: "  請不要太小  ",
      current: {
        kind: "rating",
        draft: {
          slug: SUPERLIGHT.slug,
          satisfaction: 4,
          duration: "1_to_6_months",
          painPoints: ["width", "length"],
        },
      },
      extraRatings: [{ ...emptyRatingDraft("b"), satisfaction: 2 }],
      extraOther: { brand: "apple", sizeFeel: "small", model: "Magic Mouse" },
    });
    const body = buildSubmission(form, SCAN);
    expect(body).not.toBeNull();
    expect(surveySubmissionSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({
      scanId: SCAN,
      consent: { accepted: true, version: SURVEY_CONSENT_VERSION },
      mainUse: "mixed",
      feedback: "請不要太小",
      ratings: [
        {
          slug: SUPERLIGHT.slug,
          satisfaction: 4,
          duration: "1_to_6_months",
          painPoints: ["width", "length"],
          current: true,
        },
        { slug: "b", satisfaction: 2, painPoints: [], current: false },
      ],
      otherMouse: { brand: "apple", sizeFeel: "small", current: false },
    });
  });

  it("never sends the model of a brand-only mouse: the contract has no such field", () => {
    const form = formWith({
      consent: true,
      extraOther: {
        brand: "razer",
        sizeFeel: "large",
        model: "DeathAdder V3",
      },
    });
    const text = JSON.stringify(buildSubmission(form, SCAN));
    expect(text).not.toContain("DeathAdder");
    expect(text).not.toContain("model");
  });

  it("leaves out an empty comment, an unanswered main use and an unscored extra mouse", () => {
    const form = formWith({
      consent: true,
      feedback: "   ",
      current: {
        kind: "rating",
        draft: { ...emptyRatingDraft("a"), satisfaction: 5 },
      },
      extraRatings: [emptyRatingDraft("b")],
    });
    const body = buildSubmission(form, SCAN);
    expect(body).not.toHaveProperty("feedback");
    expect(body).not.toHaveProperty("mainUse");
    expect(body?.ratings.map((r) => r.slug)).toEqual(["a"]);
  });

  it("a duration left unanswered is absent, not null", () => {
    const rating = ratingFromDraft(
      { ...emptyRatingDraft("a"), satisfaction: 3 },
      false,
    );
    expect(rating).toEqual({
      slug: "a",
      satisfaction: 3,
      painPoints: [],
      current: false,
    });
    expect(rating).not.toHaveProperty("duration");
  });

  it("counts mice and the slots left against MAX_RATED_MICE in all", () => {
    const form = formWith({
      current: { kind: "rating", draft: emptyRatingDraft("a") },
      extraRatings: [emptyRatingDraft("b"), emptyRatingDraft("c")],
      extraOther: emptyOtherDraft(),
    });
    expect(formMouseCount(form)).toBe(4);
    expect(extraSlotsLeft(form)).toBe(MAX_RATED_MICE - 4);
    expect(extraSlotsLeft(emptyForm())).toBe(MAX_RATED_MICE);
    expect(
      extraSlotsLeft(
        formWith({
          extraRatings: Array.from({ length: 9 }, (_, i) =>
            emptyRatingDraft(`m${i}`),
          ),
        }),
      ),
    ).toBe(0);
  });

  it("a body holds one brand-only answer: it is taken by the current mouse or by an extra, not both", () => {
    const currentOther = formWith({
      current: { kind: "other", draft: emptyOtherDraft() },
    });
    const extraOther = formWith({ extraOther: emptyOtherDraft() });
    expect(otherTaken(emptyForm(), null)).toBe(false);
    expect(otherTaken(currentOther, "extra")).toBe(true);
    expect(otherTaken(currentOther, "current")).toBe(false);
    expect(otherTaken(extraOther, "current")).toBe(true);
    expect(otherTaken(extraOther, "extra")).toBe(false);
  });

  it("the comment counts the way the contract does, in UTF-16 units", () => {
    expect(feedbackLength("abc")).toBe(3);
    expect(feedbackLength("😀")).toBe(2);
    const limit = "字".repeat(MAX_FEEDBACK_CHARS);
    const body = buildSubmission(
      formWith({
        consent: true,
        feedback: limit,
        extraOther: emptyOtherDraft(),
      }),
      SCAN,
    );
    expect(surveySubmissionSchema.safeParse(body).success).toBe(true);
  });
});

describe("the edit body, a whole replacement", () => {
  it("copies every answer from the read-back: nothing is dropped, a blank comment becomes null", () => {
    const body = editBodyFrom(ANSWERS);
    expect(surveyEditSchema.safeParse(body).success).toBe(true);
    expect(body.ratings).toHaveLength(2);
    expect(body.otherMice).toEqual([
      { brand: "zowie", sizeFeel: "large", current: false },
    ]);
    expect(body.mainUse).toBe("gaming");
    expect(body.feedback).toBe("手感偏小");
    expect(
      editBodyFrom(mine({ ...ANSWERS, feedback: "   ", mainUse: null })),
    ).toMatchObject({ feedback: null, mainUse: null });
    expect(
      editBodyFrom(mine({ ...ANSWERS, feedback: null })).feedback,
    ).toBeNull();
  });

  it("does not share arrays with the read-back (an edit cannot change what the page shows)", () => {
    const body = editBodyFrom(ANSWERS);
    body.ratings[0]?.painPoints.push("width");
    expect(ANSWERS.ratings[0]?.painPoints).toEqual(["length"]);
  });

  it("changing one rating replaces that rating and keeps the others as they were", () => {
    const base = editBodyFrom(ANSWERS);
    const next = withRating(base, {
      slug: "razer-deathadder-v3",
      satisfaction: 5,
      duration: "over_3_years",
      painPoints: ["weight"],
      current: false,
    });
    expect(next.ratings).toHaveLength(2);
    expect(next.ratings[1]).toMatchObject({
      satisfaction: 5,
      duration: "over_3_years",
    });
    expect(next.ratings[0]).toEqual(base.ratings[0]);
    expect(next.otherMice).toEqual(base.otherMice);
    expect(next.mainUse).toBe(base.mainUse);
    expect(next.feedback).toBe(base.feedback);
    expect(surveyEditSchema.safeParse(next).success).toBe(true);
  });

  it("a rating that is new goes to the end", () => {
    const next = withRating(editBodyFrom(ANSWERS), {
      slug: "new-mouse",
      satisfaction: 2,
      painPoints: [],
      current: false,
    });
    expect(next.ratings.map((r) => r.slug)).toEqual([
      "logitech-g-pro-x-superlight-2",
      "razer-deathadder-v3",
      "new-mouse",
    ]);
  });

  it("the single-current rule: switching it on elsewhere clears the earlier one, across both lists", () => {
    const base = editBodyFrom(ANSWERS);
    // From a rating to another rating.
    const toSecond = withRating(base, {
      ...(base.ratings[1] as NonNullable<(typeof base.ratings)[number]>),
      current: true,
    });
    expect(toSecond.ratings.map((r) => r.current)).toEqual([false, true]);
    // From a rating to a brand-only mouse.
    const toOther = withOther(base, {
      brand: "zowie",
      sizeFeel: "large",
      current: true,
    });
    expect(toOther.ratings.some((r) => r.current)).toBe(false);
    expect(toOther.otherMice[0]?.current).toBe(true);
    // From a brand-only mouse back to a rating.
    const back = withRating(toOther, {
      ...(base.ratings[0] as NonNullable<(typeof base.ratings)[number]>),
      current: true,
    });
    expect(back.otherMice.some((o) => o.current)).toBe(false);
    expect(back.ratings[0]?.current).toBe(true);
    for (const body of [toSecond, toOther, back]) {
      const count =
        body.ratings.filter((r) => r.current).length +
        body.otherMice.filter((o) => o.current).length;
      expect(count).toBe(1);
      expect(surveyEditSchema.safeParse(body).success).toBe(true);
    }
  });

  it("switching the current mouse off leaves none (a body can say that on PUT)", () => {
    const base = editBodyFrom(ANSWERS);
    const next = withRating(base, {
      ...(base.ratings[0] as NonNullable<(typeof base.ratings)[number]>),
      current: false,
    });
    expect(next.ratings.some((r) => r.current)).toBe(false);
    expect(surveyEditSchema.safeParse(next).success).toBe(true);
  });

  it("a brand-only answer is keyed by its brand: the same brand replaces, a new one is added", () => {
    const base = editBodyFrom(ANSWERS);
    const replaced = withOther(base, {
      brand: "zowie",
      sizeFeel: "small",
      current: false,
    });
    expect(replaced.otherMice).toEqual([
      { brand: "zowie", sizeFeel: "small", current: false },
    ]);
    const added = withOther(base, {
      brand: "apple",
      sizeFeel: "just_right",
      current: false,
    });
    expect(added.otherMice.map((o) => o.brand)).toEqual(["zowie", "apple"]);
  });

  it("removing a mouse sends the set without it and keeps the rest", () => {
    const base = editBodyFrom(ANSWERS);
    const next = withoutRating(base, "razer-deathadder-v3");
    expect(next.ratings.map((r) => r.slug)).toEqual([
      "logitech-g-pro-x-superlight-2",
    ]);
    expect(next.otherMice).toEqual(base.otherMice);
    expect(withoutOther(base, "zowie").otherMice).toEqual([]);
    expect(withoutOther(base, "zowie").ratings).toEqual(base.ratings);
    expect(surveyEditSchema.safeParse(next).success).toBe(true);
  });

  it("the last mouse cannot be removed here: that is DELETE /api/survey", () => {
    const one = editBodyFrom(
      mine({
        mainUse: null,
        feedback: null,
        ratings: [
          { slug: "a", satisfaction: 3, painPoints: [], current: false },
        ],
        otherMice: [],
      }),
    );
    expect(canRemoveMouse(one)).toBe(false);
    expect(surveyEditSchema.safeParse(withoutRating(one, "a")).success).toBe(
      false,
    );
    expect(canRemoveMouse(editBodyFrom(ANSWERS))).toBe(true);
  });

  it("changes the main use and the comment, and a blank comment is removed", () => {
    const base = editBodyFrom(ANSWERS);
    expect(withMainUse(base, "office").mainUse).toBe("office");
    expect(withMainUse(base, null).mainUse).toBeNull();
    expect(withFeedback(base, "  新的意見  ").feedback).toBe("新的意見");
    expect(withFeedback(base, "   ").feedback).toBeNull();
    expect(withFeedback(base, null).feedback).toBeNull();
    expect(withFeedback(base, "x").ratings).toEqual(base.ratings);
  });

  it("the cap: an account over MAX_ACCOUNT_MICE is over, one at the cap is not, and the contract agrees", () => {
    const rows = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        slug: `m${i}`,
        satisfaction: 3,
        painPoints: [],
        current: false,
      }));
    const at = editBodyFrom(
      mine({
        mainUse: null,
        feedback: null,
        ratings: rows(MAX_ACCOUNT_MICE),
        otherMice: [],
      }),
    );
    expect(miceInBody(at)).toBe(MAX_ACCOUNT_MICE);
    expect(isOverCap(at)).toBe(false);
    expect(surveyEditSchema.safeParse(at).success).toBe(true);
    const over = withRating(at, {
      slug: "one-more",
      satisfaction: 3,
      painPoints: [],
      current: false,
    });
    expect(isOverCap(over)).toBe(true);
    expect(surveyEditSchema.safeParse(over).success).toBe(false);
    // Taking one off brings it back under.
    expect(isOverCap(withoutRating(over, "one-more"))).toBe(false);
  });

  it("draftFromRating copies the rating into what a sheet edits", () => {
    const rating = ANSWERS.ratings[0];
    if (!rating) throw new Error("fixture");
    expect(draftFromRating(rating)).toEqual({
      slug: rating.slug,
      satisfaction: 4,
      duration: "6_to_12_months",
      painPoints: ["length"],
    });
    const second = ANSWERS.ratings[1];
    if (!second) throw new Error("fixture");
    expect(draftFromRating(second).duration).toBeNull();
  });

  it("togglePain flips one point and keeps the contract's order", () => {
    expect(togglePain([], "width", PAIN_POINTS)).toEqual(["width"]);
    expect(togglePain(["width"], "length", PAIN_POINTS)).toEqual([
      "length",
      "width",
    ]);
    expect(togglePain(["length", "width"], "length", PAIN_POINTS)).toEqual([
      "width",
    ]);
  });
});

describe("the picker's list", () => {
  const rows: CatalogueChoice[] = [
    { slug: "r2", brand: "Razer", model: "Viper V3 Pro" },
    SUPERLIGHT,
    { slug: "l2", brand: "Logitech", model: "G502 X Plus" },
    { slug: "r1", brand: "Razer", model: "DeathAdder V3" },
    { slug: "z1", brand: "Zowie", model: "S2-C" },
    { slug: "l3", brand: "Logitech", model: "MX Master 3S" },
  ];

  it("sorts by brand, then model, with numbers in order", () => {
    expect(sortChoices(rows).map((r) => r.slug)).toEqual([
      SUPERLIGHT.slug,
      "l2",
      "l3",
      "r1",
      "r2",
      "z1",
    ]);
    const numbered = sortChoices([
      { slug: "a", brand: "X", model: "M10" },
      { slug: "b", brand: "X", model: "M2" },
    ]);
    expect(numbered.map((r) => r.slug)).toEqual(["b", "a"]);
  });

  it("lists the brand with the most mice first, ties by name", () => {
    expect(brandChips(rows)).toEqual(["Logitech", "Razer", "Zowie"]);
  });

  it("matches brand or model, in any case, every word of the search", () => {
    const slugs = (query: string, brand: string | null = null) =>
      filterChoices(rows, query, brand).map((r) => r.slug);
    expect(slugs("")).toHaveLength(rows.length);
    expect(slugs("RAZER")).toEqual(["r2", "r1"]);
    expect(slugs("deathadder")).toEqual(["r1"]);
    expect(slugs("logitech pro")).toEqual([SUPERLIGHT.slug]);
    expect(slugs("  v3  ")).toEqual(["r2", "r1"]);
    expect(slugs("nothing like this")).toEqual([]);
    expect(slugs("v3", "Razer")).toEqual(["r2", "r1"]);
    expect(slugs("v3", "Zowie")).toEqual([]);
    expect(slugs("", "Zowie")).toEqual(["z1"]);
  });
});

describe("what a failed call says", () => {
  it("every failure has its own sentence, in both languages", () => {
    const reasons = [
      "conflict",
      "not_found",
      "rate_limited",
      "unauthorized",
      "invalid",
      "invalid_feedback",
      "network",
    ] as const;
    for (const copy of [zhTW, en]) {
      const lines = reasons.map((r) => failureLine(r, copy));
      expect(new Set(lines).size).toBe(reasons.length);
      for (const line of lines) expect(line.length).toBeGreaterThan(0);
    }
  });
});
