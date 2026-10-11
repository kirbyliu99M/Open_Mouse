import { describe, expect, it } from "vitest";
import {
  MAX_ACCOUNT_MICE,
  MAX_FEEDBACK_CHARS,
  surveyEditResponseSchema,
  surveyEditSchema,
  surveyMineResponseSchema,
  SURVEY_CONSENT_VERSION,
} from "../../src/lib/contracts/survey";

const accepts =
  (schema: { safeParse: (v: unknown) => { success: boolean } }) =>
  (v: unknown) =>
    schema.safeParse(v).success;
const edit = accepts(surveyEditSchema);
const mine = accepts(surveyMineResponseSchema);

const rating = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  satisfaction: 4,
  painPoints: [],
  current: false,
  ...extra,
});
const other = (brand: string, extra: Record<string, unknown> = {}) => ({
  brand,
  sizeFeel: "just_right",
  current: false,
  ...extra,
});
const body = { ratings: [rating("logitech-ergo-m575")] };
const many = (n: number) =>
  Array.from({ length: n }, (_, i) => rating(`mouse-${i}`));

describe("pinned numbers (candidate, 未拍板)", () => {
  it("keeps the account cap", () => {
    // Literal on purpose: a test built from the constant passes for any value.
    expect(MAX_ACCOUNT_MICE).toBe(30);
  });
});

describe("surveyEditSchema", () => {
  it("accepts ratings alone, other mice alone, and both", () => {
    expect(edit(body)).toBe(true);
    expect(edit({ otherMice: [other("razer")] })).toBe(true);
    expect(edit({ ...body, otherMice: [other("razer")] })).toBe(true);
  });

  it("takes main use and the comment as optional", () => {
    expect(edit({ ...body, mainUse: "gaming", feedback: "Too light." })).toBe(
      true,
    );
    expect(edit({ ...body, mainUse: "everything" })).toBe(false);
  });

  it("refuses a body that names no mouse (taking all back is DELETE)", () => {
    expect(edit({})).toBe(false);
    expect(edit({ ratings: [], otherMice: [] })).toBe(false);
    expect(edit({ mainUse: "office" })).toBe(false);
  });

  it("is not a submission: no scan, no consent, no grip", () => {
    expect(
      edit({ ...body, scanId: "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f" }),
    ).toBe(false);
    expect(
      edit({
        ...body,
        consent: { accepted: true, version: SURVEY_CONSENT_VERSION },
      }),
    ).toBe(false);
    expect(edit({ ...body, gripStyle: "claw" })).toBe(false);
    expect(edit({ ...body, extra: 1 })).toBe(false);
  });

  it("lets a body say that no mouse is the current one", () => {
    expect(edit({ ratings: [rating("a"), rating("b")] })).toBe(true);
  });

  it("allows at most one current mouse across ratings and other mice", () => {
    expect(
      edit({ ratings: [rating("a", { current: true }), rating("b")] }),
    ).toBe(true);
    expect(
      edit({
        ratings: [rating("a", { current: true })],
        otherMice: [other("razer", { current: true })],
      }),
    ).toBe(false);
    expect(
      edit({
        ratings: [
          rating("a", { current: true }),
          rating("b", { current: true }),
        ],
      }),
    ).toBe(false);
  });

  it("rates a mouse once and answers a brand once", () => {
    expect(edit({ ratings: [rating("a"), rating("a")] })).toBe(false);
    expect(edit({ otherMice: [other("razer"), other("razer")] })).toBe(false);
    expect(edit({ otherMice: [other("razer"), other("corsair")] })).toBe(true);
  });

  it("refuses a brand outside the list and a size feel outside the scale", () => {
    expect(edit({ otherMice: [other("acme")] })).toBe(false);
    expect(edit({ otherMice: [other("razer", { sizeFeel: "huge" })] })).toBe(
      false,
    );
  });

  it("caps the mice on an account, ratings and other mice together", () => {
    expect(edit({ ratings: many(MAX_ACCOUNT_MICE) })).toBe(true);
    expect(edit({ ratings: many(MAX_ACCOUNT_MICE + 1) })).toBe(false);
    expect(
      edit({
        ratings: many(MAX_ACCOUNT_MICE),
        otherMice: [other("razer")],
      }),
    ).toBe(false);
    expect(
      edit({
        ratings: many(MAX_ACCOUNT_MICE - 1),
        otherMice: [other("razer")],
      }),
    ).toBe(true);
  });

  it("holds the comment to the same rules as a submission", () => {
    expect(edit({ ...body, feedback: "x".repeat(MAX_FEEDBACK_CHARS) })).toBe(
      true,
    );
    expect(
      edit({ ...body, feedback: "x".repeat(MAX_FEEDBACK_CHARS + 1) }),
    ).toBe(false);
    expect(edit({ ...body, feedback: "   " })).toBe(false);
    expect(edit({ ...body, feedback: "write me at a@b.co" })).toBe(false);
    expect(edit({ ...body, feedback: "bad\u0000text" })).toBe(false);
  });

  it("applies the rating rules of a submission", () => {
    expect(edit({ ratings: [rating("a", { satisfaction: 6 })] })).toBe(false);
    expect(edit({ ratings: [rating("a", { satisfaction: 0 })] })).toBe(false);
    expect(
      edit({ ratings: [rating("a", { painPoints: ["length", "length"] })] }),
    ).toBe(false);
    expect(edit({ ratings: [rating("a", { duration: "forever" })] })).toBe(
      false,
    );
  });

  it("defaults the lists, so a body of other mice alone parses", () => {
    const parsed = surveyEditSchema.parse({ otherMice: [other("razer")] });
    expect(parsed.ratings).toEqual([]);
  });
});

describe("surveyMineResponseSchema", () => {
  const empty = { mainUse: null, ratings: [], otherMice: [], feedback: null };

  it("accepts an account with nothing kept, with nulls and empty lists", () => {
    expect(mine(empty)).toBe(true);
  });

  it("accepts what an edit can store, read back", () => {
    expect(
      mine({
        mainUse: "mixed",
        ratings: [rating("a", { current: true })],
        otherMice: [other("razer")],
        feedback: "Fine.",
      }),
    ).toBe(true);
  });

  it("carries no hand profile, grip, consent record or id", () => {
    for (const extra of [
      { handLengthBinMm: 185 },
      { gripStyle: "claw" },
      { consentedAt: "2026-10-11" },
      { userId: "u1" },
    ]) {
      expect(mine({ ...empty, ...extra })).toBe(false);
    }
  });

  it("is not satisfied by a missing field", () => {
    for (const field of Object.keys(empty)) {
      const missing: Record<string, unknown> = { ...empty };
      delete missing[field];
      expect(mine(missing)).toBe(false);
    }
  });
});

describe("surveyEditResponseSchema", () => {
  it("says only that the edit was stored", () => {
    expect(accepts(surveyEditResponseSchema)({ stored: true })).toBe(true);
    expect(accepts(surveyEditResponseSchema)({ stored: false })).toBe(false);
    expect(
      accepts(surveyEditResponseSchema)({ stored: true, withdrawable: true }),
    ).toBe(false);
  });
});

describe("surveyEditSchema takes back what the read-back answer says", () => {
  it("accepts null for main use and the comment, as a way to clear them", () => {
    expect(edit({ ...body, mainUse: null, feedback: null })).toBe(true);
    const parsed = surveyEditSchema.parse({ ...body, mainUse: null });
    expect(parsed.mainUse ?? undefined).toBeUndefined();
  });

  it("round-trips an account with nothing kept for those two fields", () => {
    const readBack = {
      mainUse: null,
      ratings: [rating("a")],
      otherMice: [],
      feedback: null,
    };
    expect(mine(readBack)).toBe(true);
    expect(edit(readBack)).toBe(true);
  });

  it("still refuses a main use outside the list and an empty comment", () => {
    expect(edit({ ...body, mainUse: "everything" })).toBe(false);
    expect(edit({ ...body, feedback: "  " })).toBe(false);
  });
});
