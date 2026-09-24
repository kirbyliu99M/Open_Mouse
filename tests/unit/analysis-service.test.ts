import { describe, expect, it, vi } from "vitest";
import { errorResponseSchema } from "../../src/lib/contracts/routes";
import { analysisResponseSchema } from "../../src/lib/contracts/analysis";
import {
  InMemoryAnalysisCache,
  type AnalysisCache,
  type CachedAnalysis,
} from "../../src/server/analysis/cache";
import { FakeTextModel } from "../../src/server/analysis/client";
import type { RateLimiter } from "../../src/server/analysis/handler";
import { computeAnalysisForScan } from "../../src/server/analysis/service";
import {
  createFakeFitRepo,
  createFakeScanRepo,
  sampleOwnedScan,
} from "./fixtures/fake-fit-deps";

const SCAN_ID = "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f";

const CLEAN_ANSWER = JSON.stringify({
  headline: "A strong match for your hand.",
  whyTopPick: "It's a solid pick for your measurements.",
  tradeoffs: [],
  whatToAvoid: [],
  caveats: [],
});

function alwaysAllow(): RateLimiter {
  return { allow: () => true };
}

function analysisRequest(body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/scans/${SCAN_ID}/analysis`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function baseDeps(
  overrides: Partial<Parameters<typeof computeAnalysisForScan>[2]> = {},
) {
  const scanRepo = createFakeScanRepo(vi.fn(async () => sampleOwnedScan));
  const { repo: fitRepo } = createFakeFitRepo();
  return {
    scanRepo,
    fitRepo,
    client: new FakeTextModel({ answer: () => CLEAN_ANSWER }),
    cache: new InMemoryAnalysisCache(),
    limiter: alwaysAllow(),
    globalLimiter: alwaysAllow(),
    getUserId: async () => null,
    ...overrides,
  };
}

describe("POST /api/scans/{scanId}/analysis — ownership: 404, never 403", () => {
  it("a malformed (non-UUID) scan id is 404 and never reaches the repo", async () => {
    const findOwnedScan = vi.fn(async () => null);
    const scanRepo = createFakeScanRepo(findOwnedScan);
    const { repo: fitRepo } = createFakeFitRepo();

    const res = await computeAnalysisForScan(
      analysisRequest({}),
      "not-a-uuid",
      {
        ...baseDeps(),
        scanRepo,
        fitRepo,
      },
    );

    expect(res.status).toBe(404);
    expect(findOwnedScan).not.toHaveBeenCalled();
  });

  it("an unknown scan id is 404 with the same body the fit route returns", async () => {
    const scanRepo = createFakeScanRepo();
    const { repo: fitRepo } = createFakeFitRepo();

    const res = await computeAnalysisForScan(analysisRequest({}), SCAN_ID, {
      ...baseDeps(),
      scanRepo,
      fitRepo,
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Scan not found." });
  });

  it("a scan belonging to a different anonymous session is 404", async () => {
    const scanRepo = createFakeScanRepo(vi.fn(async () => null));
    const { repo: fitRepo } = createFakeFitRepo();

    const res = await computeAnalysisForScan(
      analysisRequest({}, { cookie: "scan_session=someone-elses-session" }),
      SCAN_ID,
      { ...baseDeps(), scanRepo, fitRepo },
    );

    expect(res.status).toBe(404);
  });

  it("an expired anonymous scan is 404", async () => {
    const scanRepo = createFakeScanRepo(vi.fn(async () => null));
    const { repo: fitRepo } = createFakeFitRepo();

    const res = await computeAnalysisForScan(
      analysisRequest({}, { cookie: "scan_session=expired-session" }),
      SCAN_ID,
      { ...baseDeps(), scanRepo, fitRepo },
    );

    expect(res.status).toBe(404);
  });

  it("a signed-in user can analyse their own scan from a browser with no scan-session cookie at all", async () => {
    const findOwnedScan = vi.fn(async () => sampleOwnedScan);
    const scanRepo = createFakeScanRepo(findOwnedScan);
    const { repo: fitRepo } = createFakeFitRepo();

    const res = await computeAnalysisForScan(analysisRequest({}), SCAN_ID, {
      ...baseDeps(),
      scanRepo,
      fitRepo,
      getUserId: async () => "user-1",
    });

    expect(res.status).toBe(200);
    expect(findOwnedScan).toHaveBeenCalledWith(
      SCAN_ID,
      expect.objectContaining({ userId: "user-1", cookieSessionId: null }),
    );
  });

  it("an internal failure while loading the fit is a 500 without leaking internals", async () => {
    const scanRepo = createFakeScanRepo(vi.fn(async () => sampleOwnedScan));
    const { repo: fitRepo } = createFakeFitRepo(undefined, async () => {
      throw new Error("db write failed: connection reset at 10.0.0.5:5432");
    });

    const res = await computeAnalysisForScan(analysisRequest({}), SCAN_ID, {
      ...baseDeps(),
      scanRepo,
      fitRepo,
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("10.0.0.5");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("POST /api/scans/{scanId}/analysis — a successful analysis", () => {
  it("200s with a body that passes analysisResponseSchema.parse", async () => {
    const res = await computeAnalysisForScan(
      analysisRequest({}),
      SCAN_ID,
      baseDeps(),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(() => analysisResponseSchema.parse(body)).not.toThrow();
  });

  it("every response carries cache-control: no-store", async () => {
    const res = await computeAnalysisForScan(
      analysisRequest({}),
      SCAN_ID,
      baseDeps(),
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("POST /api/scans/{scanId}/analysis — with no model key configured", () => {
  it("200s with source: fallback and makes no network request", async () => {
    // `client: null` is exactly what `createAnalysisModel(process.env)`
    // returns when `GEMINI_API_KEY` is unset (today's actual production
    // state, per docs/STATUS.md) — `analyse()` treats it as "no model
    // configured" and never calls `fetch` at all.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await computeAnalysisForScan(analysisRequest({}), SCAN_ID, {
      ...baseDeps(),
      client: null,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("fallback");
    expect(analysisResponseSchema.safeParse(body).success).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("POST /api/scans/{scanId}/analysis — fitPreferencesSchema validation", () => {
  it("{} is valid and means no preferences", async () => {
    const res = await computeAnalysisForScan(
      analysisRequest({}),
      SCAN_ID,
      baseDeps(),
    );
    expect(res.status).toBe(200);
  });

  it("an empty body (no bytes at all) is treated the same as {}", async () => {
    const res = await computeAnalysisForScan(
      analysisRequest(undefined),
      SCAN_ID,
      baseDeps(),
    );
    expect(res.status).toBe(200);
  });

  it.each([
    ["an invalid gripStyle", { gripStyle: "iron-grip" }],
    ["a weightG range with min > max", { weightG: { min: 100, max: 50 } }],
    ["an unrecognized field", { extra: "nope" }],
    ["a non-object body", "not an object"],
  ])(
    "rejects %s with 400 and issues, never touching the repos",
    async (_label, body) => {
      const findOwnedScan = vi.fn(async () => sampleOwnedScan);
      const scanRepo = createFakeScanRepo(findOwnedScan);
      const { repo: fitRepo } = createFakeFitRepo();

      const res = await computeAnalysisForScan(analysisRequest(body), SCAN_ID, {
        ...baseDeps(),
        scanRepo,
        fitRepo,
      });

      expect(res.status).toBe(400);
      const responseBody = await res.json();
      expect(Array.isArray(responseBody.issues)).toBe(true);
      expect(responseBody.issues.length).toBeGreaterThan(0);
      expect(findOwnedScan).not.toHaveBeenCalled();
    },
  );

  it("400s on invalid JSON in the body", async () => {
    const request = new Request(
      `http://localhost/api/scans/${SCAN_ID}/analysis`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      },
    );

    const res = await computeAnalysisForScan(request, SCAN_ID, baseDeps());
    expect(res.status).toBe(400);
  });
});

describe("POST /api/scans/{scanId}/analysis — oversized body", () => {
  it("413s before ever touching the repos", async () => {
    const findOwnedScan = vi.fn(async () => sampleOwnedScan);
    const scanRepo = createFakeScanRepo(findOwnedScan);
    const loadCatalogue = vi.fn(async () => []);
    const fitRepo = { loadCatalogue, saveFitResults: vi.fn(async () => {}) };
    const request = new Request(
      `http://localhost/api/scans/${SCAN_ID}/analysis`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "x".repeat(20 * 1024),
      },
    );

    const res = await computeAnalysisForScan(request, SCAN_ID, {
      ...baseDeps(),
      scanRepo,
      fitRepo,
    });

    expect(res.status).toBe(413);
    expect(findOwnedScan).not.toHaveBeenCalled();
    expect(loadCatalogue).not.toHaveBeenCalled();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("POST /api/scans/{scanId}/analysis — rate limiting", () => {
  it("429s with an errorResponseSchema body when the limiter rejects the request", async () => {
    const res = await computeAnalysisForScan(analysisRequest({}), SCAN_ID, {
      ...baseDeps(),
      limiter: { allow: () => false },
    });

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(errorResponseSchema.safeParse(body).success).toBe(true);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("keys the rate limit on the caller's IP (x-vercel-forwarded-for), not on the scan id", async () => {
    const seen: string[] = [];
    const limiter: RateLimiter = {
      allow: (key) => {
        seen.push(key);
        return true;
      },
    };

    await computeAnalysisForScan(
      analysisRequest({}, { "x-vercel-forwarded-for": "203.0.113.9" }),
      SCAN_ID,
      { ...baseDeps(), limiter },
    );
    // A different scanId, same IP: same key. A caller cannot dodge the
    // limit by rotating scan ids (issue #39).
    const otherScanId = "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8ea0";
    await computeAnalysisForScan(
      analysisRequest({}, { "x-vercel-forwarded-for": "203.0.113.9" }),
      otherScanId,
      { ...baseDeps(), limiter },
    );

    expect(seen).toEqual(["203.0.113.9", "203.0.113.9"]);
  });

  it("trusts x-vercel-forwarded-for over x-forwarded-for", async () => {
    const seen: string[] = [];
    const limiter: RateLimiter = {
      allow: (key) => {
        seen.push(key);
        return true;
      },
    };

    await computeAnalysisForScan(
      analysisRequest(
        {},
        {
          "x-vercel-forwarded-for": "203.0.113.9",
          "x-forwarded-for": "198.51.100.1",
        },
      ),
      SCAN_ID,
      { ...baseDeps(), limiter },
    );

    expect(seen).toEqual(["203.0.113.9"]);
  });

  it("falls back to a shared bucket, never an unlimited one, when no IP header is present", async () => {
    const seen: string[] = [];
    const limiter: RateLimiter = {
      allow: (key) => {
        seen.push(key);
        return true;
      },
    };

    await computeAnalysisForScan(analysisRequest({}), SCAN_ID, {
      ...baseDeps(),
      limiter,
    });

    expect(seen).toEqual(["unknown"]);
  });
});

describe("POST /api/scans/{scanId}/analysis — site-wide daily model cap (M1)", () => {
  it("200s with source: fallback (never 429) once the global cap is hit, and makes no model call", async () => {
    const client = new FakeTextModel({ answer: () => CLEAN_ANSWER });
    const res = await computeAnalysisForScan(analysisRequest({}), SCAN_ID, {
      ...baseDeps(),
      client,
      globalLimiter: { allow: () => false },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("fallback");
    expect(analysisResponseSchema.safeParse(body).success).toBe(true);
    expect(client.calls).toHaveLength(0);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("POST /api/scans/{scanId}/analysis — hard rule: never a malformed 200", () => {
  it("500s instead of returning a 200 body that fails analysisResponseSchema", async () => {
    // A cache that hands back data violating analysisOutputSchema (headline
    // too short) — simulating a bad row somehow reaching the cache — must
    // never be forwarded to the caller as-is.
    const poisonedCache: AnalysisCache = {
      async get(): Promise<CachedAnalysis | null> {
        return {
          output: {
            headline: "",
            whyTopPick: "x",
            tradeoffs: [],
            whatToAvoid: [],
            caveats: [],
          },
          source: "model",
        };
      },
      async set(): Promise<void> {},
    };

    const res = await computeAnalysisForScan(analysisRequest({}), SCAN_ID, {
      ...baseDeps(),
      cache: poisonedCache,
    });

    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
