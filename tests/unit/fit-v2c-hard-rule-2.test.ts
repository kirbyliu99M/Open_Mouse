/**
 * fit-v2.0 candidate, build spec rev2 §4 T10, hard rule 2: `coverage` and
 * `rankStability` are not part of what the analysis or the share card read.
 * The same response with and without them (each alone, both, neither; an
 * in-range and an out-of-range hand) gives deeply equal analysis input and
 * share card input, and the same set of numbers for the analysis numeral
 * allow-list. This compares whole outputs and number sets; it does not assert
 * that some value is absent (0 and 1 may be legitimately present).
 */
import { describe, expect, it } from "vitest";
import { buildShareCardInput } from "../../src/components/results/share/input";
import type { FitPreferences, FitResponse } from "../../src/lib/contracts/fit";
import type { HandMeasurements } from "../../src/lib/contracts/measurement";
import { buildAnalysisInput } from "../../src/server/analysis/input";
import { collectNumbers } from "../../src/server/analysis/numerals";
import { attachRankStability } from "../../src/server/fit/rank-stability-candidate";
import { scoreFitV2 } from "../../src/server/fit/score-v2-candidate";
import { groupShells } from "../../src/server/fit/shell-groups";
import { hand, seedCatalogue, seedPriors } from "./fit-v2c-fixtures";

const SCAN_ID = "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f";

/** A v2 response with rank stability, grouped into cards as core.ts does. */
function richResponse(m: HandMeasurements, prefs: FitPreferences): FitResponse {
  const base = scoreFitV2(m, seedCatalogue, prefs, "right", seedPriors);
  const rich = attachRankStability(base, {
    measurements: m,
    catalogue: seedCatalogue,
    prefs,
    hand: "right",
    priors: seedPriors,
  });
  return {
    scanId: SCAN_ID,
    ...rich,
    results: groupShells(rich.results, seedCatalogue),
  };
}

function strip(
  fit: FitResponse,
  keep: { coverage: boolean; rankStability: boolean },
): FitResponse {
  const { coverage, ...rest } = fit;
  return {
    ...rest,
    ...(keep.coverage && coverage ? { coverage } : {}),
    results: fit.results.map((e) => {
      if (keep.rankStability) return e;
      const { rankStability: _s, ...plain } = e;
      void _s;
      return plain;
    }),
  };
}

const CASES: [string, HandMeasurements, FitPreferences][] = [
  [
    "out of range, palm",
    hand(250, 87.5),
    { includeVertical: false, gripStyle: "palm" },
  ],
  [
    "in range, no grip stated",
    hand(183.37, 70.21, 0.57),
    { includeVertical: false },
  ],
];

describe.each(CASES)("T10 (%s)", (_n, m, prefs) => {
  const rich = richResponse(m, prefs);
  const plain = strip(rich, { coverage: false, rankStability: false });
  const variants: [string, FitResponse][] = [
    ["both", rich],
    ["coverage only", strip(rich, { coverage: true, rankStability: false })],
    [
      "rankStability only",
      strip(rich, { coverage: false, rankStability: true }),
    ],
    ["neither", plain],
  ];

  it("the fixture really carries the fields", () => {
    expect(rich.coverage).toBeDefined();
    expect(
      rich.results.filter((e) => e.rankStability !== undefined),
    ).toHaveLength(10);
    expect(plain).not.toHaveProperty("coverage");
    expect(plain.results.some((e) => "rankStability" in e)).toBe(false);
  });

  it.each(["en", "zh-TW"] as const)(
    "analysis input: deeply equal, same numbers (%s)",
    (locale) => {
      for (const calibration of [undefined, "manual-entry"] as const) {
        const want = buildAnalysisInput(plain, m, locale, calibration);
        for (const [, fit] of variants) {
          const got = buildAnalysisInput(fit, m, locale, calibration);
          expect(got).toEqual(want);
          expect([...collectNumbers(got)].sort((a, b) => a - b)).toEqual(
            [...collectNumbers(want)].sort((a, b) => a - b),
          );
        }
      }
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "share card input: deeply equal (%s)",
    (lang) => {
      const want = buildShareCardInput(plain, lang, null);
      expect(want).not.toBeNull();
      for (const [, fit] of variants) {
        const got = buildShareCardInput(fit, lang, null);
        expect(got).toEqual(want);
        expect([...collectNumbers(got)].sort((a, b) => a - b)).toEqual(
          [...collectNumbers(want)].sort((a, b) => a - b),
        );
      }
    },
  );
});
