import { describe, expect, it, vi } from "vitest";
import { fitResponseSchema } from "../../src/lib/contracts/fit";
import { computeFitForScan } from "../../src/server/fit/service";
import {
  createFakeFitRepo,
  createFakeScanRepo,
  sampleOwnedScan,
} from "./fixtures/fake-fit-deps";

const SCAN_ID = "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f";

function fitRequest(body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/scans/${SCAN_ID}/fit`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("POST /api/scans/{scanId}/fit — ownership: 404, never 403", () => {
  it("a malformed (non-UUID) scan id is 404 and never reaches the repo", async () => {
    const findOwnedScan = vi.fn(async () => null);
    const scanRepo = createFakeScanRepo(findOwnedScan);
    const { repo: fitRepo } = createFakeFitRepo();

    const res = await computeFitForScan(fitRequest({}), "not-a-uuid", {
      scanRepo,
      fitRepo,
      getUserId: async () => null,
    });

    expect(res.status).toBe(404);
    expect(findOwnedScan).not.toHaveBeenCalled();
  });

  it("an unknown scan id is 404", async () => {
    const { repo: scanRepo } = { repo: createFakeScanRepo() };
    const { repo: fitRepo } = createFakeFitRepo();

    const res = await computeFitForScan(fitRequest({}), SCAN_ID, {
      scanRepo,
      fitRepo,
      getUserId: async () => null,
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Scan not found." });
  });

  it("a scan belonging to a different anonymous session is 404", async () => {
    const scanRepo = createFakeScanRepo(vi.fn(async () => null));
    const { repo: fitRepo } = createFakeFitRepo();

    const res = await computeFitForScan(
      fitRequest({}, { cookie: "scan_session=someone-elses-session" }),
      SCAN_ID,
      { scanRepo, fitRepo, getUserId: async () => null },
    );

    expect(res.status).toBe(404);
  });

  it("an expired anonymous scan is 404", async () => {
    const scanRepo = createFakeScanRepo(vi.fn(async () => null));
    const { repo: fitRepo } = createFakeFitRepo();

    const res = await computeFitForScan(
      fitRequest({}, { cookie: "scan_session=expired-session" }),
      SCAN_ID,
      { scanRepo, fitRepo, getUserId: async () => null },
    );

    expect(res.status).toBe(404);
  });

  it("a signed-in user can fetch their own scan from a browser with no scan-session cookie at all", async () => {
    const findOwnedScan = vi.fn(async () => sampleOwnedScan);
    const scanRepo = createFakeScanRepo(findOwnedScan);
    const { repo: fitRepo } = createFakeFitRepo();

    const res = await computeFitForScan(fitRequest({}), SCAN_ID, {
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
});

describe("POST /api/scans/{scanId}/fit — a successful fit", () => {
  it("200s with a body that passes fitResponseSchema.parse", async () => {
    const scanRepo = createFakeScanRepo(vi.fn(async () => sampleOwnedScan));
    const { repo: fitRepo } = createFakeFitRepo();

    const res = await computeFitForScan(fitRequest({}), SCAN_ID, {
      scanRepo,
      fitRepo,
      getUserId: async () => null,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(() => fitResponseSchema.parse(body)).not.toThrow();
    expect(body.scanId).toBe(SCAN_ID);
  });

  it("persists fit_results rows through the injected fitRepo", async () => {
    const scanRepo = createFakeScanRepo(vi.fn(async () => sampleOwnedScan));
    const { repo: fitRepo, saveFitResultsCalls } = createFakeFitRepo();

    const res = await computeFitForScan(fitRequest({}), SCAN_ID, {
      scanRepo,
      fitRepo,
      getUserId: async () => null,
    });
    const body = await res.json();

    expect(saveFitResultsCalls).toHaveLength(1);
    expect(saveFitResultsCalls[0]).toHaveLength(body.results.length);
  });

  it("repeating the same request is idempotent — no unique-violation, no error", async () => {
    const scanRepo = createFakeScanRepo(vi.fn(async () => sampleOwnedScan));
    const { repo: fitRepo, saveFitResultsCalls } = createFakeFitRepo();

    const first = await computeFitForScan(fitRequest({}), SCAN_ID, {
      scanRepo,
      fitRepo,
      getUserId: async () => null,
    });
    const second = await computeFitForScan(fitRequest({}), SCAN_ID, {
      scanRepo,
      fitRepo,
      getUserId: async () => null,
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(saveFitResultsCalls).toHaveLength(2);
  });

  it("every response carries cache-control: no-store", async () => {
    const scanRepo = createFakeScanRepo(vi.fn(async () => sampleOwnedScan));
    const { repo: fitRepo } = createFakeFitRepo();

    const res = await computeFitForScan(fitRequest({}), SCAN_ID, {
      scanRepo,
      fitRepo,
      getUserId: async () => null,
    });

    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("POST /api/scans/{scanId}/fit — fitPreferencesSchema validation", () => {
  it("{} is valid and means no preferences", async () => {
    const scanRepo = createFakeScanRepo(vi.fn(async () => sampleOwnedScan));
    const { repo: fitRepo } = createFakeFitRepo();

    const res = await computeFitForScan(fitRequest({}), SCAN_ID, {
      scanRepo,
      fitRepo,
      getUserId: async () => null,
    });

    expect(res.status).toBe(200);
  });

  it("an empty body (no bytes at all) is treated the same as {}", async () => {
    const scanRepo = createFakeScanRepo(vi.fn(async () => sampleOwnedScan));
    const { repo: fitRepo } = createFakeFitRepo();

    const res = await computeFitForScan(fitRequest(undefined), SCAN_ID, {
      scanRepo,
      fitRepo,
      getUserId: async () => null,
    });

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

      const res = await computeFitForScan(fitRequest(body), SCAN_ID, {
        scanRepo,
        fitRepo,
        getUserId: async () => null,
      });

      expect(res.status).toBe(400);
      const responseBody = await res.json();
      expect(Array.isArray(responseBody.issues)).toBe(true);
      expect(responseBody.issues.length).toBeGreaterThan(0);
      expect(findOwnedScan).not.toHaveBeenCalled();
    },
  );

  it("400s on invalid JSON in the body", async () => {
    const scanRepo = createFakeScanRepo(vi.fn(async () => sampleOwnedScan));
    const { repo: fitRepo } = createFakeFitRepo();
    const request = new Request(`http://localhost/api/scans/${SCAN_ID}/fit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });

    const res = await computeFitForScan(request, SCAN_ID, {
      scanRepo,
      fitRepo,
      getUserId: async () => null,
    });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/scans/{scanId}/fit — oversized body", () => {
  it("413s before ever touching the repos", async () => {
    const findOwnedScan = vi.fn(async () => sampleOwnedScan);
    const scanRepo = createFakeScanRepo(findOwnedScan);
    const loadCatalogue = vi.fn(async () => []);
    const fitRepo = { loadCatalogue, saveFitResults: vi.fn(async () => {}) };
    const request = new Request(`http://localhost/api/scans/${SCAN_ID}/fit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "x".repeat(20 * 1024),
    });

    const res = await computeFitForScan(request, SCAN_ID, {
      scanRepo,
      fitRepo,
      getUserId: async () => null,
    });

    expect(res.status).toBe(413);
    expect(findOwnedScan).not.toHaveBeenCalled();
    expect(loadCatalogue).not.toHaveBeenCalled();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("POST /api/scans/{scanId}/fit — an internal failure", () => {
  it("500s without leaking internals when persistence fails", async () => {
    const scanRepo = createFakeScanRepo(vi.fn(async () => sampleOwnedScan));
    const { repo: fitRepo } = createFakeFitRepo(undefined, async () => {
      throw new Error("db write failed: connection reset at 10.0.0.5:5432");
    });

    const res = await computeFitForScan(fitRequest({}), SCAN_ID, {
      scanRepo,
      fitRepo,
      getUserId: async () => null,
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("10.0.0.5");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
