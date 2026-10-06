import { describe, expect, it, vi } from "vitest";
import { fetchScanMeasurements } from "../../src/components/viewer/fetchMeasurements";

const SCAN_ID = "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f";

const BODY = {
  scanId: SCAN_ID,
  hand: "right",
  measurements: { handLengthMm: 183.4, palmLengthMm: 101.2, palmWidthMm: 84.7 },
};

const respond = (status: number, body?: unknown) =>
  vi.fn(
    async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
      }),
  ) as unknown as typeof fetch;

describe("fetchScanMeasurements", () => {
  it("returns the parsed body for a 200 that matches the contract", async () => {
    const fetchImpl = respond(200, BODY);
    const outcome = await fetchScanMeasurements(SCAN_ID, fetchImpl);
    expect(outcome).toEqual({ status: "ready", response: BODY });
  });

  it("GETs the contract's path with the caller's cookies and nothing in the body", async () => {
    const fetchImpl = respond(200, BODY);
    await fetchScanMeasurements(SCAN_ID, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/scans/${SCAN_ID}/measurements`,
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    );
    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]![1] as RequestInit;
    expect(init.body).toBeUndefined();
  });

  it("encodes a hostile scan id into one path segment", async () => {
    const fetchImpl = respond(404);
    await fetchScanMeasurements("../../x?y#z", fetchImpl);
    const path = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as string;
    expect(path).toBe("/api/scans/..%2F..%2Fx%3Fy%23z/measurements");
  });

  it("maps 404 and 429 to their own outcomes", async () => {
    expect(await fetchScanMeasurements(SCAN_ID, respond(404))).toEqual({
      status: "notFound",
    });
    expect(await fetchScanMeasurements(SCAN_ID, respond(429))).toEqual({
      status: "rateLimited",
    });
  });

  it("maps any other failure, a network error and a bad body to an error, never a throw", async () => {
    expect(await fetchScanMeasurements(SCAN_ID, respond(500))).toEqual({
      status: "error",
    });
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await fetchScanMeasurements(SCAN_ID, offline)).toEqual({
      status: "error",
    });
    const notJson = vi.fn(
      async () => new Response("<html>", { status: 200 }),
    ) as unknown as typeof fetch;
    expect(await fetchScanMeasurements(SCAN_ID, notJson)).toEqual({
      status: "error",
    });
  });

  it("refuses a 200 whose body breaks the contract (an extra field, a null, a palm longer than the hand)", async () => {
    for (const bad of [
      { ...BODY, extra: 1 },
      { ...BODY, measurements: { ...BODY.measurements, thumbLengthMm: null } },
      { ...BODY, measurements: { ...BODY.measurements, palmLengthMm: 200 } },
      { ...BODY, hand: "both" },
      { hand: "right" },
    ]) {
      expect(await fetchScanMeasurements(SCAN_ID, respond(200, bad))).toEqual({
        status: "error",
      });
    }
  });
});
