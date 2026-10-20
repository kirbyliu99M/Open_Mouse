import { afterEach, describe, expect, it, vi } from "vitest";
import seedRows from "../../src/db/seed/logitech.json";
import factsJson from "../../src/db/seed/logitech-facts.json";
import type { HandMeasurements } from "../../src/lib/contracts/measurement";
import {
  DEFAULT_ENGINE,
  ENGINE_VERSION,
  ENGINE_VERSION_V1,
} from "../../src/server/fit/coefficients";
import {
  resolveFitEngine,
  scoreFitDefault,
  scoreWithEngine,
} from "../../src/server/fit/engine";
import { computePriors } from "../../src/server/fit/priors";
import { scoreFit } from "../../src/server/fit/score";
import { scoreFitV1 } from "../../src/server/fit/score-v1";
import { buildSeedCatalogue } from "../../src/server/fit/seed-catalogue";
import { buildStabilityReport } from "../../src/server/fit/stability-report";
import type { CatalogueMouse } from "../../src/server/fit/types";
import golden from "./fixtures/fit-golden.json";

afterEach(() => {
  vi.unstubAllEnvs();
});

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

  it("scoreFitDefault follows FIT_ENGINE, which is v1 when unset", () => {
    // These numbers are v1's: pin the variable off, whatever the runner set.
    vi.stubEnv("FIT_ENGINE", "");
    expect(DEFAULT_ENGINE).toBe("v1");
    expect(resolveFitEngine()).toBe("v1");
    expect(scoreFitDefault(hand, seed, prefs, "right")).toEqual(
      scoreWithEngine("v1", hand, seed, prefs, "right"),
    );
    const out = scoreFitDefault(hand, seed, prefs, "right");
    expect(out.engineVersion).toBe("fit-v1-candidate.3");
    expect(out.handType).toBeDefined();
    expect(
      scoreWithEngine("v0", hand, seed, prefs, "right").engineVersion,
    ).toBe(ENGINE_VERSION);
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
