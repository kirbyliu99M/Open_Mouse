import { describe, expect, it } from "vitest";
import {
  ANALYSIS_SOURCES,
  analysisResponseSchema,
} from "../../src/lib/contracts/analysis";
import {
  analysisPath,
  errorResponseSchema,
  fitPath,
  resultsPagePath,
  SCAN_SUBMIT_PATH,
  scanSubmitResponseSchema,
} from "../../src/lib/contracts/routes";
import { analysisOutputSchema as serverSchema } from "../../src/server/analysis/schema";
import { analysisOutputSchema as contractSchema } from "../../src/lib/contracts/analysis";

const output = {
  headline: "A close match for your palm grip",
  whyTopPick: "Its length lands close to your ideal.",
  tradeoffs: ["It runs slightly heavier than you asked for."],
  whatToAvoid: [],
  caveats: [],
};

const SCAN_ID = "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f";

describe("analysisResponseSchema", () => {
  it("accepts a model-written response", () => {
    expect(
      analysisResponseSchema.safeParse({
        output,
        source: "model",
        cached: false,
      }).success,
    ).toBe(true);
  });

  it("accepts a fallback response", () => {
    expect(
      analysisResponseSchema.safeParse({
        output,
        source: "fallback",
        cached: true,
      }).success,
    ).toBe(true);
  });

  it("requires source, so fallback text cannot pass as model prose", () => {
    expect(
      analysisResponseSchema.safeParse({ output, cached: false }).success,
    ).toBe(false);
  });

  it("rejects an unknown source", () => {
    expect(
      analysisResponseSchema.safeParse({
        output,
        source: "gemini",
        cached: false,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(
      analysisResponseSchema.safeParse({
        output,
        source: "model",
        cached: false,
        score: 88,
      }).success,
    ).toBe(false);
  });

  it("enumerates exactly the two sources", () => {
    expect([...ANALYSIS_SOURCES]).toEqual(["model", "fallback"]);
  });
});

describe("analysis output has one source of truth", () => {
  it("the server module re-exports the contract schema, not a copy", () => {
    expect(serverSchema).toBe(contractSchema);
  });
});

describe("routes", () => {
  it("builds the scan-scoped paths", () => {
    expect(SCAN_SUBMIT_PATH).toBe("/api/scans");
    expect(fitPath(SCAN_ID)).toBe(`/api/scans/${SCAN_ID}/fit`);
    expect(analysisPath(SCAN_ID)).toBe(`/api/scans/${SCAN_ID}/analysis`);
    expect(resultsPagePath(SCAN_ID)).toBe(`/results/${SCAN_ID}`);
  });

  it("encodes a hostile scan id instead of letting it change the path", () => {
    expect(fitPath("../../account")).toBe("/api/scans/..%2F..%2Faccount/fit");
    expect(resultsPagePath("a/b?c")).toBe("/results/a%2Fb%3Fc");
  });

  it("scanSubmitResponseSchema requires a UUID", () => {
    expect(
      scanSubmitResponseSchema.safeParse({ scanId: SCAN_ID }).success,
    ).toBe(true);
    expect(
      scanSubmitResponseSchema.safeParse({ scanId: "not-a-uuid" }).success,
    ).toBe(false);
  });

  it("encodes a fragment marker too", () => {
    expect(fitPath("a#b")).toBe("/api/scans/a%23b/fit");
  });

  it("errorResponseSchema accepts field-level issues on a 400", () => {
    expect(
      errorResponseSchema.safeParse({
        error: "Invalid scan submission.",
        issues: [{ path: "measurements.palmWidthMm", message: "Too small" }],
      }).success,
    ).toBe(true);
  });

  it("errorResponseSchema rejects a malformed issue", () => {
    expect(
      errorResponseSchema.safeParse({
        error: "Invalid scan submission.",
        issues: [{ path: "x" }],
      }).success,
    ).toBe(false);
  });

  it("errorResponseSchema requires a non-empty message and nothing else", () => {
    expect(
      errorResponseSchema.safeParse({ error: "Scan not found." }).success,
    ).toBe(true);
    expect(errorResponseSchema.safeParse({ error: "" }).success).toBe(false);
    expect(
      errorResponseSchema.safeParse({ error: "x", stack: "at foo" }).success,
    ).toBe(false);
  });
});
