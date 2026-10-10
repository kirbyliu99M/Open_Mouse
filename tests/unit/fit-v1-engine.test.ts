import { describe, expect, it } from "vitest";
import seedRows from "../../src/db/seed/logitech.json";
import factsJson from "../../src/db/seed/logitech-facts.json";
import type { FitEntry } from "../../src/lib/contracts/fit";
import type { HandMeasurements } from "../../src/lib/contracts/measurement";
import {
  DEFAULT_ENGINE,
  ENGINE_VERSION,
  ENGINE_VERSION_V1,
  UNKNOWN_PRIOR_SCORE,
} from "../../src/server/fit/coefficients";
import {
  scoreFitDefault,
  scoreWithEngine,
  storedNullScore,
} from "../../src/server/fit/engine";
import { computePriors } from "../../src/server/fit/priors";
import { buildFitResultRows } from "../../src/server/fit/rows";
import { scoreFit } from "../../src/server/fit/score";
import { scoreFitV1 } from "../../src/server/fit/score-v1";
import { buildSeedCatalogue } from "../../src/server/fit/seed-catalogue";
import { buildStabilityReport } from "../../src/server/fit/stability-report";
import type { CatalogueMouse } from "../../src/server/fit/types";
import golden from "./fixtures/fit-golden.json";

const seed = buildSeedCatalogue(
  seedRows as Parameters<typeof buildSeedCatalogue>[0],
  factsJson as Parameters<typeof buildSeedCatalogue>[1],
);
const hand: HandMeasurements = {
  handLengthMm: 185,
  palmLengthMm: 104,
  palmWidthMm: 76,
};
const prefs = { includeVertical: false } as const;

const classified = (patch: Partial<CatalogueMouse>): CatalogueMouse => ({
  slug: "acme-alpha",
  brand: "Acme",
  model: "Alpha",
  lengthMm: 118,
  widthMm: 66,
  heightMm: 38,
  weightG: 80,
  size: "medium",
  handCompatibility: null,
  shape: null,
  humpPlacement: null,
  frontFlare: null,
  sideCurvature: null,
  thumbRest: null,
  ringFingerRest: null,
  ...patch,
});

describe("scoreWithEngine", () => {
  it("v1 runs the candidate engine and reports its version", () => {
    const out = scoreWithEngine("v1", hand, seed, prefs, "right");
    expect(out.engineVersion).toBe(ENGINE_VERSION_V1);
    expect(out).toEqual(
      scoreFitV1(hand, seed, prefs, "right", computePriors(seed)),
    );
    expect(out.gripStyle.weights).toBeDefined();
    expect(out.handType).toBeDefined();
  });

  it("v0 runs scoreFit untouched", () => {
    const out = scoreWithEngine("v0", hand, seed, prefs, "right");
    expect(out.engineVersion).toBe(ENGINE_VERSION);
    expect(out).toEqual(scoreFit(hand, seed, prefs, "right"));
  });

  it("v1 computes its priors from the catalogue it is given", () => {
    const cat = [
      classified({ frontFlare: "outward_slight", thumbRest: true }),
      classified({
        slug: "b",
        model: "B",
        frontFlare: "flat",
        thumbRest: false,
        ringFingerRest: null,
      }),
      classified({ slug: "c", model: "C" }),
    ];
    const withPriors = scoreWithEngine(
      "v1",
      hand,
      cat,
      { ...prefs, gripStyle: "claw" },
      "right",
    );
    const c = withPriors.results.find((e) => e.mouse.slug === "c")!;
    const manual = scoreFitV1(
      hand,
      cat,
      { ...prefs, gripStyle: "claw" },
      "right",
      computePriors(cat),
    ).results.find((e) => e.mouse.slug === "c")!;
    expect(c.total).toBe(manual.total);
  });

  it("scoreFitDefault follows DEFAULT_ENGINE, which is v1", () => {
    expect(DEFAULT_ENGINE).toBe("v1");
    expect(scoreFitDefault(hand, seed, prefs, "right")).toEqual(
      scoreWithEngine(DEFAULT_ENGINE, hand, seed, prefs, "right"),
    );
    const out = scoreFitDefault(hand, seed, prefs, "right");
    expect(out.engineVersion).toBe("fit-v1-candidate.2");
    expect(out.handType).toBeDefined();
    expect(
      scoreWithEngine("v0", hand, seed, prefs, "right").engineVersion,
    ).toBe(ENGINE_VERSION);
  });
});

describe("storedNullScore", () => {
  const cat = [
    classified({ frontFlare: "outward_slight", thumbRest: true }),
    classified({ slug: "b", model: "B", frontFlare: "flat", thumbRest: false }),
  ];

  it("v0 stores the fixed prior for every sub-score and grip", () => {
    const f = storedNullScore("v0", cat);
    for (const sub of ["frontFlare", "thumb", "length"] as const) {
      for (const grip of ["palm", "claw", "fingertip"] as const) {
        expect(f(sub, grip)).toBe(UNKNOWN_PRIOR_SCORE);
      }
    }
  });

  it("v1 stores the catalogue-mean prior of the grip", () => {
    const f = storedNullScore("v1", cat);
    // claw: outward_slight 100, flat 80 → 90; thumb claw: 65, 85 → 75; palm thumb: 100, 75 → 87.5.
    expect(f("frontFlare", "claw")).toBe(90);
    expect(f("thumb", "claw")).toBe(75);
    expect(f("thumb", "palm")).toBe(87.5);
    expect(f("length", "claw")).toBe(UNKNOWN_PRIOR_SCORE);
  });
});

describe("buildFitResultRows with a stored-null policy", () => {
  const entry = (): FitEntry => {
    const out = scoreWithEngine(
      "v1",
      hand,
      [classified({})],
      { ...prefs, gripStyle: "claw" },
      "right",
    );
    return out.results[0];
  };
  const ids = new Map([["acme-alpha", "id-1"]]);

  it("the default keeps v0's behaviour: null sub-scores are stored as 75", () => {
    const e = entry();
    expect(e.subscores.frontFlare.score).toBeNull();
    const [row] = buildFitResultRows("s", "fit-v0-provisional", [e], ids);
    expect(row.frontFlareScore).toBe(75);
    expect(row.thumbScore).toBe(75);
    expect(row.weightScore).toBe(75);
  });

  it("a v1 caller stores the prior its total used, rounded for the smallint column", () => {
    const e = entry();
    const f = storedNullScore("v1", [
      classified({ frontFlare: "outward_slight", thumbRest: true }),
      classified({ frontFlare: "flat", thumbRest: false }),
    ]);
    // Palm thumb prior is 87.5; use palm to get a half-point to round.
    const [row] = buildFitResultRows("s", ENGINE_VERSION_V1, [e], ids, (sub) =>
      f(sub, "palm"),
    );
    expect(row.frontFlareScore).toBe(80); // palm flare: 80 and 80
    expect(row.thumbScore).toBe(88); // 87.5 rounded
    expect(row.weightScore).toBe(75);
    // Scores that exist are never replaced.
    expect(row.lengthScore).toBe(e.subscores.length.score);
    // The null itself survives in `reasons`.
    expect(row.reasons.thumb.score).toBeNull();
  });
});

describe("buildStabilityReport", () => {
  const hands = {
    left_handed: (
      golden as unknown as Record<
        string,
        { hand: "left" | "right"; measurements: HandMeasurements }
      >
    ).left_handed,
  };

  it("is a pure function of its input: two calls give the same string", () => {
    const a = buildStabilityReport(seed, hands);
    const b = buildStabilityReport(seed, hands);
    expect(a).toBe(b);
  });

  it("has the perturbation table and the sweep, for both engines", () => {
    const report = buildStabilityReport(seed, hands);
    expect(report.startsWith("# Fit stability report\n")).toBe(true);
    for (const label of [
      "hand length ±5 mm",
      "hand length ±8 mm",
      "palm length ±3 mm",
      "palm width ±3 mm",
    ]) {
      expect(report).toContain(`| left_handed | ${label} |`);
      expect(report).toContain(`**${label}**`);
    }
    expect(report).toContain("## Palm-length sweep (continuity)");
    expect(report).toMatch(
      /Largest jump over all hands: v0 = \d+ points, v1 = \d+ points\./,
    );
    expect(report.endsWith("\n")).toBe(true);
  });

  it("reports v1 continuous (<= 2) and v0 not", () => {
    const report = buildStabilityReport(seed, hands);
    const m = report.match(
      /Largest jump over all hands: v0 = (\d+) points, v1 = (\d+) points\./,
    )!;
    expect(Number(m[2])).toBeLessThanOrEqual(2);
    expect(Number(m[1])).toBeGreaterThan(2);
  });
});
