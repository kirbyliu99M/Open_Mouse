import { describe, expect, it } from "vitest";
import {
  EXCLUSION_REASONS,
  SUBSCORES,
  fitPreferencesSchema,
  fitResponseSchema,
} from "../../src/lib/contracts/fit";

const sub = (score: number | null) => ({
  score,
  weight: 0.2,
  reason: {
    code: score === null ? "descriptor_unknown" : "length_ideal",
    params: { deltaMm: 1.5 },
  },
});
const entry = {
  rank: 1,
  mouse: {
    slug: "logitech-g-pro-x-superlight-2",
    brand: "Logitech",
    model: "G Pro X Superlight 2",
    lengthMm: 125,
    widthMm: 63.5,
    heightMm: 40,
    weightG: 60,
    size: "large",
  },
  total: 88,
  confidence: 0.7,
  subscores: Object.fromEntries(
    SUBSCORES.map((k, i) => [k, sub(i < 3 ? 90 : null)]),
  ),
};
const valid = {
  scanId: "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f",
  engineVersion: "fit-v0-provisional",
  hand: "right",
  gripStyle: { stated: null, predicted: "claw", used: "claw" },
  targets: { lengthMm: 118, gripWidthMm: 62, heightMm: 39 },
  excluded: [
    {
      slug: "logitech-lift-vertical",
      brand: "Logitech",
      model: "Lift Vertical",
      reason: "vertical_form_factor",
    },
  ],
  results: [entry],
};

describe("fitResponseSchema", () => {
  it("accepts a response with unknown descriptors as null sub-scores", () => {
    expect(fitResponseSchema.safeParse(valid).success).toBe(true);
  });

  // #62: the results page must not depend on sessionStorage to know the hand.
  it("requires the scan's hand", () => {
    const withoutHand: Record<string, unknown> = { ...valid };
    delete withoutHand.hand;
    expect(fitResponseSchema.safeParse(withoutHand).success).toBe(false);
    expect(
      fitResponseSchema.safeParse({ ...valid, hand: "both" }).success,
    ).toBe(false);
  });

  it.each(["left", "right"])("accepts a %s-hand response", (hand) => {
    expect(fitResponseSchema.safeParse({ ...valid, hand }).success).toBe(true);
  });

  // Pinned literally: iterating EXCLUSION_REASONS alone would shrink with the
  // list instead of failing when a reason is dropped.
  it("lists exactly the contract's exclusion reasons", () => {
    expect(EXCLUSION_REASONS).toEqual([
      "wrong_hand",
      "vertical_form_factor",
      "trackball_form_factor",
    ]);
  });

  it.each(EXCLUSION_REASONS)("accepts the %s exclusion reason", (reason) => {
    const excluded = [{ ...valid.excluded[0], reason }];
    expect(fitResponseSchema.safeParse({ ...valid, excluded }).success).toBe(
      true,
    );
  });

  it("lets a wrong_hand exclusion carry a whole 0-100 total, and leaves it optional", () => {
    const leftOnly = { ...valid.excluded[0], reason: "wrong_hand" };
    for (const total of [0, 64, 100, undefined]) {
      const excluded = [{ ...leftOnly, total }];
      expect(fitResponseSchema.safeParse({ ...valid, excluded }).success).toBe(
        true,
      );
    }
    for (const total of [-1, 101, 64.5, Number.NaN]) {
      const excluded = [{ ...leftOnly, total }];
      expect(fitResponseSchema.safeParse({ ...valid, excluded }).success).toBe(
        false,
      );
    }
  });

  it.each(["vertical_form_factor", "trackball_form_factor"] as const)(
    "never lets a %s exclusion carry a total (the size model does not score it)",
    (reason) => {
      const excluded = [{ ...valid.excluded[0], reason, total: 70 }];
      const parsed = fitResponseSchema.safeParse({ ...valid, excluded });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.path).toEqual(["excluded", 0, "total"]);
    },
  );

  it.each(["vertical_form_factor", "trackball_form_factor"] as const)(
    "refuses a %s total of 0 too, and points at the right entry in a longer list",
    (reason) => {
      const leftOnly = { ...valid.excluded[0], reason: "wrong_hand", total: 70 };
      const excluded = [leftOnly, { ...valid.excluded[0], reason, total: 0 }];
      const parsed = fitResponseSchema.safeParse({ ...valid, excluded });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((i) => i.path)).toEqual([
        ["excluded", 1, "total"],
      ]);
    },
  );

  it("still refuses an unknown field on an exclusion (strict) after the refine", () => {
    const excluded = [
      { ...valid.excluded[0], reason: "wrong_hand", total: 70, rank: 3 },
    ];
    expect(fitResponseSchema.safeParse({ ...valid, excluded }).success).toBe(
      false,
    );
  });

  it("rejects an exclusion reason outside the contract", () => {
    const excluded = [{ ...valid.excluded[0], reason: "too_heavy" }];
    expect(fitResponseSchema.safeParse({ ...valid, excluded }).success).toBe(
      false,
    );
  });

  it.each([
    ["a score above 100", { ...entry, total: 101 }],
    [
      "a missing sub-score",
      { ...entry, subscores: { ...entry.subscores, thumb: undefined } },
    ],
    [
      "an unknown reason code",
      {
        ...entry,
        subscores: {
          ...entry.subscores,
          length: { ...sub(80), reason: { code: "vibes", params: {} } },
        },
      },
    ],
    [
      "a non-numeric reason param",
      {
        ...entry,
        subscores: {
          ...entry.subscores,
          length: {
            ...sub(80),
            reason: { code: "length_ideal", params: { deltaMm: "1.5" } },
          },
        },
      },
    ],
    [
      "an extra field (strict)",
      { ...entry, narrative: "Gemini text does not belong here" },
    ],
  ])("rejects %s", (_, bad) => {
    expect(
      fitResponseSchema.safeParse({ ...valid, results: [bad] }).success,
    ).toBe(false);
  });
});

describe("fitPreferencesSchema", () => {
  it("defaults includeVertical to false and rejects an inverted weight range", () => {
    expect(fitPreferencesSchema.parse({}).includeVertical).toBe(false);
    expect(
      fitPreferencesSchema.safeParse({ weightG: { min: 90, max: 60 } }).success,
    ).toBe(false);
  });
});
