import { describe, expect, it, vi } from "vitest";
import {
  SCAN_SUBMIT_PATH,
  scanSubmitResponseSchema,
} from "../../src/lib/contracts/routes";
import {
  MEASUREMENT_MODEL_VERSION,
  type ScanSubmission,
} from "../../src/lib/contracts/measurement";
import {
  SUBMIT_ERROR_MESSAGES,
  submitScan,
} from "../../src/client/scan/submitScan";

const validSubmission: ScanSubmission = {
  hand: "left",
  gripStyleStated: "palm",
  measurements: {
    handLengthMm: 180,
    palmLengthMm: 100,
    palmWidthMm: 85,
    thumbLengthMm: 60,
    indexLengthMm: 70,
    middleLengthMm: 75,
    ringLengthMm: 70,
    pinkyLengthMm: 55,
  },
  calibration: {
    markerIds: [0, 1, 2, 3],
    reprojectionErrorMm: 0.5,
    cardScaleRatio: 1.002,
    parallaxCorrected: false,
  },
  measurementModelVersion: MEASUREMENT_MODEL_VERSION,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("submitScan — request shape", () => {
  it("POSTs exactly one request to SCAN_SUBMIT_PATH with a JSON body matching the submission and no image data", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(201, { scanId: "123e4567-e89b-12d3-a456-426614174000" }),
    );

    const outcome = await submitScan(validSubmission, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(SCAN_SUBMIT_PATH);
    expect(init).toMatchObject({
      method: "POST",
      credentials: "same-origin",
    });
    expect((init!.headers as Record<string, string>)["content-type"]).toBe(
      "application/json",
    );

    const sentBody = init!.body as string;
    expect(typeof sentBody).toBe("string");
    expect(JSON.parse(sentBody)).toEqual(validSubmission);
    // Hard rule 5, re-asserted at the request level: no image data of any
    // shape ever appears in what this module sends.
    expect(sentBody).not.toMatch(/data:/i);
    expect(sentBody).not.toMatch(/base64/i);
    expect(sentBody).not.toMatch(/blob/i);
    expect(sentBody).not.toMatch(/\bfile\b/i);

    expect(outcome).toEqual({
      status: "success",
      scanId: "123e4567-e89b-12d3-a456-426614174000",
    });
  });

  it("never puts credentials on any other setting", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(201, { scanId: "223e4567-e89b-12d3-a456-426614174001" }),
    );
    await submitScan(validSubmission, fetchImpl);
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(init.credentials).toBe("same-origin");
  });
});

describe("submitScan — success (201)", () => {
  it("parses the body with scanSubmitResponseSchema and returns the scanId", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(201, { scanId: "323e4567-e89b-12d3-a456-426614174002" }),
    );
    const outcome = await submitScan(validSubmission, fetchImpl);
    expect(outcome).toEqual({
      status: "success",
      scanId: "323e4567-e89b-12d3-a456-426614174002",
    });
    // Sanity: the fixture body genuinely satisfies the real contract schema.
    expect(
      scanSubmitResponseSchema.safeParse({
        scanId: "323e4567-e89b-12d3-a456-426614174002",
      }).success,
    ).toBe(true);
  });

  it("falls back to the server-error copy when a 201 body doesn't match scanSubmitResponseSchema", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(201, { notAScanId: 1 }));
    const outcome = await submitScan(validSubmission, fetchImpl);
    expect(outcome).toEqual({
      status: "error",
      kind: "server",
      message: SUBMIT_ERROR_MESSAGES.server,
    });
  });

  it("falls back to the server-error copy when a 201 body isn't valid JSON", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("not json", {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
    );
    const outcome = await submitScan(validSubmission, fetchImpl);
    expect(outcome).toEqual({
      status: "error",
      kind: "server",
      message: SUBMIT_ERROR_MESSAGES.server,
    });
  });
});

describe("submitScan — error paths, distinct copy per kind", () => {
  it("400 — parses a well-formed errorResponseSchema body and surfaces its detail alongside the invalid-scan copy", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(400, {
        error: "Invalid scan submission.",
        issues: [{ path: "measurements.handLengthMm", message: "too small" }],
      }),
    );
    const outcome = await submitScan(validSubmission, fetchImpl);
    expect(outcome).toEqual({
      status: "error",
      kind: "invalid",
      message: SUBMIT_ERROR_MESSAGES.invalid,
      detail: "Invalid scan submission.",
    });
  });

  it("400 — does not trust a malformed body; falls back to its own copy with no detail", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(400, { unexpected: "shape" }),
    );
    const outcome = await submitScan(validSubmission, fetchImpl);
    expect(outcome).toEqual({
      status: "error",
      kind: "invalid",
      message: SUBMIT_ERROR_MESSAGES.invalid,
      detail: undefined,
    });
  });

  it("400 — does not trust a non-JSON body (e.g. an HTML error page from infra)", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("<html>Bad Gateway</html>", {
          status: 400,
          headers: { "content-type": "text/html" },
        }),
    );
    const outcome = await submitScan(validSubmission, fetchImpl);
    expect(outcome.status).toBe("error");
    expect(outcome).toMatchObject({
      kind: "invalid",
      message: SUBMIT_ERROR_MESSAGES.invalid,
    });
  });

  it("413 — distinct copy from 400, regardless of body content", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(413, { error: "Request body too large." }),
    );
    const outcome = await submitScan(validSubmission, fetchImpl);
    expect(outcome).toEqual({
      status: "error",
      kind: "tooLarge",
      message: SUBMIT_ERROR_MESSAGES.tooLarge,
      detail: "Request body too large.",
    });
    expect(SUBMIT_ERROR_MESSAGES.tooLarge).not.toBe(
      SUBMIT_ERROR_MESSAGES.invalid,
    );
  });

  it("429 — distinct, honest copy from server/network/400/413 (PR #56 review, MEDIUM 2)", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(429, { error: "Too many scan submissions." }),
    );
    const outcome = await submitScan(validSubmission, fetchImpl);
    expect(outcome).toEqual({
      status: "error",
      kind: "rateLimited",
      message: SUBMIT_ERROR_MESSAGES.rateLimited,
      detail: "Too many scan submissions.",
    });
    expect(SUBMIT_ERROR_MESSAGES.rateLimited).not.toBe(
      SUBMIT_ERROR_MESSAGES.server,
    );
  });

  it("network failure — fetch itself throwing (offline, DNS failure, etc.) gets its own copy", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const outcome = await submitScan(validSubmission, fetchImpl);
    expect(outcome).toEqual({
      status: "error",
      kind: "network",
      message: SUBMIT_ERROR_MESSAGES.network,
    });
  });

  it("5xx — distinct copy from every other kind", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(503, {}));
    const outcome = await submitScan(validSubmission, fetchImpl);
    expect(outcome).toEqual({
      status: "error",
      kind: "server",
      message: SUBMIT_ERROR_MESSAGES.server,
      detail: undefined,
    });
  });

  it("every error kind has distinct copy from every other kind", () => {
    const values = Object.values(SUBMIT_ERROR_MESSAGES);
    expect(new Set(values).size).toBe(values.length);
  });
});
