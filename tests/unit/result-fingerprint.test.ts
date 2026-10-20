/**
 * V3.2 F1 result fingerprint (candidate, 未拍板; Astra A1-04): the pure
 * fingerprint, what it does and does not read, the fit response carrying it,
 * the analysis and feedback routes refusing a stale ranking with 412 (and
 * nothing else happening), and the results page's client helpers.
 */
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
  sendFeedback,
} from "../../src/lib/results/resultFeedback";
import { failureText } from "../../src/components/results/ResultFeedbackPanel";
import { resultFeedbackCopy } from "../../src/lib/copy/result-feedback";
import { questionnaireCopy } from "../../src/lib/copy/questionnaire";
import {
  createFakeFitRepo,
  createFakeScanRepo,
  sampleCatalogue,
  sampleOwnedScan,
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
  } = {},
): Promise<FitResponse> {
  const { repo: fitRepo } = createFakeFitRepo(sampleCatalogue);
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
