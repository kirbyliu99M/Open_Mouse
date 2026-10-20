/**
 * V3.2 F1 result fingerprint (candidate, 未拍板; Astra A1-04): the pure
 * fingerprint, what it does and does not read, the fit response carrying it,
 * the analysis and feedback routes refusing a stale ranking with 412 (and
 * nothing else happening), and the results page's client helpers.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fitPreferencesSchema,
  resultFingerprintSchema,
  type FitResponse,
} from "../../src/lib/contracts/fit";
import {
  RESULT_FINGERPRINT_HEADER,
  analysisPath,
  errorResponseSchema,
  resultFeedbackPath,
} from "../../src/lib/contracts/routes";
import { RESULT_FEEDBACK_NOTICE_VERSION } from "../../src/lib/contracts/result-feedback";
import {
  RESULT_FINGERPRINT_TOP_PLACES,
  fingerprintMismatch,
  fingerprintOfFit,
  resultFingerprint,
  type ResultFingerprintInput,
} from "../../src/server/fit/fingerprint";
import { loadOwnedFit } from "../../src/server/fit/core";
import { computeFitForScan } from "../../src/server/fit/service";
import type {
  SurveyRatingForCalibration,
  SurveyReferenceSource,
} from "../../src/server/fit/auto-calibration";
import type { CatalogueMouse } from "../../src/server/fit/types";
import { InMemoryAnalysisCache } from "../../src/server/analysis/cache";
import { FakeTextModel } from "../../src/server/analysis/client";
import { computeAnalysisForScan } from "../../src/server/analysis/service";
import type {
  FeedbackWrite,
  ResultFeedbackRepo,
} from "../../src/server/result-feedback/repo";
import {
  handleResultFeedbackSubmission,
  type ResultFeedbackDeps,
} from "../../src/server/result-feedback/service";
import { buildSnapshotAndFingerprint } from "../../src/server/result-feedback/snapshot";
import {
  analyseShownRanking,
  fetchAnalysisResult,
  fingerprintHeaders,
  type AnalysisOutcome,
} from "../../src/components/results/fetchResults";
import {
  afterSend,
  failureFromStatus,
  feedbackSender,
  sendFeedback,
  submitFeedback,
  type FeedbackSubmitIo,
  type SendFailure,
  type SendResult,
  type SheetPhase,
} from "../../src/lib/results/resultFeedback";
import {
  analyseOnScreen,
  refreshShownFit,
  refreshThenReanalyse,
  shownRankingClient,
  type ShownRankingRefs,
} from "../../src/components/results/shownRanking";
import { failureText } from "../../src/components/results/ResultFeedbackPanel";
import { resultFeedbackCopy } from "../../src/lib/copy/result-feedback";
import { questionnaireCopy } from "../../src/lib/copy/questionnaire";
import {
  createFakeFitRepo,
  createFakeScanRepo,
  sampleCatalogue,
  sampleOwnedScan,
  shellCatalogue,
} from "./fixtures/fake-fit-deps";

vi.mock("server-only", () => ({}));

const SCAN_ID = "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f";
const NOW = () => new Date("2026-10-21T12:00:00Z");
const NO_PREFS = fitPreferencesSchema.parse({});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const base: ResultFingerprintInput = {
  engineVersion: "fit-v3.0-candidate",
  scored: true,
  targets: { lengthMm: 121.04, gripWidthMm: 61.2, heightMm: 39.96 },
  rankedSlugs: ["a", "b", "c", "d", "e", "f", "g"],
};

// --- the pure function --------------------------------------------------------

describe("resultFingerprint", () => {
  it("is sixteen lower-case hex characters, the contract's shape", () => {
    const fp = resultFingerprint(base);
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
    expect(resultFingerprintSchema.safeParse(fp).success).toBe(true);
  });

  it("gives the same value for the same input, every time", () => {
    const again = resultFingerprint({
      ...base,
      targets: { ...base.targets },
      rankedSlugs: [...base.rankedSlugs],
    });
    expect(again).toBe(resultFingerprint(base));
  });

  it("changes when the order of the first five changes", () => {
    const swapped = ["b", "a", "c", "d", "e", "f", "g"];
    const fifthSwapped = ["a", "b", "c", "d", "f", "e", "g"];
    expect(resultFingerprint({ ...base, rankedSlugs: swapped })).not.toBe(
      resultFingerprint(base),
    );
    expect(resultFingerprint({ ...base, rankedSlugs: fifthSwapped })).not.toBe(
      resultFingerprint(base),
    );
  });

  it("changes when a new mouse enters the first five", () => {
    const entered = ["a", "b", "c", "d", "z", "f", "g"];
    expect(resultFingerprint({ ...base, rankedSlugs: entered })).not.toBe(
      resultFingerprint(base),
    );
  });

  it("reads only the first five places", () => {
    expect(RESULT_FINGERPRINT_TOP_PLACES).toBe(5);
    const tail = ["a", "b", "c", "d", "e", "x", "y", "z"];
    expect(resultFingerprint({ ...base, rankedSlugs: tail })).toBe(
      resultFingerprint(base),
    );
  });

  it("changes when a target moves by 0.1 mm, and not below the rounding", () => {
    for (const key of ["lengthMm", "gripWidthMm", "heightMm"] as const) {
      const moved = { ...base.targets, [key]: base.targets[key] + 0.1 };
      expect(resultFingerprint({ ...base, targets: moved })).not.toBe(
        resultFingerprint(base),
      );
    }
    // 121.04 and 121.01 are both 121.0 mm to 0.1 mm.
    const sameTenth = { ...base.targets, lengthMm: 121.01 };
    expect(resultFingerprint({ ...base, targets: sameTenth })).toBe(
      resultFingerprint(base),
    );
  });

  it("changes with the score mode and with the engine version", () => {
    expect(resultFingerprint({ ...base, scored: false })).not.toBe(
      resultFingerprint(base),
    );
    expect(
      resultFingerprint({ ...base, engineVersion: "fit-v1.0-candidate" }),
    ).not.toBe(resultFingerprint(base));
  });

  it("hashes -0 like 0", () => {
    const zero = { lengthMm: 0, gripWidthMm: 0, heightMm: 0 };
    const negZero = { lengthMm: -0, gripWidthMm: -0.01, heightMm: 0.04 };
    expect(resultFingerprint({ ...base, targets: negZero })).toBe(
      resultFingerprint({ ...base, targets: zero }),
    );
  });
});

describe("fingerprintOfFit", () => {
  const fit = {
    engineVersion: base.engineVersion,
    targets: base.targets,
    coverage: undefined,
    results: base.rankedSlugs.map((slug) => ({ mouse: { slug } })),
  };

  it("is resultFingerprint of the engine version, the mode, the targets and the first five slugs", () => {
    expect(fingerprintOfFit(fit)).toBe(resultFingerprint(base));
  });

  it("reads the unscored mode from coverage.lengthOutOfRange", () => {
    const outside = {
      ...fit,
      coverage: {
        lengthOutOfRange: true,
        direction: "above" as const,
        usedGripLengthTargetMm: 121,
        catalogueLengthRangeMm: [100, 120] as [number, number],
      },
    };
    expect(fingerprintOfFit(outside)).toBe(
      resultFingerprint({ ...base, scored: false }),
    );
    // In range, the same coverage numbers do not enter the hash.
    expect(
      fingerprintOfFit({
        ...outside,
        coverage: {
          ...outside.coverage,
          lengthOutOfRange: false,
          direction: null,
        },
      }),
    ).toBe(resultFingerprint(base));
  });

  it("ignores everything else a fit carries: measurements, calibration shifts, totals, excluded mice", () => {
    const rich = {
      ...fit,
      calibration: { shiftMm: 7, answers: 3 },
      handType: { size: "large" },
      excluded: [{ slug: "q", total: 40 }],
      results: base.rankedSlugs.map((slug, i) => ({
        mouse: { slug, lengthMm: 100 + i },
        total: 90 - i,
      })),
    };
    expect(fingerprintOfFit(rich)).toBe(fingerprintOfFit(fit));
  });
});

describe("fingerprintMismatch", () => {
  const headers = (value?: string) =>
    new Headers(
      value === undefined ? {} : { [RESULT_FINGERPRINT_HEADER]: value },
    );
  it("no header is never a mismatch (older pages)", () => {
    expect(fingerprintMismatch(headers(), "0123456789abcdef")).toBe(false);
  });
  it("an equal header is not; a different, empty or malformed one is", () => {
    expect(
      fingerprintMismatch(headers("0123456789abcdef"), "0123456789abcdef"),
    ).toBe(false);
    for (const sent of ["fedcba9876543210", "", "not-a-fingerprint"])
      expect(fingerprintMismatch(headers(sent), "0123456789abcdef")).toBe(true);
  });
});

// --- through loadOwnedFit and the snapshot ---------------------------------

const [g502, basilisk] = sampleCatalogue as [CatalogueMouse, CatalogueMouse];
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
const sourceOf = (
  ratings: SurveyRatingForCalibration[],
): SurveyReferenceSource => ({ loadRatings: vi.fn(async () => ratings) });

async function ownedFit(
  opts: {
    userId?: string | null;
    surveyReferences?: SurveyReferenceSource;
    catalogue?: CatalogueMouse[];
  } = {},
): Promise<FitResponse> {
  const { repo: fitRepo } = createFakeFitRepo(
    opts.catalogue ?? sampleCatalogue,
  );
  const result = await loadOwnedFit(
    SCAN_ID,
    { userId: opts.userId ?? null, cookieSessionId: "c" },
    NO_PREFS,
    {
      scanRepo: createFakeScanRepo(vi.fn(async () => sampleOwnedScan)),
      fitRepo,
      surveyReferences: opts.surveyReferences,
      now: NOW,
    },
  );
  if (result.status !== "ok") throw new Error("unreachable");
  return result.fit;
}

describe("the fit response carries the fingerprint", () => {
  it.each(["v1", "v3"])(
    "loadOwnedFit (%s) fills resultFingerprint from the ranking it returns",
    async (engine) => {
      vi.stubEnv("FIT_ENGINE", engine);
      const fit = await ownedFit();
      expect(fit.resultFingerprint).toBeDefined();
      expect(fit.resultFingerprint).toBe(fingerprintOfFit(fit));
      // Same scan, same request: same fingerprint.
      expect((await ownedFit()).resultFingerprint).toBe(fit.resultFingerprint);
    },
  );

  it("the fit route's 200 body carries it", async () => {
    const { repo: fitRepo } = createFakeFitRepo(sampleCatalogue);
    const res = await computeFitForScan(
      new Request(`http://localhost/api/scans/${SCAN_ID}/fit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      SCAN_ID,
      {
        scanRepo: createFakeScanRepo(vi.fn(async () => sampleOwnedScan)),
        fitRepo,
        limiter: { allow: () => true },
        getUserId: async () => null,
        now: NOW,
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as FitResponse;
    expect(body.resultFingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it.each(["v1", "v3"])(
    "the feedback snapshot's fingerprint (%s) equals the one the page got for {}",
    async (engine) => {
      vi.stubEnv("FIT_ENGINE", engine);
      const fit = await ownedFit();
      const { resultFingerprint: fromSnapshot } =
        await buildSnapshotAndFingerprint(sampleOwnedScan, sampleCatalogue);
      expect(fromSnapshot).toBe(fit.resultFingerprint);
    },
  );

  // The page (core.ts) and the snapshot (snapshot.ts) each run listedOnly and
  // groupShells; with two plain mice both orders agree whatever they do, so
  // this catalogue has a same-shell pair, an unlisted row and more than five
  // shown places.
  it.each(["v1", "v3"])(
    "with a same-shell pair and an unlisted row (%s) the snapshot's fingerprint still equals the page's",
    async (engine) => {
      vi.stubEnv("FIT_ENGINE", engine);
      const fit = await ownedFit({ catalogue: shellCatalogue });
      const top = fit.results.slice(0, RESULT_FINGERPRINT_TOP_PLACES);
      const slugs = fit.results.map((r) => r.mouse.slug);
      // The fixture does what it is for: the merged card is in the first five,
      // its variant is not a place of its own, the unlisted row is not ranked,
      // and there are more shown places than the fingerprint reads.
      const merged = top.find((r) => (r.variants?.length ?? 0) > 0);
      expect(merged).toBeDefined();
      expect(
        [merged!.mouse.slug, ...merged!.variants!.map((v) => v.slug)].sort(),
      ).toEqual(["acme-m75", "acme-m75-wireless"]);
      expect(slugs.filter((s) => s.startsWith("acme-m75"))).toHaveLength(1);
      expect(slugs).not.toContain("acme-hidden");
      expect(fit.results.length).toBeGreaterThan(RESULT_FINGERPRINT_TOP_PLACES);
      expect(fit.resultFingerprint).toBe(fingerprintOfFit(fit));

      const { resultFingerprint: fromSnapshot } =
        await buildSnapshotAndFingerprint(sampleOwnedScan, shellCatalogue);
      expect(fromSnapshot).toBe(fit.resultFingerprint);

      // Both drift directions would change it: the variant as a place of its
      // own (no grouping), or the unlisted row ranked beside its shell.
      const asPlaces = (extra: (slug: string) => string[]) =>
        fingerprintOfFit({
          ...fit,
          results: fit.results.flatMap((r) => [
            r,
            ...extra(r.mouse.slug).map((slug) => ({ mouse: { slug } })),
          ]),
        });
      const ungrouped = asPlaces((slug) =>
        slug === merged!.mouse.slug ? merged!.variants!.map((v) => v.slug) : [],
      );
      const withUnlisted = asPlaces((slug) =>
        slug === merged!.mouse.slug ? ["acme-hidden"] : [],
      );
      expect(top.indexOf(merged!)).toBeLessThan(
        RESULT_FINGERPRINT_TOP_PLACES - 1,
      );
      expect(withUnlisted).not.toBe(fit.resultFingerprint);
      expect(ungrouped).not.toBe(fit.resultFingerprint);
    },
  );
});

describe("the fingerprint holds no survey answer", () => {
  it("two different surveys that give the same calibration give the same fingerprint", async () => {
    vi.stubEnv("FIT_ENGINE", "v3");
    // Satisfaction 5 vs 4, different stored grips, and an extra low rating
    // that calibration does not use: the same references, so the same result.
    const surveyA = sourceOf([rated(g502.slug), rated(basilisk.slug)]);
    const surveyB = sourceOf([
      rated(g502.slug, { satisfaction: 4, gripStyle: "palm" }),
      rated(basilisk.slug, { satisfaction: 4, gripStyle: null }),
      rated("some-other-mouse", { satisfaction: 2, painPoints: ["weight"] }),
    ]);
    const a = await ownedFit({ userId: "user-1", surveyReferences: surveyA });
    const b = await ownedFit({ userId: "user-1", surveyReferences: surveyB });
    expect(a.calibration?.referencesUsed).toBe(2);
    expect(b.targets).toEqual(a.targets);
    expect(b.resultFingerprint).toBe(a.resultFingerprint);
  });

  it("a survey that moves the targets moves the fingerprint (the edit in another tab, A1-04)", async () => {
    vi.stubEnv("FIT_ENGINE", "v3");
    const plain = await ownedFit({ userId: "user-1" });
    const calibrated = await ownedFit({
      userId: "user-1",
      surveyReferences: sourceOf([rated(g502.slug), rated(basilisk.slug)]),
    });
    expect(calibrated.targets).not.toEqual(plain.targets);
    expect(calibrated.resultFingerprint).not.toBe(plain.resultFingerprint);
  });
});

// --- the analysis route -------------------------------------------------------

const CLEAN_ANSWER = JSON.stringify({
  headline: "A strong match for your hand.",
  whyTopPick: "It's a solid pick for your measurements.",
  tradeoffs: [],
  whatToAvoid: [],
  caveats: [],
});

function analysisSetup() {
  const client = new FakeTextModel({ answer: () => CLEAN_ANSWER });
  const generate = vi.spyOn(client, "generate");
  const cache = new InMemoryAnalysisCache();
  const cacheGet = vi.spyOn(cache, "get");
  const cacheSet = vi.spyOn(cache, "set");
  const limiterAllow = vi.fn(() => true);
  const globalAllow = vi.fn(() => true);
  const { repo: fitRepo } = createFakeFitRepo(sampleCatalogue);
  const deps = {
    scanRepo: createFakeScanRepo(vi.fn(async () => sampleOwnedScan)),
    fitRepo,
    client,
    cache,
    limiter: { allow: limiterAllow },
    globalLimiter: { allow: globalAllow },
    getUserId: async () => null,
    now: NOW,
  };
  return { deps, generate, cacheGet, cacheSet, limiterAllow, globalAllow };
}

const analysisRequest = (headers: Record<string, string> = {}) =>
  new Request(`http://localhost${analysisPath(SCAN_ID)}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: "{}",
  });

describe("POST analysis with x-result-fingerprint", () => {
  it("a different fingerprint is 412: no model call, no cache read or write, no limiter charged", async () => {
    const s = analysisSetup();
    const res = await computeAnalysisForScan(
      analysisRequest({ [RESULT_FINGERPRINT_HEADER]: "0000000000000000" }),
      SCAN_ID,
      s.deps,
    );
    expect(res.status).toBe(412);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(errorResponseSchema.safeParse(await res.json()).success).toBe(true);
    expect(s.generate).not.toHaveBeenCalled();
    expect(s.cacheGet).not.toHaveBeenCalled();
    expect(s.cacheSet).not.toHaveBeenCalled();
    expect(s.limiterAllow).not.toHaveBeenCalled();
    expect(s.globalAllow).not.toHaveBeenCalled();
  });

  it("the fingerprint of the current fit is answered as before", async () => {
    const s = analysisSetup();
    const fit = await ownedFit();
    const res = await computeAnalysisForScan(
      analysisRequest({
        [RESULT_FINGERPRINT_HEADER]: fit.resultFingerprint as string,
      }),
      SCAN_ID,
      s.deps,
    );
    expect(res.status).toBe(200);
    expect(s.generate).toHaveBeenCalledTimes(1);
    expect(s.cacheSet).toHaveBeenCalledTimes(1);
  });

  it("no header: unchanged (200, one model call, cached)", async () => {
    const s = analysisSetup();
    const res = await computeAnalysisForScan(
      analysisRequest(),
      SCAN_ID,
      s.deps,
    );
    expect(res.status).toBe(200);
    expect(s.generate).toHaveBeenCalledTimes(1);
    expect(s.cacheSet).toHaveBeenCalledTimes(1);
  });

  it("the survey edited in another tab after the page loaded: the old fingerprint is refused", async () => {
    vi.stubEnv("FIT_ENGINE", "v3");
    // The page loaded before the survey existed ...
    const shown = await ownedFit({ userId: "user-1" });
    // ... and the server now calibrates from two new ratings.
    const s = analysisSetup();
    const res = await computeAnalysisForScan(
      analysisRequest({
        [RESULT_FINGERPRINT_HEADER]: shown.resultFingerprint as string,
      }),
      SCAN_ID,
      {
        ...s.deps,
        getUserId: async () => "user-1",
        surveyReferences: sourceOf([rated(g502.slug), rated(basilisk.slug)]),
      },
    );
    expect(res.status).toBe(412);
    expect(s.generate).not.toHaveBeenCalled();
  });
});

// --- the feedback route -------------------------------------------------------

function feedbackSetup() {
  const writes: FeedbackWrite[] = [];
  const feedbackRepo: ResultFeedbackRepo = {
    async recordFeedback(write) {
      writes.push(write);
      return "stored";
    },
    async isRated() {
      return false;
    },
    async withdrawFeedback() {
      return 0;
    },
  };
  const deps: ResultFeedbackDeps = {
    scanRepo: { findOwnedScan: vi.fn(async () => sampleOwnedScan) },
    fitRepo: { loadCatalogue: vi.fn(async () => sampleCatalogue) },
    feedbackRepo,
    limiter: { allow: () => true },
    getUserId: async () => null,
    now: NOW,
  };
  return { deps, writes };
}

const feedbackRequest = (headers: Record<string, string> = {}) =>
  new Request(`http://localhost${resultFeedbackPath(SCAN_ID)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.9",
      ...headers,
    },
    body: JSON.stringify({
      notice: RESULT_FEEDBACK_NOTICE_VERSION,
      stars: 4,
      locale: "zh-TW",
    }),
  });

describe("POST feedback with x-result-fingerprint", () => {
  it("a different fingerprint is 412 and stores nothing", async () => {
    const s = feedbackSetup();
    const res = await handleResultFeedbackSubmission(
      feedbackRequest({ [RESULT_FINGERPRINT_HEADER]: "0000000000000000" }),
      SCAN_ID,
      s.deps,
    );
    expect(res.status).toBe(412);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(errorResponseSchema.safeParse(await res.json()).success).toBe(true);
    expect(s.writes).toHaveLength(0);
  });

  it("the fingerprint of the ranking on screen is stored as before", async () => {
    const s = feedbackSetup();
    const fit = await ownedFit();
    const res = await handleResultFeedbackSubmission(
      feedbackRequest({
        [RESULT_FINGERPRINT_HEADER]: fit.resultFingerprint as string,
      }),
      SCAN_ID,
      s.deps,
    );
    expect(res.status).toBe(201);
    expect(s.writes).toHaveLength(1);
    // The fingerprint is not part of what is stored.
    expect(JSON.stringify(s.writes[0])).not.toContain(fit.resultFingerprint);
  });

  it("no header: unchanged (201, one write)", async () => {
    const s = feedbackSetup();
    const res = await handleResultFeedbackSubmission(
      feedbackRequest(),
      SCAN_ID,
      s.deps,
    );
    expect(res.status).toBe(201);
    expect(s.writes).toHaveLength(1);
  });

  // Signed in with two survey ratings (v3 calibrates): the snapshot must
  // calibrate exactly as loadOwnedFit did for the page, or every rating of a
  // calibrated person would be refused (or, if both ignored calibration, the
  // survey edit in another tab would slip through).
  const calibratedDeps = (s: ReturnType<typeof feedbackSetup>) => ({
    ...s.deps,
    getUserId: async () => "user-1",
    surveyReferences: sourceOf([rated(g502.slug), rated(basilisk.slug)]),
  });

  it("signed in and calibrated: the fingerprint of the calibrated page is stored (201)", async () => {
    vi.stubEnv("FIT_ENGINE", "v3");
    const shown = await ownedFit({
      userId: "user-1",
      surveyReferences: sourceOf([rated(g502.slug), rated(basilisk.slug)]),
    });
    expect(shown.calibration?.referencesUsed).toBe(2);
    const s = feedbackSetup();
    const res = await handleResultFeedbackSubmission(
      feedbackRequest({
        [RESULT_FINGERPRINT_HEADER]: shown.resultFingerprint as string,
      }),
      SCAN_ID,
      calibratedDeps(s),
    );
    expect(res.status).toBe(201);
    expect(s.writes).toHaveLength(1);
  });

  it("the survey edited in another tab after the page loaded: the uncalibrated page's rating is 412, nothing stored", async () => {
    vi.stubEnv("FIT_ENGINE", "v3");
    // The page loaded before the survey existed ...
    const shown = await ownedFit({ userId: "user-1" });
    // ... and the server now calibrates from two new ratings.
    const s = feedbackSetup();
    const res = await handleResultFeedbackSubmission(
      feedbackRequest({
        [RESULT_FINGERPRINT_HEADER]: shown.resultFingerprint as string,
      }),
      SCAN_ID,
      calibratedDeps(s),
    );
    expect(res.status).toBe(412);
    expect(s.writes).toHaveLength(0);
  });
});

// --- the results page's client helpers ----------------------------------------

const FIT_A = { resultFingerprint: "aaaaaaaaaaaaaaaa" } as FitResponse;
const FIT_B = { resultFingerprint: "bbbbbbbbbbbbbbbb" } as FitResponse;
const READY = {
  status: "ready",
  response: { source: "model" },
} as unknown as AnalysisOutcome;

describe("fetchAnalysisResult with a fingerprint", () => {
  const reply = (status: number) =>
    vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ error: "x" }), { status }),
    );

  it("sends the header when the fit had a fingerprint, and none without one", async () => {
    const withFp = reply(500);
    await fetchAnalysisResult(SCAN_ID, {}, withFp, FIT_A.resultFingerprint);
    const sent = withFp.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(sent[RESULT_FINGERPRINT_HEADER]).toBe(FIT_A.resultFingerprint);

    const without = reply(500);
    await fetchAnalysisResult(SCAN_ID, {}, without);
    const plain = without.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(RESULT_FINGERPRINT_HEADER in plain).toBe(false);
    expect(fingerprintHeaders(undefined)).toEqual({});
  });

  it("maps 412 to stale", async () => {
    expect(
      await fetchAnalysisResult(SCAN_ID, {}, reply(412), "x".repeat(16)),
    ).toEqual({ status: "stale" });
  });
});

describe("analyseShownRanking (412 → refetch the fit → ask again)", () => {
  it("asks once with the fingerprint on screen when it is current", async () => {
    const fetchAnalysis = vi.fn(async () => READY);
    const refreshFit = vi.fn(async () => FIT_B);
    const out = await analyseShownRanking({
      resultFingerprint: FIT_A.resultFingerprint,
      fetchAnalysis,
      refreshFit,
    });
    expect(out).toBe(READY);
    expect(fetchAnalysis).toHaveBeenCalledTimes(1);
    expect(fetchAnalysis).toHaveBeenCalledWith(FIT_A.resultFingerprint);
    expect(refreshFit).not.toHaveBeenCalled();
  });

  it("on 412 refetches the fit and asks again with the new fingerprint", async () => {
    const fetchAnalysis = vi
      .fn<(fp: string | undefined) => Promise<AnalysisOutcome>>()
      .mockResolvedValueOnce({ status: "stale" })
      .mockResolvedValueOnce(READY);
    const refreshFit = vi.fn(async () => FIT_B);
    const out = await analyseShownRanking({
      resultFingerprint: FIT_A.resultFingerprint,
      fetchAnalysis,
      refreshFit,
    });
    expect(refreshFit).toHaveBeenCalledTimes(1);
    expect(fetchAnalysis.mock.calls.map((c) => c[0])).toEqual([
      FIT_A.resultFingerprint,
      FIT_B.resultFingerprint,
    ]);
    expect(out).toBe(READY);
  });

  it("refetches only once: a second 412 is an error, not a loop", async () => {
    const fetchAnalysis = vi.fn(async (): Promise<AnalysisOutcome> => ({
      status: "stale",
    }));
    const refreshFit = vi.fn(async () => FIT_B);
    const out = await analyseShownRanking({
      resultFingerprint: FIT_A.resultFingerprint,
      fetchAnalysis,
      refreshFit,
    });
    expect(out).toEqual({ status: "serverError" });
    expect(fetchAnalysis).toHaveBeenCalledTimes(2);
    expect(refreshFit).toHaveBeenCalledTimes(1);
  });

  it("a refetch that fails is an error; a page that moved on gets nothing", async () => {
    const stale = async (): Promise<AnalysisOutcome> => ({ status: "stale" });
    expect(
      await analyseShownRanking({
        resultFingerprint: "a",
        fetchAnalysis: stale,
        refreshFit: async () => null,
      }),
    ).toEqual({ status: "serverError" });
    const fetchAnalysis = vi.fn(stale);
    expect(
      await analyseShownRanking({
        resultFingerprint: "a",
        fetchAnalysis,
        refreshFit: async () => FIT_B,
        stillWanted: () => false,
      }),
    ).toBeNull();
    expect(fetchAnalysis).toHaveBeenCalledTimes(1);
  });
});

type FeedbackFetch = NonNullable<Parameters<typeof sendFeedback>[2]>;

describe("feedback on the page after a 412", () => {
  const body = {
    notice: RESULT_FEEDBACK_NOTICE_VERSION,
    stars: 5,
    locale: "en",
  } as const;

  it("sendFeedback sends the header and maps 412 to stale", async () => {
    const fetchImpl = vi.fn<FeedbackFetch>(async () => ({
      ok: false,
      status: 412,
      json: async () => ({ error: "x" }),
    }));
    expect(
      await sendFeedback(SCAN_ID, body, fetchImpl, FIT_A.resultFingerprint),
    ).toEqual({ ok: false, reason: "stale" });
    expect(
      fetchImpl.mock.calls[0]?.[1]?.headers?.[RESULT_FINGERPRINT_HEADER],
    ).toBe(FIT_A.resultFingerprint);
    expect(failureFromStatus(412, false)).toBe("stale");
  });

  it("without a fingerprint no header is sent", async () => {
    const fetchImpl = vi.fn<FeedbackFetch>(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ stored: true, withdrawable: false }),
    }));
    await sendFeedback(SCAN_ID, body, fetchImpl);
    expect(
      RESULT_FINGERPRINT_HEADER in
        (fetchImpl.mock.calls[0]?.[1]?.headers ?? {}),
    ).toBe(false);
  });

  it("stays on the form with the message, refetches the fit and does not count as sent", () => {
    expect(afterSend({ ok: false, reason: "stale" })).toEqual({
      phase: "form",
      failure: "stale",
      markDone: false,
      refetchFit: true,
    });
    // Nothing else refetches.
    expect(afterSend({ ok: true, withdrawable: false }).refetchFit).toBe(false);
    expect(afterSend({ ok: false, reason: "conflict" }).refetchFit).toBe(false);
    expect(afterSend({ ok: false, reason: "network" }).refetchFit).toBe(false);
  });

  it("shows the draft (暫訂) message in both languages", () => {
    expect(
      failureText(
        "stale",
        resultFeedbackCopy("zh-TW"),
        questionnaireCopy("zh-TW"),
      ),
    ).toBe("結果已經更新，請先看一下新的排名再評分。");
    expect(
      failureText("stale", resultFeedbackCopy("en"), questionnaireCopy("en")),
    ).toBe(
      "Your results have changed. Please look at the new ranking before rating.",
    );
  });
});

// --- the results page's wiring (review 2026-10-21: acceptance 7) ---------------

describe("the feedback sheet's submit (submitFeedback)", () => {
  function sheet(result: SendResult) {
    const state: {
      phase: SheetPhase;
      failure: SendFailure | null;
      phases: SheetPhase[];
    } = { phase: "form", failure: null, phases: [] };
    const send = vi.fn<FeedbackSubmitIo["send"]>(async () => result);
    const markDone = vi.fn();
    const emitSubmitted = vi.fn();
    const onResultChanged = vi.fn();
    const io: FeedbackSubmitIo = {
      send,
      markDone,
      setFailure: (f) => {
        state.failure = f;
      },
      setPhase: (p) => {
        state.phase = p;
        state.phases.push(p);
      },
      emitSubmitted,
      onResultChanged,
    };
    return { state, io, send, markDone, emitSubmitted, onResultChanged };
  }
  const input = {
    scanId: SCAN_ID,
    phase: "form" as SheetPhase,
    stars: 4,
    comment: "  fits well  ",
    locale: "zh-TW" as const,
    resultFingerprint: FIT_A.resultFingerprint,
  };

  it("412: sends once with the fingerprint on screen, asks the page to refetch once, stays on the form", async () => {
    const s = sheet({ ok: false, reason: "stale" });
    await submitFeedback(input, s.io);
    expect(s.send).toHaveBeenCalledTimes(1);
    expect(s.send.mock.calls[0]?.[0]).toBe(SCAN_ID);
    expect(s.send.mock.calls[0]?.[2]).toBe(FIT_A.resultFingerprint);
    expect(s.send.mock.calls[0]?.[1]).toMatchObject({
      stars: 4,
      comment: "fits well",
    });
    expect(s.onResultChanged).toHaveBeenCalledTimes(1);
    expect(s.state.phases).toEqual(["sending", "form"]);
    expect(s.state.failure).toBe("stale");
    expect(s.markDone).not.toHaveBeenCalled();
    expect(s.emitSubmitted).not.toHaveBeenCalled();
    // The stars and the comment are the sheet's own state: submitFeedback has
    // no setter for them, so they stay for the person's second send.
  });

  it("stored: no refetch, marked done, the event sent, thanks", async () => {
    const s = sheet({ ok: true, withdrawable: false });
    await submitFeedback(input, s.io);
    expect(s.onResultChanged).not.toHaveBeenCalled();
    expect(s.markDone).toHaveBeenCalledWith(SCAN_ID);
    expect(s.emitSubmitted).toHaveBeenCalledTimes(1);
    expect(s.state.phase).toBe("thanks");
  });

  it("other failures do not refetch", async () => {
    for (const reason of ["network", "conflict", "rate_limited"] as const) {
      const s = sheet({ ok: false, reason });
      await submitFeedback(input, s.io);
      expect(s.onResultChanged).not.toHaveBeenCalled();
    }
  });

  it("without a fingerprint none is sent; while sending, or without stars, nothing is sent", async () => {
    const plain = sheet({ ok: true, withdrawable: false });
    await submitFeedback({ ...input, resultFingerprint: undefined }, plain.io);
    expect(plain.send).toHaveBeenCalledTimes(1);
    expect(plain.send.mock.calls[0]?.[2]).toBeUndefined();

    const busy = sheet({ ok: true, withdrawable: false });
    await submitFeedback({ ...input, phase: "sending" }, busy.io);
    expect(busy.send).not.toHaveBeenCalled();

    const noStars = sheet({ ok: true, withdrawable: false });
    await submitFeedback({ ...input, stars: null }, noStars.io);
    expect(noStars.send).not.toHaveBeenCalled();
    expect(noStars.state.failure).toBe("invalid");
  });
});

describe("the provider's shown ranking (shownRanking.ts)", () => {
  const refs = (shown: FitResponse | null): ShownRankingRefs => ({
    shown: { current: shown },
    generation: { current: 0 },
    inflight: { current: null },
  });

  it("the analysis is asked with the fingerprint of the fit on screen", async () => {
    const r = refs(FIT_A);
    const fetchAnalysis = vi.fn(async () => READY);
    await analyseOnScreen({
      shown: r.shown,
      fetchAnalysis,
      refreshFit: async () => FIT_B,
      stillWanted: () => true,
    });
    expect(fetchAnalysis).toHaveBeenCalledWith(FIT_A.resultFingerprint);
  });

  it("412 → the new fit is put on screen → the analysis is asked again with its fingerprint", async () => {
    const r = refs(FIT_A);
    const show = vi.fn();
    const fetchFit = vi.fn(async () => ({
      status: "ready" as const,
      response: FIT_B,
    }));
    const fetchAnalysis = vi
      .fn<(fp: string | undefined) => Promise<AnalysisOutcome>>()
      .mockResolvedValueOnce({ status: "stale" })
      .mockResolvedValueOnce(READY);
    const out = await analyseOnScreen({
      shown: r.shown,
      fetchAnalysis,
      refreshFit: () => refreshShownFit(r, fetchFit, show),
      stillWanted: () => true,
    });
    expect(out).toBe(READY);
    expect(fetchAnalysis.mock.calls.map((c) => c[0])).toEqual([
      FIT_A.resultFingerprint,
      FIT_B.resultFingerprint,
    ]);
    expect(show).toHaveBeenCalledWith(FIT_B);
    expect(r.shown.current).toBe(FIT_B);
    expect(r.inflight.current).toBeNull();
  });

  it("refreshShownFit: one request for two callers; dropped when the scan moved on; a failed fetch keeps the old fit", async () => {
    const r = refs(FIT_A);
    const show = vi.fn();
    let resolve!: (o: { status: "ready"; response: FitResponse }) => void;
    const fetchFit = vi.fn(
      () =>
        new Promise<{ status: "ready"; response: FitResponse }>((res) => {
          resolve = res;
        }),
    );
    const one = refreshShownFit(r, fetchFit, show);
    const two = refreshShownFit(r, fetchFit, show);
    expect(two).toBe(one);
    expect(fetchFit).toHaveBeenCalledTimes(1);
    r.generation.current += 1;
    resolve({ status: "ready", response: FIT_B });
    expect(await one).toBeNull();
    expect(show).not.toHaveBeenCalled();
    expect(r.shown.current).toBe(FIT_A);

    const failed = refs(FIT_A);
    expect(
      await refreshShownFit(
        failed,
        async () => ({ status: "networkError" }),
        show,
      ),
    ).toBeNull();
    expect(failed.shown.current).toBe(FIT_A);
  });

  it("the sheet's 412 (refreshThenReanalyse): asks the analysis again only when it was asked already and the refresh worked", async () => {
    const reanalyse = vi.fn();
    await refreshThenReanalyse({
      refreshNow: async () => FIT_B,
      analysisStarted: () => true,
      reanalyse,
    });
    expect(reanalyse).toHaveBeenCalledTimes(1);

    const notAsked = vi.fn();
    await refreshThenReanalyse({
      refreshNow: async () => FIT_B,
      analysisStarted: () => false,
      reanalyse: notAsked,
    });
    expect(notAsked).not.toHaveBeenCalled();

    const failed = vi.fn();
    await refreshThenReanalyse({
      refreshNow: async () => null,
      analysisStarted: () => true,
      reanalyse: failed,
    });
    expect(failed).not.toHaveBeenCalled();
  });
});

// What the provider and the sheet actually call, driven through a fake fetch:
// the header values sent, and the refetch on 412 (review of e1bf2080: the
// source-text checks below alone missed a dropped fingerprint argument).
describe("the page's fetch wiring sends the fingerprint and refetches on 412", () => {
  const headersOf = (init: RequestInit | undefined) =>
    (init?.headers ?? {}) as Record<string, string>;

  it("shownRankingClient: header of the shown fit, 412 → the fit is fetched and shown, then the new fingerprint is sent", async () => {
    const shownFit = await ownedFit();
    const fresh: FitResponse = {
      ...shownFit,
      resultFingerprint: "bbbbbbbbbbbbbbbb",
    };
    const prefs = { gripStyle: "claw" } as const;
    const analysisUrl = analysisPath(SCAN_ID);
    let analysisCalls = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      if (String(url) === analysisUrl) {
        analysisCalls += 1;
        return new Response(JSON.stringify({ error: "x" }), {
          status: analysisCalls === 1 ? 412 : 429,
        });
      }
      return new Response(JSON.stringify(fresh), { status: 200 });
    });
    const refs: ShownRankingRefs = {
      shown: { current: shownFit },
      generation: { current: 0 },
      inflight: { current: null },
    };
    const show = vi.fn();
    const client = shownRankingClient({
      scanId: SCAN_ID,
      preferences: prefs,
      fetchImpl,
      refs,
      show,
    });

    const outcome = await client.analyse(() => true);

    expect(outcome).toEqual({ status: "rateLimited" });
    const calls = fetchImpl.mock.calls;
    expect(calls.map(([url]) => String(url) === analysisUrl)).toEqual([
      true,
      false,
      true,
    ]);
    expect(String(calls[1]?.[0])).toContain(SCAN_ID);
    expect(headersOf(calls[0]?.[1])[RESULT_FINGERPRINT_HEADER]).toBe(
      shownFit.resultFingerprint,
    );
    expect(headersOf(calls[2]?.[1])[RESULT_FINGERPRINT_HEADER]).toBe(
      "bbbbbbbbbbbbbbbb",
    );
    for (const [, init] of calls)
      expect(JSON.parse(String(init?.body))).toEqual(prefs);
    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0]?.[0]?.resultFingerprint).toBe("bbbbbbbbbbbbbbbb");
    expect(refs.shown.current?.resultFingerprint).toBe("bbbbbbbbbbbbbbbb");
  });

  it("shownRankingClient: refreshNow alone fetches the fit and shows it", async () => {
    const shownFit = await ownedFit();
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify(shownFit), { status: 200 }),
    );
    const show = vi.fn();
    const client = shownRankingClient({
      scanId: SCAN_ID,
      preferences: {},
      fetchImpl,
      refs: {
        shown: { current: null },
        generation: { current: 0 },
        inflight: { current: null },
      },
      show,
    });
    expect((await client.refreshNow())?.resultFingerprint).toBe(
      shownFit.resultFingerprint,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).not.toBe(
      analysisPath(SCAN_ID),
    );
    expect(show).toHaveBeenCalledTimes(1);
  });

  it("feedbackSender through submitFeedback: the header carries the shown fingerprint; none without one", async () => {
    const run = async (fingerprint: string | undefined) => {
      const fetchImpl = vi.fn<FeedbackFetch>(async () => ({
        ok: false,
        status: 412,
        json: async () => ({ error: "x" }),
      }));
      const onResultChanged = vi.fn();
      await submitFeedback(
        {
          scanId: SCAN_ID,
          phase: "form",
          stars: 5,
          comment: "",
          locale: "en",
          resultFingerprint: fingerprint,
        },
        {
          send: feedbackSender(fetchImpl),
          markDone: vi.fn(),
          setFailure: vi.fn(),
          setPhase: vi.fn(),
          onResultChanged,
        },
      );
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(fetchImpl.mock.calls[0]?.[0]).toBe(resultFeedbackPath(SCAN_ID));
      return {
        headers: fetchImpl.mock.calls[0]?.[1]?.headers ?? {},
        onResultChanged,
      };
    };
    const sent = await run(FIT_A.resultFingerprint);
    expect(sent.headers[RESULT_FINGERPRINT_HEADER]).toBe(
      FIT_A.resultFingerprint,
    );
    expect(sent.onResultChanged).toHaveBeenCalledTimes(1);
    const plain = await run(undefined);
    expect(RESULT_FINGERPRINT_HEADER in plain.headers).toBe(false);
  });
});

// The repo has no DOM test runtime (no jsdom), so the props that connect the
// tested pieces above are pinned in the source.
describe("the results page's components pass the fingerprint and the refetch", () => {
  const src = (path: string) =>
    readFileSync(path, "utf8").replace(/\r\n/g, "\n");

  it("ResultsView hands the fit's fingerprint and onResultChanged to the sheet", () => {
    const view = src("src/components/results/ResultsView.tsx");
    const sheet = view.slice(view.indexOf("<ResultFeedbackSheet"));
    const tag = sheet.slice(0, sheet.indexOf("/>"));
    expect(tag).toContain("resultFingerprint={response.resultFingerprint}");
    expect(tag).toContain("onResultChanged={onResultChanged}");
  });

  it("the main page passes the provider's refreshFit as onResultChanged", () => {
    expect(src("src/app/results/[scanId]/ResultsRankClient.tsx")).toContain(
      "onResultChanged={scan.refreshFit}",
    );
  });

  it("the provider builds shownRankingClient with the real fetch and analyses through it", () => {
    const provider = src("src/app/results/[scanId]/ResultsScanProvider.tsx");
    const call = provider.slice(provider.indexOf("shownRankingClient({"));
    const block = call.slice(0, call.indexOf("});"));
    expect(block).toMatch(/^\s*scanId,$/m);
    expect(block).toMatch(/^\s*preferences: PREFERENCES,$/m);
    expect(block).toMatch(/^\s*fetchImpl: fetch,$/m);
    expect(block).toMatch(/^\s*refs,$/m);
    expect(provider).toMatch(
      /shown: shownFitRef,\s*generation: fitGenerationRef,\s*inflight: refreshInflightRef,/,
    );
    // The one analysis call and the one refresh both go through the client.
    expect(provider.match(/rankingClient\.analyse\(/g)).toHaveLength(1);
    expect(provider).toContain(
      "const refreshFitNow = rankingClient.refreshNow;",
    );
    expect(provider).not.toMatch(/\bfetchAnalysisResult\b|\banalyseOnScreen\b/);
    expect(provider).toContain("refreshThenReanalyse({");
    expect(provider).toContain("refreshNow: refreshFitNow,");
    expect(provider).toContain(
      "analysisStarted: () => analysisStartedRef.current",
    );
  });

  it("the sheet sends through submitFeedback from the button only, with the fingerprint and onResultChanged", () => {
    const sheet = src("src/components/results/ResultFeedbackSheet.tsx");
    const call = sheet.slice(sheet.indexOf("submitFeedback(\n"));
    const block = call.slice(0, call.indexOf("\n    );"));
    expect(block).toMatch(/^\s*resultFingerprint,$/m);
    expect(block).toMatch(/^\s*onResultChanged,$/m);
    // The send is the tested forwarder (header checked through a fake fetch).
    expect(block).toMatch(/^\s*send: feedbackSender\(\),$/m);
    expect(sheet).not.toMatch(/\bsendFeedback\b/);
    // One call site, reached only from the submit button.
    expect(sheet.match(/submitFeedback\(\n/g)).toHaveLength(1);
    expect(sheet.match(/\bsubmit\(\)/g)).toHaveLength(1);
    expect(sheet).toContain("onSubmit={() => void submit()}");
    // No effect reruns on a new fingerprint (that could send by itself).
    for (const deps of sheet.matchAll(/\}, \[([^\]]*)\]\);/g))
      expect(deps[1]).not.toMatch(/resultFingerprint|onResultChanged/);
  });
});
