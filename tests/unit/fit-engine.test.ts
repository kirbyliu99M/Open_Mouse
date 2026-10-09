import { describe, expect, it } from "vitest";
import { fitResponseSchema } from "../../src/lib/contracts/fit";
import type { HandMeasurements } from "../../src/lib/contracts/measurement";
import { scoreFit } from "../../src/server/fit/score";
import type { CatalogueMouse } from "../../src/server/fit/types";

// r = 110/190 = 0.5789… → claw (0.54 ≤ r < 0.58). Targets: length 117.8,
// gripWidth 70.4, height 38.
const measurements: HandMeasurements = {
  handLengthMm: 190,
  palmLengthMm: 110,
  palmWidthMm: 80,
};

const fullyClassified: CatalogueMouse = {
  slug: "acme-alpha",
  brand: "Acme",
  model: "Alpha",
  lengthMm: 117.8,
  widthMm: 70.4,
  heightMm: 38,
  weightG: 80,
  size: "medium",
  handCompatibility: "right",
  shape: "symmetrical",
  humpPlacement: "back_moderate", // best for claw → 0 levels off
  frontFlare: "outward_slight", // claw → 100
  sideCurvature: "flat",
  thumbRest: false, // claw, no rest → 85, thumb_neutral
};

const unclassified: CatalogueMouse = {
  slug: "beta-unknown",
  brand: "Beta",
  model: "Unknown",
  lengthMm: 117.8,
  widthMm: 70.4,
  heightMm: 38,
  weightG: null,
  size: "medium",
  handCompatibility: null,
  shape: null,
  humpPlacement: null,
  frontFlare: null,
  sideCurvature: null,
  thumbRest: null,
};

describe("scoreFit aggregation", () => {
  it("computes a renormalised total and a weight-based confidence for a fully classified mouse", () => {
    const r = scoreFit(
      measurements,
      [fullyClassified],
      { includeVertical: false },
      "right",
    );
    const entry = r.results[0];
    // length 100·0.30 + gripWidth 100·0.25 + heightHump 100·0.20
    // + frontFlare 100·0.10 + thumb 85·0.10, weight sum 0.95 (weight excluded: no preference)
    expect(entry.total).toBe(Math.round((30 + 25 + 20 + 10 + 8.5) / 0.95));
    expect(entry.confidence).toBe(1); // every applicable subscore had real input
  });

  it("renormalises over all applicable subscores (null ones at the neutral prior) and still lowers confidence", () => {
    const r = scoreFit(
      measurements,
      [unclassified],
      { includeVertical: false },
      "right",
    );
    const entry = r.results[0];
    // Real inputs: length 100·0.30, gripWidth 100·0.125 (curvature null →
    // halved), heightHump 100·0.20 (height-only; Δheight=0 so its reason is
    // height_ideal, not descriptor_unknown — see scoreHeightHump).
    // frontFlare/thumb are null and now contribute UNKNOWN_PRIOR_SCORE (75)
    // at full weight instead of dropping out. weight is excluded entirely
    // (no preference given).
    // total = (100·.3 + 100·.125 + 100·.2 + 75·.1 + 75·.1) / (.3+.125+.2+.1+.1)
    //       = 77.5 / 0.825 ≈ 93.94 → 94
    expect(entry.total).toBe(94);
    // confidence numerator: length .3 + gripWidth .125 + heightHump .2
    // (real, non-descriptor_unknown) = 0.625; denominator (applicable
    // weight) = 0.825; frontFlare/thumb (descriptor_unknown) excluded from
    // the numerator despite now counting toward the total.
    expect(entry.confidence).toBeCloseTo(0.625 / 0.825, 10);
    expect(entry.subscores.frontFlare.score).toBeNull();
    expect(entry.subscores.frontFlare.reason.code).toBe("descriptor_unknown");
    expect(entry.subscores.thumb.score).toBeNull();
    expect(entry.subscores.weight.score).toBeNull();
    expect(entry.subscores.weight.reason.code).toBe("no_preference");
    // heightHump always has a real height component (mouse dimensions are
    // never unknown), so a null hump still yields a non-null score and a
    // height_* reason, never descriptor_unknown.
    expect(entry.subscores.heightHump.score).not.toBeNull();
    expect(entry.subscores.heightHump.reason.code).toBe("height_ideal");
  });

  it("a fully classified mouse now outranks a mostly-unknown one (neutral prior)", () => {
    const r = scoreFit(
      measurements,
      [unclassified, fullyClassified],
      { includeVertical: false },
      "right",
    );
    // Before the neutral prior, renormalising over fewer subscores let the
    // unclassified mouse's total (100) beat the fully classified one's (98)
    // outright. With UNKNOWN_PRIOR_SCORE, the unclassified mouse totals 94
    // and the fully classified one (98) ranks first.
    expect(
      r.results.map((e) => ({ slug: e.mouse.slug, total: e.total })),
    ).toEqual([
      { slug: "acme-alpha", total: 98 },
      { slug: "beta-unknown", total: 94 },
    ]);
  });

  it("sorts by total desc, then confidence desc, then model name asc", () => {
    const lowerTotal: CatalogueMouse = {
      ...unclassified,
      slug: "acme-gamma",
      model: "Gamma",
    };
    const tieBreakA: CatalogueMouse = {
      ...fullyClassified,
      slug: "acme-zeta",
      model: "Zeta",
    };
    const tieBreakB: CatalogueMouse = {
      ...fullyClassified,
      slug: "acme-yankee",
      model: "Yankee",
    };

    const r = scoreFit(
      measurements,
      [lowerTotal, tieBreakA, tieBreakB],
      { includeVertical: false },
      "right",
    );

    // lowerTotal (Gamma) totals 94 (see the aggregation test above) —
    // below the fully classified pair's 98, so it sorts last.
    // tieBreakA/B share total and confidence (identical inputs) — model
    // name breaks the tie: Yankee before Zeta.
    expect(r.results.map((e) => e.mouse.slug)).toEqual([
      "acme-yankee",
      "acme-zeta",
      "acme-gamma",
    ]);
    expect(r.results.map((e) => e.rank)).toEqual([1, 2, 3]);
  });

  it("excludes mice before ranking and reports why", () => {
    const wrongHand: CatalogueMouse = {
      ...fullyClassified,
      slug: "acme-lefty",
      model: "Lefty",
      handCompatibility: "left",
    };
    const vertical: CatalogueMouse = {
      ...fullyClassified,
      slug: "acme-vertical",
      model: "Vertical",
      lengthMm: 108,
      heightMm: 71, // ratio 0.657 > 0.55
    };
    const r = scoreFit(
      measurements,
      [fullyClassified, wrongHand, vertical],
      { includeVertical: false },
      "right",
    );
    expect(r.results.map((e) => e.mouse.slug)).toEqual(["acme-alpha"]);
    expect(r.excluded).toEqual(
      expect.arrayContaining([
        {
          slug: "acme-lefty",
          brand: "Acme",
          model: "Lefty",
          reason: "wrong_hand",
          // Lefty is Alpha made for the other hand: same sub-scores, same total.
          total: r.results[0]!.total,
        },
        {
          slug: "acme-vertical",
          brand: "Acme",
          model: "Vertical",
          reason: "vertical_form_factor",
        },
      ]),
    );
  });

  it("a stated grip preference overrides the predicted grip", () => {
    const predictedOnly = scoreFit(
      measurements,
      [fullyClassified],
      { includeVertical: false },
      "right",
    );
    expect(predictedOnly.gripStyle).toEqual({
      stated: null,
      predicted: "claw",
      used: "claw",
    });

    const stated = scoreFit(
      measurements,
      [fullyClassified],
      { includeVertical: false, gripStyle: "palm" },
      "right",
    );
    expect(stated.gripStyle).toEqual({
      stated: "palm",
      predicted: "claw",
      used: "palm",
    });
    // Targets recompute off the used (stated) grip, not the predicted one.
    expect(stated.targets.lengthMm).toBeCloseTo(190 * 0.66, 10);
  });

  it("produces output that parses with fitResponseSchema", () => {
    const r = scoreFit(
      measurements,
      [fullyClassified, unclassified],
      {
        includeVertical: false,
      },
      "right",
    );
    const withScanId = { ...r, scanId: "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f" };
    const parsed = fitResponseSchema.safeParse(withScanId);
    expect(parsed.success).toBe(true);
  });
});

// #62: the results page will read the hand from the fit response. A hand that
// is hard-coded or swapped here would silently treat left-handed users as
// right-handed, so pin it for both hands.
describe("scoreFit hand", () => {
  it.each(["left", "right"] as const)(
    "returns the %s hand it was given, in a schema-valid response",
    (hand) => {
      const r = scoreFit(
        measurements,
        [fullyClassified, unclassified],
        { includeVertical: false },
        hand,
      );
      expect(r.hand).toBe(hand);
      const parsed = fitResponseSchema.safeParse({
        scanId: "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f",
        ...r,
      });
      expect(parsed.success).toBe(true);
    },
  );
});
