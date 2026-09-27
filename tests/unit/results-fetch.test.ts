import { describe, expect, it, vi } from "vitest";
import {
  deleteScan,
  fetchAnalysisResult,
  fetchFitResult,
  type FitPreferencesInput,
} from "../../src/components/results/fetchResults";
import {
  analysisPath,
  fitPath,
  scanPath,
} from "../../src/lib/contracts/routes";
import highConfidenceFixture from "../../src/components/results/fixtures/high-confidence.json";

const SCAN_ID = "11111111-1111-4111-8111-111111111111";
// The literal `{}` the real page sends — "no preferences", per routes.ts's
// comment on `fitPath`.
const PREFERENCES: FitPreferencesInput = {};

describe("deleteScan", () => {
  it("sends DELETE to this scan's path", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    expect(await deleteScan(SCAN_ID, fetchImpl)).toBe("deleted");
    expect(fetchImpl).toHaveBeenCalledWith(scanPath(SCAN_ID), {
      method: "DELETE",
    });
  });

  it("reports a 404 as notFound (already gone), not as a retryable error", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: "Scan not found." }, { status: 404 }),
    );
    expect(await deleteScan(SCAN_ID, fetchImpl)).toBe("notFound");
  });

  it("never sends a malformed id to the session-wide delete endpoint", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    expect(await deleteScan("session", fetchImpl)).toBe("serverError");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const VALID_ANALYSIS = {
  output: {
    headline: "A close match",
    whyTopPick: "It lines up well with your ideal length and grip width.",
    tradeoffs: [],
    whatToAvoid: [],
    caveats: [],
  },
  source: "fallback" as const,
  cached: false,
};

describe("fetchFitResult", () => {
  it("POSTs the fit route with the given preferences and returns the validated response", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, highConfidenceFixture),
    );

    const outcome = await fetchFitResult(SCAN_ID, PREFERENCES, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      fitPath(SCAN_ID),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(PREFERENCES),
      }),
    );
    expect(outcome.status).toBe("ready");
    if (outcome.status === "ready") {
      expect(outcome.response.scanId).toBe(highConfidenceFixture.scanId);
    }
  });

  it("maps a 404 to notFound — the ownership rule in routes.ts (expired or foreign scans are 404, never 403)", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(404, { error: "Scan not found" }),
    );
    const outcome = await fetchFitResult(SCAN_ID, PREFERENCES, fetchImpl);
    expect(outcome).toEqual({ status: "notFound" });
  });

  it("maps 429 to rateLimited, distinct from a generic serverError (PR #56 review, MEDIUM 2)", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(429, { error: "Too many fit requests" }),
    );
    const outcome = await fetchFitResult(SCAN_ID, PREFERENCES, fetchImpl);
    expect(outcome).toEqual({ status: "rateLimited" });
  });

  it("maps any other non-2xx status to serverError", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, { error: "boom" }));
    const outcome = await fetchFitResult(SCAN_ID, PREFERENCES, fetchImpl);
    expect(outcome).toEqual({ status: "serverError" });
  });

  it("treats a 200 body that fails fitResponseSchema as serverError, never trusting an unvalidated shape", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { not: "a fit response" }),
    );
    const outcome = await fetchFitResult(SCAN_ID, PREFERENCES, fetchImpl);
    expect(outcome).toEqual({ status: "serverError" });
  });

  it("maps a thrown fetch (offline) to networkError", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const outcome = await fetchFitResult(SCAN_ID, PREFERENCES, fetchImpl);
    expect(outcome).toEqual({ status: "networkError" });
  });
});

describe("fetchAnalysisResult", () => {
  it("POSTs the analysis route with the same preferences and returns the validated response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, VALID_ANALYSIS));

    const outcome = await fetchAnalysisResult(SCAN_ID, PREFERENCES, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      analysisPath(SCAN_ID),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(PREFERENCES),
      }),
    );
    expect(outcome).toEqual({ status: "ready", response: VALID_ANALYSIS });
  });

  it("maps 429 to rateLimited, distinct from a generic serverError", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(429, { error: "Too many requests" }),
    );
    const outcome = await fetchAnalysisResult(SCAN_ID, PREFERENCES, fetchImpl);
    expect(outcome).toEqual({ status: "rateLimited" });
  });

  it("maps a 5xx to serverError", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, { error: "boom" }));
    const outcome = await fetchAnalysisResult(SCAN_ID, PREFERENCES, fetchImpl);
    expect(outcome).toEqual({ status: "serverError" });
  });

  it("treats a 200 body that fails analysisResponseSchema as serverError", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { output: {} }));
    const outcome = await fetchAnalysisResult(SCAN_ID, PREFERENCES, fetchImpl);
    expect(outcome).toEqual({ status: "serverError" });
  });

  it("maps a thrown fetch (offline) to networkError", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const outcome = await fetchAnalysisResult(SCAN_ID, PREFERENCES, fetchImpl);
    expect(outcome).toEqual({ status: "networkError" });
  });
});
