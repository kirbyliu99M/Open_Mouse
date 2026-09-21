import { describe, expect, it } from "vitest";
import {
  FRONT_FLARES,
  HUMP_PLACEMENTS,
  flareDirection,
  humpIsBack,
} from "../../src/lib/contracts/descriptors";
import { agreement } from "../../src/server/catalogue/agreement";
import { checkConsistency } from "../../src/server/catalogue/consistency";
import { parseCsv, toSlug } from "../../src/server/catalogue/csv";
import { computeSize, sizeScore } from "../../src/server/catalogue/size";

describe("computeSize", () => {
  it.each([
    // [length, width, height, expected] — boundaries from docs/shape-rubric.md §1
    [104, 60, 39.5, "fingertip"], // exactly at both fingertip limits (0.3798)
    [104, 60, 40, "small"], //       deck too tall for fingertip (0.3846)
    [104.1, 60, 30, "small"], //     just past fingertip length
    [116.9, 64, 38, "small"],
    [117, 64, 38, "medium"], //      smallBelow is exclusive
    [124, 64, 38, "medium"], //      mediumUpTo is inclusive
    [124.1, 64, 38, "large"],
    [120, 75, 40, "large"], //       width pushes it over: 120 + 0.4*11 = 124.4
    [126, 55, 40, "medium"], //      narrowness pulls it back: 126 - 3.6 = 122.4
  ] as const)("L%s W%s H%s → %s", (lengthMm, widthMm, heightMm, expected) => {
    expect(computeSize({ lengthMm, widthMm, heightMm })).toBe(expected);
  });

  it("weights width at 0.4 around a 64 mm pivot", () => {
    expect(sizeScore(120, 64)).toBe(120);
    expect(sizeScore(120, 74)).toBeCloseTo(124);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects non-positive or non-finite dimensions (%s)",
    (bad) => {
      expect(() =>
        computeSize({ lengthMm: bad, widthMm: 60, heightMm: 38 }),
      ).toThrow(RangeError);
    },
  );
});

describe("checkConsistency", () => {
  const base = {
    shape: "symmetrical",
    handCompatibility: "right",
    thumbRest: false,
    ringFingerRest: false,
  } as const;

  it("accepts a valid symmetrical and a valid ergonomic mouse", () => {
    expect(checkConsistency(base)).toEqual([]);
    expect(
      checkConsistency({
        ...base,
        shape: "ergonomic",
        thumbRest: true,
        ringFingerRest: true,
      }),
    ).toEqual([]);
  });

  it.each([
    [
      { handCompatibility: "ambidextrous", shape: "ergonomic" },
      "ambidextrous_is_symmetrical",
    ],
    [
      { handCompatibility: "ambidextrous", shape: "hybrid" },
      "ambidextrous_is_symmetrical",
    ],
    [{ thumbRest: true }, "thumb_rest_is_ergonomic"],
    [{ ringFingerRest: true, shape: "hybrid" }, "ring_rest_is_ergonomic"],
  ] as const)("flags %o as %s", (patch, rule) => {
    expect(checkConsistency({ ...base, ...patch }).map((v) => v.rule)).toEqual([
      rule,
    ]);
  });

  it("treats unknown values as unknown, not as contradictions", () => {
    expect(
      checkConsistency({
        shape: null,
        handCompatibility: "ambidextrous",
        thumbRest: true,
        ringFingerRest: null,
      }),
    ).toEqual([]);
  });
});

describe("agreement", () => {
  it("scores exact, within-one and coarse agreement with a confusion matrix", () => {
    const result = agreement(
      [
        { predicted: "flat", actual: "flat" },
        { predicted: "outward_slight", actual: "outward_moderate" }, // adjacent, same direction
        { predicted: "inward_slight", actual: "flat" }, //              adjacent, different direction
        { predicted: "outward_aggressive", actual: "inward_slight" }, // far miss
      ],
      FRONT_FLARES,
      flareDirection,
    );
    expect(result.n).toBe(4);
    expect(result.exact).toBe(0.25);
    expect(result.withinOne).toBe(0.75);
    expect(result.coarse).toBe(0.5);
    expect(result.confusion.flat).toEqual({ flat: 1, inward_slight: 1 });
  });

  it("supports a boolean coarse split such as hump Center-vs-Back", () => {
    const result = agreement(
      [
        { predicted: "back_minimal", actual: "back_aggressive" },
        { predicted: "center", actual: "back_minimal" },
      ],
      HUMP_PLACEMENTS,
      humpIsBack,
    );
    expect(result.coarse).toBe(0.5);
    expect(result.withinOne).toBe(0.5);
  });

  it("returns zero rates rather than NaN for no data", () => {
    expect(agreement([], FRONT_FLARES).exact).toBe(0);
  });

  it("rejects a level that is not on the scale", () => {
    expect(() =>
      agreement(
        [{ predicted: "sideways", actual: "flat" }],
        ["flat", "sideways-not"],
      ),
    ).toThrow(RangeError);
  });
});

describe("parseCsv", () => {
  it("handles quoted fields with embedded newlines, commas and escaped quotes", () => {
    const text =
      'Name,Brand,Note\r\n"Mouse\nOne",Acme,"a, ""b"""\n"Two",Acme,\n';
    expect(parseCsv(text)).toEqual([
      { Name: "Mouse\nOne", Brand: "Acme", Note: 'a, "b"' },
      { Name: "Two", Brand: "Acme", Note: "" },
    ]);
  });

  it("returns no records for an empty file", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("toSlug", () => {
  it.each([
    ["Back - minimal", "back_minimal"],
    ["Outward – slight", "outward_slight"],
    ["Inward", "inward"],
    ["Center", "center"],
  ])("%s → %s", (label, slug) => expect(toSlug(label)).toBe(slug));
});
