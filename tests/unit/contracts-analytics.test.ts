import { describe, expect, it } from "vitest";
import {
  ANALYTICS_COUNT_CAP,
  analyticsEventSchemas,
  redactAnalyticsPath,
} from "../../src/lib/contracts/analytics";

const READY = {
  state: "ready",
  page: "main",
  rank: 1,
  filtered: false,
  overallRank: 1,
  poorFit: false,
} as const;
const SCAN_ID = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b";

describe("analyticsEventSchemas", () => {
  it("accepts the documented shape of each event", () => {
    // The results-page events of 2026-10-13 are in contracts-analytics-results.test.ts.
    const ok: Partial<Record<keyof typeof analyticsEventSchemas, unknown>> = {
      $pageview: {},
      home_cta_clicked: { cta: "scan" },
      scan_entry_shown: { flow: "easy", device: "in-app" },
      camera_permission_result: { flow: "easy", result: "denied" },
      scan_capture_attempted: { flow: "easy", method: "takePhoto", attempt: 1 },
      scan_rejected: {
        flow: "easy",
        attempt: 2,
        codes: ["HAND_NOT_DETECTED", "LOW_SHARPNESS"],
      },
      scan_measured: { flow: "sheet", attempt: 3, paper: "manual" },
      scan_quality: {
        flow: "easy",
        attempt: 2,
        method: "canvas",
        focalSource: "none",
        parallaxCorrected: false,
        sharpness: "near_gate",
        resolution: "from_1920",
        edgeFit: "under_0_5_mm",
        paperSkew: "from_3_to_6",
        paperAspect: "under_2_pct",
        priorEffect: "lower_5_plus",
      },
      scan_submitted: { flow: "easy" },
      scan_submit_failed: { flow: "easy", kind: "rateLimited" },
      analysis_shown: { outcome: "fallback" },
      analysis_retry_clicked: {},
      scan_deleted: {},
    };
    for (const [name, props] of Object.entries(ok)) {
      const schema =
        analyticsEventSchemas[name as keyof typeof analyticsEventSchemas];
      expect(schema.safeParse(props).success, name).toBe(true);
    }
  });

  it("refuses a property the contract does not list, on every event", () => {
    for (const [name, schema] of Object.entries(analyticsEventSchemas)) {
      for (const key of ["handLengthMm", "scanId", "sessionId", "email"]) {
        const extra = { [key]: "x" };
        expect(schema.safeParse(extra).success, `${name}.${key}`).toBe(false);
      }
    }
  });

  it("refuses a scan ID where a mouse slug goes", () => {
    const viewed = analyticsEventSchemas.results_page_viewed;
    expect(viewed.safeParse({ ...READY, mouse: SCAN_ID }).success).toBe(false);
    expect(
      viewed.safeParse({ ...READY, mouse: SCAN_ID.toUpperCase() }).success,
    ).toBe(false);
  });

  it("caps counts and refuses fractions and negatives", () => {
    const measured = analyticsEventSchemas.scan_measured;
    const at = (attempt: number) =>
      measured.safeParse({ flow: "easy", attempt, paper: "detected" }).success;
    expect(at(ANALYTICS_COUNT_CAP)).toBe(true);
    expect(at(ANALYTICS_COUNT_CAP + 1)).toBe(false);
    expect(at(1.5)).toBe(false);
    expect(at(-1)).toBe(false);
    expect(at(0)).toBe(false);
  });

  it("refuses a dashless UUID as a slug, and ready-only fields on other states", () => {
    const viewed = analyticsEventSchemas.results_page_viewed;
    const dashless = SCAN_ID.replaceAll("-", "");
    expect(viewed.safeParse({ ...READY, mouse: dashless }).success).toBe(false);
    expect(
      viewed.safeParse({ state: "notFound", mouse: "logitech-mx-master-3s" })
        .success,
    ).toBe(false);
    expect(viewed.safeParse({ state: "notFound" }).success).toBe(true);
    expect(viewed.safeParse({ state: "ready" }).success).toBe(false);
  });

  it("refuses repeated issue codes", () => {
    const rejected = analyticsEventSchemas.scan_rejected;
    expect(
      rejected.safeParse({ flow: "easy", attempt: 1, codes: ["A_B", "A_B"] })
        .success,
    ).toBe(false);
  });

  it("takes issue codes, not messages", () => {
    const rejected = analyticsEventSchemas.scan_rejected;
    const codes = (c: string[]) =>
      rejected.safeParse({ flow: "easy", attempt: 1, codes: c }).success;
    expect(codes(["PAPER_NOT_FOUND"])).toBe(true);
    expect(codes(["No paper found — retake"])).toBe(false);
    expect(codes(Array(9).fill("UNEXPECTED"))).toBe(false);
  });
});

describe("redactAnalyticsPath", () => {
  it("replaces a scan ID and a learning-kit token with the route pattern", () => {
    expect(redactAnalyticsPath(`/results/${SCAN_ID}`)).toBe(
      "/results/[scanId]",
    );
    expect(
      redactAnalyticsPath(
        `https://open-mouse.vercel.app/results/${SCAN_ID}?x=1`,
      ),
    ).toBe("https://open-mouse.vercel.app/results/[scanId]");
    expect(redactAnalyticsPath("/l/v1/abcDEF123_-xyz")).toBe("/l/v1/[token]");
  });

  it("keeps the demo results page and ordinary paths, without query or fragment", () => {
    expect(redactAnalyticsPath("/results/demo")).toBe("/results/demo");
    expect(redactAnalyticsPath("/scan/easy?debug=1#top")).toBe("/scan/easy");
    expect(redactAnalyticsPath("https://example.com/?q=hand")).toBe(
      "https://example.com/",
    );
  });

  it("returns null for something that is not a URL", () => {
    expect(redactAnalyticsPath("http://")).toBeNull();
  });

  it("redacts the variants a denylist would miss", () => {
    const cases: [string, string | null][] = [
      [`/results//${SCAN_ID}`, "/results/[scanId]"],
      [`/Results/${SCAN_ID}`, "/results/[scanId]"],
      [`/results/${SCAN_ID}/`, "/results/[scanId]"],
      [`/results/${SCAN_ID}/more`, "/results/[scanId]"],
      [`/results;x/${SCAN_ID}`, "/results/[scanId]"],
      [`/results/demo/${SCAN_ID}`, "/results/[scanId]"],
      ["/results/demo-abc", "/results/[scanId]"],
      [`//evil.example/results/${SCAN_ID}`, "/results/[scanId]"],
      [
        `https://user:pw@open-mouse.vercel.app/results/${SCAN_ID}`,
        "https://open-mouse.vercel.app/results/[scanId]",
      ],
      ["/l/v1//abcDEF123_-xyz", "/l/v1/[token]"],
      ["/L/v2/abcDEF123_-xyz", "/l/[version]/[token]"],
      [`/anything/${SCAN_ID.replaceAll("-", "")}`, "/anything/[id]"],
      ["/x/abcdefghijklmnopqrstuvwxyz", "/x/[id]"],
      ["mailto:a@b.c", null],
      ["data:text/plain,hi", null],
      ["/", "/"],
      ["/how-it-works/", "/how-it-works"],
    ];
    for (const [input, expected] of cases) {
      expect(redactAnalyticsPath(input), input).toBe(expected);
    }
  });
});

describe("scan_quality carries conditions, never the hand or the phone", () => {
  const base = {
    flow: "easy",
    attempt: 1,
    method: "canvas",
    focalSource: "homography",
    parallaxCorrected: true,
    sharpness: "clear",
    resolution: "from_1280_to_1919",
    edgeFit: "from_0_5_to_1_mm",
    paperSkew: "under_3",
    paperAspect: "under_2_pct",
    priorEffect: "within_2",
  } as const;
  const schema = analyticsEventSchemas.scan_quality;

  it("accepts the full shape and refuses a missing field", () => {
    expect(schema.safeParse(base).success).toBe(true);
    for (const key of Object.keys(base)) {
      const rest: Record<string, unknown> = { ...base };
      delete rest[key];
      expect(schema.safeParse(rest).success, key).toBe(false);
    }
  });

  it("refuses a number where a bucket belongs, and any property it does not list", () => {
    expect(schema.safeParse({ ...base, sharpness: 61.2 }).success).toBe(false);
    expect(schema.safeParse({ ...base, resolution: 1920 }).success).toBe(false);
    for (const extra of [
      { focalPx: 1082 },
      { focalMm: 26 },
      { userAgent: "Mozilla/5.0" },
      { deviceModel: "SM-S931B" },
      { handLengthMm: 188 },
      { laplacianVariance: 61.2 },
      { scanId: "00000000-0000-4000-8000-000000000000" },
    ]) {
      expect(schema.safeParse({ ...base, ...extra }).success).toBe(false);
    }
  });

  it("refuses an unknown focal source", () => {
    expect(schema.safeParse({ ...base, focalSource: "gps" }).success).toBe(
      false,
    );
  });
});

describe("paperSkew and priorEffect are buckets, and paperSkew is optional only on a rejection", () => {
  it("scan_rejected takes a paperSkew bucket or none, and nothing else new", () => {
    const rejected = analyticsEventSchemas.scan_rejected;
    const base = { flow: "easy", attempt: 1, codes: ["PAPER_NOT_FOUND"] };
    expect(rejected.safeParse(base).success).toBe(true);
    expect(rejected.safeParse({ ...base, paperSkew: "from_9" }).success).toBe(
      true,
    );
    expect(rejected.safeParse({ ...base, paperSkew: 11.4 }).success).toBe(
      false,
    );
    expect(rejected.safeParse({ ...base, paperSkew: "over_12" }).success).toBe(
      false,
    );
    expect(rejected.safeParse({ ...base, tiltDeg: 11 }).success).toBe(false);
  });

  it("scan_quality refuses a millimetre or a degree where a bucket belongs", () => {
    const q = analyticsEventSchemas.scan_quality;
    const ok = {
      flow: "easy",
      attempt: 1,
      method: "canvas",
      focalSource: "none",
      parallaxCorrected: false,
      sharpness: "clear",
      resolution: "from_1920",
      edgeFit: "under_0_5_mm",
      paperSkew: "under_3",
      paperAspect: "from_4_pct",
      priorEffect: "lower_5_plus",
    };
    expect(q.safeParse(ok).success).toBe(true);
    expect(q.safeParse({ ...ok, paperAspect: 0.6627 }).success).toBe(false);
    expect(q.safeParse({ ...ok, paperAspect: "6.3pct" }).success).toBe(false);
    expect(q.safeParse({ ...ok, priorEffect: -5.8 }).success).toBe(false);
    expect(q.safeParse({ ...ok, priorEffect: "lower_6_mm" }).success).toBe(
      false,
    );
    expect(q.safeParse({ ...ok, paperSkew: 7.5 }).success).toBe(false);
    const { priorEffect: _p, ...without } = ok;
    void _p;
    expect(q.safeParse(without).success).toBe(false);
    expect(q.safeParse({ ...ok, shadowHandLengthMm: 183 }).success).toBe(false);
  });
});
