/**
 * fit-v2.0 candidate, build spec rev2 §4 T8: engine dispatch. "v2" runs the
 * candidate and stores catalogue priors like v1; an id that is not an
 * EngineId fails at the type level and at run time (no silent fall-through
 * to v0); and the default engine stays v1.
 */
import { describe, expect, it } from "vitest";
import {
  GRIP_STYLES,
  SUBSCORES,
  type FitPreferences,
} from "../../src/lib/contracts/fit";
import {
  DEFAULT_ENGINE,
  ENGINE_VERSION_V1,
  ENGINE_VERSION_V2,
  UNKNOWN_PRIOR_SCORE,
} from "../../src/server/fit/coefficients";
import {
  scoreFitDefault,
  scoreWithEngine,
  storedNullScore,
} from "../../src/server/fit/engine";
import { computePriors } from "../../src/server/fit/priors";
import { scoreFitV2 } from "../../src/server/fit/score-v2-candidate";
import { hand, mouseRow, seedCatalogue } from "./fit-v2c-fixtures";

const prefs: FitPreferences = { includeVertical: false };
const m = hand(250, 87.5); // out of range, so v2 really differs from v1

describe("T8: scoreWithEngine", () => {
  it('"v2" runs the candidate with the catalogue priors and reports its version', () => {
    const out = scoreWithEngine("v2", m, seedCatalogue, prefs, "right");
    expect(ENGINE_VERSION_V2).toBe("fit-v2.0-candidate.0");
    expect(out.engineVersion).toBe("fit-v2.0-candidate.0");
    expect(out).toEqual(
      scoreFitV2(
        m,
        seedCatalogue,
        prefs,
        "right",
        computePriors(seedCatalogue),
      ),
    );
    expect(out.coverage?.lengthOutOfRange).toBe(true);
    // Rank stability is a separate step, never part of the engine call.
    expect(out.results.some((e) => "rankStability" in e)).toBe(false);
  });

  it('"v1" is still v1', () => {
    const out = scoreWithEngine("v1", m, seedCatalogue, prefs, "right");
    expect(out.engineVersion).toBe(ENGINE_VERSION_V1);
    expect(out).not.toHaveProperty("coverage");
  });

  it("an unknown id fails at the type level and at run time", () => {
    expect(() =>
      // @ts-expect-error "v3" is not an EngineId
      scoreWithEngine("v3", m, seedCatalogue, prefs, "right"),
    ).toThrow(/Unknown fit engine: v3/);
    expect(() =>
      // @ts-expect-error "v3" is not an EngineId
      storedNullScore("v3", seedCatalogue),
    ).toThrow(/Unknown fit engine: v3/);
  });
});

describe("T8: storedNullScore", () => {
  // Catalogue priors that are not 75 for any grip of frontFlare and thumb.
  const cat = [
    mouseRow({ slug: "a", frontFlare: "outward_slight", thumbRest: true }),
    mouseRow({ slug: "b", frontFlare: "outward_moderate", thumbRest: true }),
  ];

  it('"v2" stores the catalogue-mean prior of every sub-score and grip, like v1', () => {
    const priors = computePriors(cat);
    const v2 = storedNullScore("v2", cat);
    const v1 = storedNullScore("v1", cat);
    let notSeventyFive = 0;
    for (const sub of SUBSCORES) {
      for (const grip of GRIP_STYLES) {
        expect(v2(sub, grip)).toBe(priors[sub][grip]);
        expect(v2(sub, grip)).toBe(v1(sub, grip));
        if (v2(sub, grip) !== UNKNOWN_PRIOR_SCORE) notSeventyFive += 1;
      }
    }
    // frontFlare and thumb, three grips each.
    expect(notSeventyFive).toBe(6);
  });

  it('"v0" still stores 75', () => {
    expect(storedNullScore("v0", cat)("thumb", "palm")).toBe(
      UNKNOWN_PRIOR_SCORE,
    );
  });
});

describe("T8: the default engine", () => {
  it("stays v1 until the gate in the contract is met", () => {
    expect(
      DEFAULT_ENGINE,
      [
        "DEFAULT_ENGINE must stay 'v1' (build spec rev2 §0.2, contract gate on `coverage`).",
        "Before it may become 'v2', all of this has to be done and decided:",
        "1. Results page: while coverage.lengthOutOfRange is true, show no numeric score and no band (results[].total).",
        "2. Excluded list: hide excluded[].total of a wrong_hand mouse under the same condition.",
        "3. Share card: src/components/results/share/input.ts must not put total / bandLabel on the card then.",
        "4. Analysis input: src/server/analysis/input.ts must not send topPicks total / band / sub-score params then.",
        "5. Neither coverage nor rankStability may enter the analysis input, the share card input or the numeral allow-list.",
        "6. src/server/recommend/service.ts fitExcludes(): `DEFAULT_ENGINE === 'v1'` sends any other id to v0's excludeReason; make it handle 'v2'.",
        "7. core.ts: decide whether attachRankStability runs, after scoreFitDefault and before groupShells (never group twice).",
        "8. src/server/result-feedback/snapshot.ts runs scoreFitDefault -> groupShells -> bandOf(entry.total) and stores the band in the feedback snapshot: no band while coverage.lengthOutOfRange is true.",
        "9. core.ts writes fit_results.totalScore from results[].total: out of range that is the ranking value, not a fit score; decide what is stored.",
        "10. The analysis route runs loadOwnedFit again: once rank stability is wired into it, its cost (about 0.5-0.8 s per call today) is paid twice; decide where it runs.",
        "11. The results page's brand / shape filters change which cards are 'the top 5'; rankStability is computed on the unfiltered list.",
        "12. The banner and stability copy (V2-COPY-DRAFTS-2026-10-18.md) approved; the contract deployed before the engine.",
        "13. Kirby's decision recorded (v2 is a candidate, 未拍板).",
      ].join("\n"),
    ).toBe("v1");
  });

  it("the route's engine is v1 and emits none of the v2 fields", () => {
    const out = scoreFitDefault(m, seedCatalogue, prefs, "right");
    expect(out.engineVersion).toBe(ENGINE_VERSION_V1);
    expect(out).not.toHaveProperty("coverage");
    expect(out.results.some((e) => "rankStability" in e)).toBe(false);
  });
});
