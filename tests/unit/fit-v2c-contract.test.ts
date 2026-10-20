/**
 * fit-v2.0 candidate, build spec rev2 §4 T9: the contract. v0 and v1 engine
 * output still parses and never carries the new keys; v2 output (with
 * coverage and rank stability) parses; malformed new fields are refused.
 */
import { describe, expect, it } from "vitest";
import {
  GRIP_STYLES,
  fitResponseSchema,
  type FitPreferences,
  type FitResponse,
  type GripStyle,
} from "../../src/lib/contracts/fit";
import type { HandMeasurements } from "../../src/lib/contracts/measurement";
import { scoreWithEngine } from "../../src/server/fit/engine";
import { attachRankStability } from "../../src/server/fit/rank-stability-candidate";
import { scoreFitV2 } from "../../src/server/fit/score-v2-candidate";
import { groupShells } from "../../src/server/fit/shell-groups";
import { hand, seedCatalogue, seedPriors } from "./fit-v2c-fixtures";

const SCAN_ID = "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f";
const HANDS: HandMeasurements[] = [
  hand(150.3, 58.2),
  hand(185.47, 71.9, 0.58),
  hand(250, 87.5, 0.6),
];
const GRIPS: (GripStyle | undefined)[] = [undefined, ...GRIP_STYLES];

const parse = (r: Omit<FitResponse, "scanId">) =>
  fitResponseSchema.safeParse({ scanId: SCAN_ID, ...r });

describe("T9: v0 and v1 output", () => {
  it.each(["v0", "v1"] as const)(
    "%s: parses, and carries neither coverage nor rankStability",
    (engine) => {
      for (const m of HANDS) {
        for (const g of GRIPS) {
          for (const side of ["right", "left"] as const) {
            const prefs: FitPreferences = {
              includeVertical: false,
              ...(g ? { gripStyle: g } : {}),
            };
            const out = scoreWithEngine(engine, m, seedCatalogue, prefs, side);
            expect(parse(out).success).toBe(true);
            expect(out).not.toHaveProperty("coverage");
            expect(out.results.some((e) => "rankStability" in e)).toBe(false);
          }
        }
      }
    },
  );
});

describe("T9: v2 output", () => {
  const prefs: FitPreferences = { includeVertical: false, gripStyle: "palm" };
  const m = hand(250, 87.5);
  const base = scoreFitV2(m, seedCatalogue, prefs, "right", seedPriors);
  const rich = attachRankStability(base, {
    measurements: m,
    catalogue: seedCatalogue,
    prefs,
    hand: "right",
    priors: seedPriors,
  });

  it("parses with coverage, with rank stability, and once grouped into cards", () => {
    expect(base.coverage?.lengthOutOfRange).toBe(true);
    expect(parse(base).success).toBe(true);
    expect(parse(rich).success).toBe(true);
    const cards = groupShells(rich.results, seedCatalogue);
    expect(cards.filter((c) => c.rankStability !== undefined)).toHaveLength(10);
    expect(parse({ ...rich, results: cards }).success).toBe(true);
  });

  it("parses for every hand and grip, in range or not", () => {
    for (const hm of HANDS) {
      for (const g of GRIPS) {
        const p: FitPreferences = {
          includeVertical: false,
          ...(g ? { gripStyle: g } : {}),
        };
        const out = scoreFitV2(hm, seedCatalogue, p, "left", seedPriors);
        expect(out.coverage).toBeDefined();
        expect(parse(out).success).toBe(true);
      }
    }
  });

  it("refuses malformed new fields", () => {
    const c = base.coverage!;
    const badCoverage: unknown[] = [
      {
        ...c,
        catalogueLengthRangeMm: [
          c.catalogueLengthRangeMm[1],
          c.catalogueLengthRangeMm[0],
        ],
      },
      { ...c, lengthOutOfRange: false }, // direction "above" without it
      { ...c, usedGripLengthTargetMm: Number.NaN },
      { ...c, usedGripLengthTargetMm: Number.POSITIVE_INFINITY },
      { ...c, catalogueLengthRangeMm: [70.4, Number.POSITIVE_INFINITY] },
      { ...c, share: 0.3 },
      { ...c, direction: "sideways" },
    ];
    for (const coverage of badCoverage) {
      expect(
        fitResponseSchema.safeParse({ scanId: SCAN_ID, ...base, coverage })
          .success,
      ).toBe(false);
    }
    for (const rankStability of [-0.005, 1.005, Number.NaN]) {
      const results = rich.results.map((e, i) =>
        i === 0 ? { ...e, rankStability } : e,
      );
      expect(
        fitResponseSchema.safeParse({ scanId: SCAN_ID, ...rich, results })
          .success,
      ).toBe(false);
    }
  });
});
