import { describe, expect, it } from "vitest";
import {
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
