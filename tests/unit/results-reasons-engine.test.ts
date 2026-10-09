import { describe, expect, it } from "vitest";
import { reasonText } from "../../src/components/results/reasons";
import highConfidence from "../../src/components/results/fixtures/high-confidence.json";
import lowConfidence from "../../src/components/results/fixtures/low-confidence.json";
import withExclusions from "../../src/components/results/fixtures/with-exclusions.json";
import {
  FRONT_FLARES,
  HUMP_PLACEMENTS,
} from "../../src/lib/contracts/descriptors";
import type {
  GripStyle,
  ReasonCode,
  Subscore,
} from "../../src/lib/contracts/fit";
import { GRIP_STYLES, SUBSCORES } from "../../src/lib/contracts/fit";
import type { HandMeasurements } from "../../src/lib/contracts/measurement";
import { scoreFit } from "../../src/server/fit/score";
import { scoreWeight } from "../../src/server/fit/subscores";
import type { CatalogueMouse } from "../../src/server/fit/types";

/**
 * The results page renders a sentence from the `params` the fit engine really
 * emits. A template that reads a key the engine never sets silently falls back
 * to its generic sentence (`weight_in_range` read `deltaG` while the engine
 * sends `{ minG, maxG }`, and its fixtures were written to match the template,
 * not the engine). These tests render the templates with params produced by
 * the engine itself.
 */

function mouse(overrides: Partial<CatalogueMouse> = {}): CatalogueMouse {
  return {
    slug: "acme-test",
    brand: "Acme",
    model: "Test",
    lengthMm: 118,
    widthMm: 64,
    heightMm: 38,
    weightG: 75,
    size: "medium",
    handCompatibility: "right",
    shape: "symmetrical",
    humpPlacement: "back_moderate",
    frontFlare: "outward_slight",
    sideCurvature: "flat",
    thumbRest: true,
    ringFingerRest: null,
    ...overrides,
  };
}

describe("weight reasons rendered from the engine's own params", () => {
  const prefs = { includeVertical: false, weightG: { min: 60, max: 90 } };

  it("weight_in_range states the preferred range the engine sent", () => {
    const { reason } = scoreWeight(mouse({ weightG: 75 }), prefs);
    expect(reason.code).toBe("weight_in_range");
    expect(reasonText(reason.code, reason.params)).toBe(
      "Weight is within your preferred range (60–90\u00A0g).",
    );
  });

  it("weight_in_range never claims a gap: it is inside the range by definition", () => {
    for (const weightG of [60, 75, 90]) {
      const { reason } = scoreWeight(mouse({ weightG }), prefs);
      expect(reasonText(reason.code, reason.params)).not.toMatch(
        /within \d+ g of/,
      );
    }
  });

  it("weight_heavier and weight_lighter state the gap from the range", () => {
    const heavy = scoreWeight(mouse({ weightG: 100 }), prefs).reason;
    const light = scoreWeight(mouse({ weightG: 50 }), prefs).reason;
    expect(reasonText(heavy.code, heavy.params)).toBe(
      "This mouse is about 10\u00A0g heavier than you prefer.",
    );
    expect(reasonText(light.code, light.params)).toBe(
      "This mouse is about 10\u00A0g lighter than you prefer.",
    );
  });

  it("degrades to the plain sentence when the range is missing", () => {
    expect(reasonText("weight_in_range", {})).toBe(
      "Weight is within your preferred range.",
    );
    expect(reasonText("weight_in_range", { minG: 60 })).toBe(
      "Weight is within your preferred range.",
    );
  });
});

// A grid of mice that exercises every reason code, hands of each grip, and a
// weight preference so the weight sub-score applies.
function grid(): CatalogueMouse[] {
  const out: CatalogueMouse[] = [];
  let i = 0;
  for (const lengthMm of [100, 118, 145]) {
    for (const widthMm of [52, 64, 82]) {
      for (const heightMm of [30, 38, 52]) {
        for (const weightG of [45, 75, 120, null]) {
          out.push(
            mouse({
              slug: `acme-${i}`,
              lengthMm,
              widthMm,
              heightMm,
              weightG,
              humpPlacement:
                i % 5 === 4
                  ? null
                  : HUMP_PLACEMENTS[i % HUMP_PLACEMENTS.length]!,
              frontFlare:
                i % 7 === 6 ? null : FRONT_FLARES[i % FRONT_FLARES.length]!,
              thumbRest: [true, false, null][i % 3]!,
            }),
          );
          i++;
        }
      }
    }
  }
  return out;
}

const hand: HandMeasurements = {
  handLengthMm: 185,
  palmLengthMm: 105,
  palmWidthMm: 84,
};

/**
 * Codes whose `params` exist for the analysis input and are deliberately not
 * shown to the user (the hump sentence says nothing numeric).
 */
const PARAMS_NOT_SHOWN: ReadonlySet<ReasonCode> = new Set([
  "hump_matches_grip",
  "hump_mismatch_grip",
]);

describe("every reason the engine emits", () => {
  const emitted = new Map<
    string,
    { code: ReasonCode; params: Record<string, number> }
  >();
  for (const grip of GRIP_STYLES) {
    const result = scoreFit(
      hand,
      grid(),
      {
        includeVertical: true,
        gripStyle: grip as GripStyle,
        weightG: { min: 60, max: 90 },
      },
      "right",
    );
    for (const entry of result.results) {
      for (const key of SUBSCORES) {
        const { code, params } = entry.subscores[key as Subscore].reason;
        emitted.set(`${code}|${JSON.stringify(params)}`, { code, params });
      }
    }
  }

  it("the grid really does exercise the codes this test is about", () => {
    const codes = new Set([...emitted.values()].map((r) => r.code));
    for (const code of [
      "weight_in_range",
      "weight_heavier",
      "weight_lighter",
      "thumb_rest_missing",
      "thumb_neutral",
      "length_short",
      "width_wide",
      "height_high",
    ] as const) {
      expect(codes, code).toContain(code);
    }
  });

  it("renders a sentence that uses its params, unless the code deliberately shows none", () => {
    const ignored: string[] = [];
    for (const { code, params } of emitted.values()) {
      if (Object.keys(params).length === 0 || PARAMS_NOT_SHOWN.has(code)) {
        continue;
      }
      const withParams = reasonText(code, params);
      if (withParams === reasonText(code, {})) {
        ignored.push(`${code} ${JSON.stringify(params)}`);
      }
    }
    expect(ignored).toEqual([]);
  });

  it("never renders a broken number", () => {
    for (const { code, params } of emitted.values()) {
      expect(reasonText(code, params), code).not.toMatch(
        /NaN|undefined|Infinity|-\d/,
      );
    }
  });
});

describe("results fixtures", () => {
  it("only use param keys the engine emits for that reason code", () => {
    const engineKeys = new Map<ReasonCode, Set<string>>();
    for (const grip of GRIP_STYLES) {
      const result = scoreFit(
        hand,
        grid(),
        {
          includeVertical: true,
          gripStyle: grip as GripStyle,
          weightG: { min: 60, max: 90 },
        },
        "right",
      );
      for (const entry of result.results) {
        for (const key of SUBSCORES) {
          const { code, params } = entry.subscores[key as Subscore].reason;
          const keys = engineKeys.get(code) ?? new Set<string>();
          for (const k of Object.keys(params)) keys.add(k);
          engineKeys.set(code, keys);
        }
      }
    }

    const stray: string[] = [];
    for (const [name, fixture] of [
      ["high-confidence", highConfidence],
      ["low-confidence", lowConfidence],
      ["with-exclusions", withExclusions],
    ] as const) {
      for (const entry of fixture.results) {
        for (const sub of Object.values(entry.subscores)) {
          const code = sub.reason.code as ReasonCode;
          const allowed = engineKeys.get(code);
          if (!allowed) continue; // a code this grid never produces
          for (const k of Object.keys(sub.reason.params)) {
            if (!allowed.has(k)) stray.push(`${name}: ${code} has "${k}"`);
          }
        }
      }
    }
    expect(stray).toEqual([]);
  });
});
