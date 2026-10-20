/**
 * Calibration from the survey (v3.1 consumers, Kirby 2026-10-20, candidate):
 * the conversion of survey ratings into references, the threshold of two
 * usable voices, the gates that decide when the survey is read at all, and
 * the result through `loadOwnedFit` and the fit service.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fitPreferencesSchema,
  type FitReference,
} from "../../src/lib/contracts/fit";
import type { PainPoint } from "../../src/lib/contracts/survey";
import { computeCacheKey } from "../../src/server/analysis/cache";
import { buildAnalysisInput } from "../../src/server/analysis/input";
import {
  MIN_AUTO_CALIBRATION_REFERENCES,
  autoCalibrationReferences,
  surveyReferencesFor,
  surveyRatingsToReferences,
  type SurveyRatingForCalibration,
  type SurveyReferenceSource,
} from "../../src/server/fit/auto-calibration";
import {
  adoptedReferenceCount,
  adoptedReferences,
  calibrateV3,
} from "../../src/server/fit/calibration-v3-candidate";
import { loadOwnedFit } from "../../src/server/fit/core";
import { baseTargetsV3 } from "../../src/server/fit/score-v3-candidate";
import { computeFitForScan } from "../../src/server/fit/service";
import type { CatalogueMouse } from "../../src/server/fit/types";
import {
  createFakeFitRepo,
  createFakeScanRepo,
  sampleCatalogue,
  sampleMeasurements,
  sampleOwnedScan,
} from "./fixtures/fake-fit-deps";

const SCAN_ID = "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f";
const NOW = () => new Date("2026-10-20T12:00:00Z");
const NO_PREFS = fitPreferencesSchema.parse({});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// --- fixtures ---------------------------------------------------------------

const [g502, basilisk] = sampleCatalogue as [CatalogueMouse, CatalogueMouse];
/** The same shell as the G502 (a version word in the model name). */
const g502se: CatalogueMouse = {
  ...g502,
  id: "mouse-g502se",
  slug: "logitech-g502-se",
  model: "G502 SE",
};
const unlisted: CatalogueMouse = {
  ...basilisk,
  id: "mouse-hidden",
  slug: "hidden-one",
  brand: "Hidden",
  listed: false,
};
const trackball: CatalogueMouse = {
  ...basilisk,
  id: "mouse-ball",
  slug: "ball-one",
  brand: "Ball",
  formFactor: "trackball",
};
const ergonomic: CatalogueMouse = {
  ...basilisk,
  id: "mouse-erg",
  slug: "erg-one",
  brand: "Erg",
  shape: "ergonomic",
};
const catalogue: CatalogueMouse[] = [
  g502,
  basilisk,
  g502se,
  unlisted,
  trackball,
  ergonomic,
];

const rated = (
  slug: string,
  over: Partial<SurveyRatingForCalibration> = {},
): SurveyRatingForCalibration => ({
  slug,
  satisfaction: 5,
  painPoints: [],
  gripStyle: "claw",
  ...over,
});

const G = g502.slug;
const B = basilisk.slug;

// --- the conversion ---------------------------------------------------------

describe("surveyRatingsToReferences", () => {
  it.each([4, 5])(
    "a rating of %s is a fit: length, width and height are just right",
    (satisfaction) => {
      expect(surveyRatingsToReferences([rated(G, { satisfaction })])).toEqual([
        {
          slug: G,
          grips: ["claw"],
          feel: { length: 0, width: 0, height: 0 },
          specialUse: false,
        },
      ]);
    },
  );

  it.each([1, 2, 3])("a rating of %s is not used", (satisfaction) => {
    expect(surveyRatingsToReferences([rated(G, { satisfaction })])).toEqual([]);
  });

  it.each([
    ["length", { length: null, width: 0, height: 0 }],
    ["width", { length: 0, width: null, height: 0 }],
    ["height", { length: 0, width: 0, height: null }],
  ] as const)(
    "a named %s pain point makes that dimension null and leaves the others",
    (point, feel) => {
      const [ref] = surveyRatingsToReferences([
        rated(G, { painPoints: [point] }),
      ]);
      expect(ref!.feel).toEqual(feel);
    },
  );

  it("all three named: every dimension null", () => {
    const [ref] = surveyRatingsToReferences([
      rated(G, { painPoints: ["length", "width", "height"] }),
    ]);
    expect(ref!.feel).toEqual({ length: null, width: null, height: null });
  });

  it.each(["weight", "thumb", "buttons", "other"] as PainPoint[])(
    "the pain point %s does not touch the three dimensions",
    (point) => {
      const [ref] = surveyRatingsToReferences([
        rated(G, { painPoints: [point] }),
      ]);
      expect(ref!.feel).toEqual({ length: 0, width: 0, height: 0 });
    },
  );

  it("grips: the stored grip when there is one, else empty", () => {
    const [withGrip, noGrip] = surveyRatingsToReferences([
      rated(G, { gripStyle: "fingertip" }),
      rated(B, { gripStyle: null }),
    ]);
    expect(withGrip!.grips).toEqual(["fingertip"]);
    expect(noGrip!.grips).toEqual([]);
  });

  it("never marks a reference as special use", () => {
    const refs = surveyRatingsToReferences([rated(G), rated(B)]);
    expect(refs.every((r) => r.specialUse === false)).toBe(true);
  });

  it("a slug rated twice keeps the first (newest) entry only", () => {
    const refs = surveyRatingsToReferences([
      rated(G, { satisfaction: 5, painPoints: ["length"] }),
      rated(G, { satisfaction: 1 }),
      rated(B, { satisfaction: 4 }),
    ]);
    expect(refs.map((r) => r.slug)).toEqual([G, B]);
    expect(refs[0]!.feel.length).toBeNull();
  });
});

// --- the threshold ------------------------------------------------------------

describe("the threshold of two voices", () => {
  it("is named, and is 2 (candidate)", () => {
    expect(MIN_AUTO_CALIBRATION_REFERENCES).toBe(2);
  });

  it("one usable mouse does not calibrate", () => {
    expect(autoCalibrationReferences([rated(G)], catalogue)).toEqual([]);
  });

  it("two usable mice of different shells calibrate", () => {
    const refs = autoCalibrationReferences([rated(G), rated(B)], catalogue);
    expect(refs.map((r) => r.slug)).toEqual([G, B]);
  });

  it("two mice of the same shell are one voice: no calibration; with a third voice all three go in", () => {
    expect(
      autoCalibrationReferences([rated(G), rated(g502se.slug)], catalogue),
    ).toEqual([]);
    expect(
      autoCalibrationReferences(
        [rated(G), rated(g502se.slug), rated(B)],
        catalogue,
      ).map((r) => r.slug),
    ).toEqual([G, g502se.slug, B]);
  });

  it.each([
    ["an unknown slug", "no-such-mouse"],
    ["an unlisted mouse", unlisted.slug],
    ["a trackball (the model does not apply)", trackball.slug],
  ])("%s is not counted", (_label, slug) => {
    expect(
      autoCalibrationReferences([rated(G), rated(slug)], catalogue),
    ).toEqual([]);
  });

  it("a mouse rated 3 or less is not counted", () => {
    expect(
      autoCalibrationReferences(
        [rated(G), rated(B, { satisfaction: 3 })],
        catalogue,
      ),
    ).toEqual([]);
  });

  it("a mouse whose three dimensions were all named answers nothing and is not counted", () => {
    expect(
      autoCalibrationReferences(
        [rated(G), rated(B, { painPoints: ["length", "width", "height"] })],
        catalogue,
      ),
    ).toEqual([]);
  });

  it("an ergonomic mouse with length and width named has only height left, which it never gives: not counted", () => {
    expect(
      autoCalibrationReferences(
        [rated(G), rated(ergonomic.slug, { painPoints: ["length", "width"] })],
        catalogue,
      ),
    ).toEqual([]);
  });

  it("keeps at most 8 references (the contract's limit)", () => {
    const many: CatalogueMouse[] = Array.from({ length: 11 }, (_, i) => ({
      ...basilisk,
      id: `m${i}`,
      slug: `many-${i}`,
      brand: `Brand${i}`,
    }));
    const refs = autoCalibrationReferences(
      many.map((m) => rated(m.slug)),
      many,
    );
    expect(refs).toHaveLength(8);
    expect(refs.map((r) => r.slug)).toEqual(
      many.slice(0, 8).map((m) => m.slug),
    );
  });
});

describe("adoptedReferences / adoptedReferenceCount (the engine's own rule)", () => {
  const ref = (
    slug: string,
    over: Partial<FitReference> = {},
  ): FitReference => ({
    slug,
    grips: [],
    feel: { length: 0, width: 0, height: 0 },
    specialUse: false,
    ...over,
  });

  it("drops unknown, unlisted, special-use, not-applicable and unanswered references", () => {
    const refs = [
      ref(G),
      ref("no-such-mouse"),
      ref(unlisted.slug),
      ref(trackball.slug),
      ref(B, { specialUse: true }),
      ref(ergonomic.slug, { feel: { length: null, width: null, height: 0 } }),
    ];
    expect(adoptedReferences(refs, catalogue).map((r) => r.slug)).toEqual([G]);
    expect(adoptedReferenceCount(refs, catalogue)).toBe(1);
  });

  it("counts a shell once", () => {
    expect(
      adoptedReferenceCount([ref(G), ref(g502se.slug), ref(B)], catalogue),
    ).toBe(2);
  });

  it("agrees with calibrateV3's referencesUsed when no two share a shell", () => {
    const refs = [ref(G), ref(B), ref(trackball.slug)];
    const result = calibrateV3(
      refs,
      catalogue,
      baseTargetsV3(sampleMeasurements, undefined),
      "claw",
    );
    expect(result.calibration.referencesUsed).toBe(
      adoptedReferenceCount(refs, catalogue),
    );
  });
});

// --- when the survey is read ------------------------------------------------------

describe("surveyReferencesFor: the gates", () => {
  const ratings = [rated(G), rated(B)];
  const sourceOf = () => {
    const loadRatings = vi.fn<SurveyReferenceSource["loadRatings"]>(
      async () => ratings,
    );
    return {
      source: { loadRatings } satisfies SurveyReferenceSource,
      loadRatings,
    };
  };
  const base = {
    engine: "v3" as const,
    userId: "user-1" as string | null,
    prefs: NO_PREFS,
    catalogue,
  };

  it("v3 + signed in + no references of its own: reads the survey for that user and returns the references", async () => {
    const { source, loadRatings } = sourceOf();
    const refs = await surveyReferencesFor({ ...base, source });
    expect(refs?.map((r) => r.slug)).toEqual([G, B]);
    expect(loadRatings).toHaveBeenCalledTimes(1);
    expect(loadRatings).toHaveBeenCalledWith("user-1");
  });

  it.each(["v0", "v1", "v2"] as const)(
    "engine %s: the survey is not read",
    async (engine) => {
      const { source, loadRatings } = sourceOf();
      expect(
        await surveyReferencesFor({ ...base, engine, source }),
      ).toBeUndefined();
      expect(loadRatings).not.toHaveBeenCalled();
    },
  );

  it("not signed in: the survey is not read", async () => {
    const { source, loadRatings } = sourceOf();
    expect(
      await surveyReferencesFor({ ...base, userId: null, source }),
    ).toBeUndefined();
    expect(loadRatings).not.toHaveBeenCalled();
  });

  it("a request that carries references (even an empty list): the survey is not read", async () => {
    const own = {
      slug: G,
      grips: [],
      feel: { length: 0, width: 0, height: 0 },
      specialUse: false,
    };
    for (const references of [[], [own]]) {
      const { source, loadRatings } = sourceOf();
      const prefs = fitPreferencesSchema.parse({ references });
      expect(
        await surveyReferencesFor({ ...base, prefs, source }),
      ).toBeUndefined();
      expect(loadRatings).not.toHaveBeenCalled();
    }
  });

  it("no source wired: nothing", async () => {
    expect(
      await surveyReferencesFor({ ...base, source: undefined }),
    ).toBeUndefined();
  });

  it("too few usable ratings: undefined, so the preferences stay as they are", async () => {
    const loadRatings = vi.fn(async () => [rated(G)]);
    expect(
      await surveyReferencesFor({ ...base, source: { loadRatings } }),
    ).toBeUndefined();
  });
});

// --- through loadOwnedFit ------------------------------------------------------------

describe("loadOwnedFit with the survey", () => {
  const sourceOf = (ratings: SurveyRatingForCalibration[]) => {
    const loadRatings = vi.fn<SurveyReferenceSource["loadRatings"]>(
      async () => ratings,
    );
    return { source: { loadRatings }, loadRatings };
  };
  const run = async (opts: {
    userId: string | null;
    surveyReferences?: SurveyReferenceSource;
    prefs?: ReturnType<typeof fitPreferencesSchema.parse>;
  }) => {
    const { repo: fitRepo, otherCalls } = createFakeFitRepo(catalogue);
    const result = await loadOwnedFit(
      SCAN_ID,
      { userId: opts.userId, cookieSessionId: "c" },
      opts.prefs ?? NO_PREFS,
      {
        scanRepo: createFakeScanRepo(vi.fn(async () => sampleOwnedScan)),
        fitRepo,
        surveyReferences: opts.surveyReferences,
        now: NOW,
      },
    );
    if (result.status !== "ok") throw new Error("unreachable");
    return { result, otherCalls };
  };
  const two = [rated(G), rated(B)];

  it("v3, signed in, two usable ratings: the response carries a calibration of those two, and the targets moved", async () => {
    vi.stubEnv("FIT_ENGINE", "v3");
    const plain = (await run({ userId: "user-1" })).result.fit;
    const { source, loadRatings } = sourceOf(two);
    const { result } = await run({
      userId: "user-1",
      surveyReferences: source,
    });
    expect(loadRatings).toHaveBeenCalledTimes(1);
    expect(loadRatings).toHaveBeenCalledWith("user-1");
    const fit = result.fit;
    expect(plain.calibration).toBeUndefined();
    expect(fit.calibration?.referencesUsed).toBe(2);
    expect(fit.calibration?.dims.length.answers).toBeGreaterThan(0);
    expect(fit.targets).not.toEqual(plain.targets);
  });

  it("one usable rating: no calibration block, and the response equals the uncalibrated one", async () => {
    vi.stubEnv("FIT_ENGINE", "v3");
    const plain = (await run({ userId: "user-1" })).result.fit;
    const { source } = sourceOf([rated(G), rated(B, { satisfaction: 2 })]);
    const { result } = await run({
      userId: "user-1",
      surveyReferences: source,
    });
    expect(result.fit).not.toHaveProperty("calibration");
    expect(result.fit).toEqual(plain);
  });

  it("two ratings of one shell: no calibration block", async () => {
    vi.stubEnv("FIT_ENGINE", "v3");
    const { source } = sourceOf([rated(G), rated(g502se.slug)]);
    const { result } = await run({
      userId: "user-1",
      surveyReferences: source,
    });
    expect(result.fit).not.toHaveProperty("calibration");
  });

  it("the request's own references win and the survey is not read", async () => {
    vi.stubEnv("FIT_ENGINE", "v3");
    const { source, loadRatings } = sourceOf(two);
    const prefs = fitPreferencesSchema.parse({
      references: [
        {
          slug: G,
          grips: [],
          feel: { length: 1, width: null, height: null },
        },
      ],
    });
    const { result } = await run({
      userId: "user-1",
      surveyReferences: source,
      prefs,
    });
    expect(loadRatings).not.toHaveBeenCalled();
    expect(result.fit.calibration?.referencesUsed).toBe(1);
  });

  it("not signed in: the survey is not read and nothing is calibrated", async () => {
    vi.stubEnv("FIT_ENGINE", "v3");
    const { source, loadRatings } = sourceOf(two);
    const { result } = await run({ userId: null, surveyReferences: source });
    expect(loadRatings).not.toHaveBeenCalled();
    expect(result.fit).not.toHaveProperty("calibration");
  });

  it.each(["", "v1", "v2"])(
    "FIT_ENGINE=%j: the survey is not read and the response is the uncalibrated one",
    async (engine) => {
      vi.stubEnv("FIT_ENGINE", engine);
      const plain = (await run({ userId: "user-1" })).result.fit;
      const { source, loadRatings } = sourceOf(two);
      const { result } = await run({
        userId: "user-1",
        surveyReferences: source,
      });
      expect(loadRatings).not.toHaveBeenCalled();
      expect(result.fit).toEqual(plain);
    },
  );

  it("keeps nothing and tells nobody: no repo write, no log line, no slug in the calibration block", async () => {
    vi.stubEnv("FIT_ENGINE", "v3");
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (m) => vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const { source } = sourceOf(two);
    const { result, otherCalls } = await run({
      userId: "user-1",
      surveyReferences: source,
    });
    expect(otherCalls).toEqual([]);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    const block = JSON.stringify(result.fit.calibration);
    expect(block).not.toContain(G);
    expect(block).not.toContain(B);
  });

  it("the analysis cache key moves with the calibration (the prompt shows the moved targets and the adjusted flag)", async () => {
    vi.stubEnv("FIT_ENGINE", "v3");
    const plain = (await run({ userId: "user-1" })).result;
    const { source } = sourceOf(two);
    const calibrated = (
      await run({ userId: "user-1", surveyReferences: source })
    ).result;
    expect(
      buildAnalysisInput(calibrated.fit, calibrated.measurements, "en")
        .targetsPersonallyAdjusted,
    ).toBe(true);
    for (const locale of ["en", "zh-TW"] as const) {
      expect(
        computeCacheKey(calibrated.fit, calibrated.measurements, locale),
      ).not.toBe(computeCacheKey(plain.fit, plain.measurements, locale));
    }
  });
});

// --- through the fit service ----------------------------------------------------------

describe("POST /api/scans/{scanId}/fit with the survey", () => {
  it("a signed-in caller gets the calibration, an anonymous caller does not", async () => {
    vi.stubEnv("FIT_ENGINE", "v3");
    const loadRatings = vi.fn<SurveyReferenceSource["loadRatings"]>(
      async () => [rated(G), rated(B)],
    );
    const call = async (userId: string | null) => {
      const res = await computeFitForScan(
        new Request(`http://localhost/api/scans/${SCAN_ID}/fit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
        SCAN_ID,
        {
          scanRepo: createFakeScanRepo(vi.fn(async () => sampleOwnedScan)),
          fitRepo: createFakeFitRepo(catalogue).repo,
          surveyReferences: { loadRatings },
          getUserId: async () => userId,
        },
      );
      expect(res.status).toBe(200);
      return res.json();
    };
    expect((await call("user-1")).calibration.referencesUsed).toBe(2);
    expect(loadRatings).toHaveBeenCalledTimes(1);
    expect(await call(null)).not.toHaveProperty("calibration");
    expect(loadRatings).toHaveBeenCalledTimes(1);
  });
});
