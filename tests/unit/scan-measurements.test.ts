import { describe, expect, it, vi } from "vitest";
import {
  scanMeasurementsResponseSchema,
  type HandMeasurements,
} from "../../src/lib/contracts/measurement";
import { scanMeasurementsPath } from "../../src/lib/contracts/routes";
import { handleScanMeasurements } from "../../src/server/scans/measurements";
import type { OwnedScan, ScanRepo } from "../../src/server/scans/repo";

const SCAN_ID = "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f";
const MY_SESSION = "11111111-1111-4111-8111-111111111111";
const OTHER_SESSION = "22222222-2222-4222-8222-222222222222";

const FULL: HandMeasurements = {
  handLengthMm: 183.4,
  palmLengthMm: 101.2,
  palmWidthMm: 84.7,
  thumbLengthMm: 61.5,
  indexLengthMm: 72.3,
  middleLengthMm: 79.9,
  ringLengthMm: 74.1,
  pinkyLengthMm: 58.6,
  palmThicknessMm: 31.2,
  knuckleHeightMm: 29.4,
  gripApertureMm: 96.8,
  thumbAngleDeg: 47.5,
};

const REQUIRED_ONLY: HandMeasurements = {
  handLengthMm: 183.4,
  palmLengthMm: 101.2,
  palmWidthMm: 84.7,
};

function owned(
  measurements: HandMeasurements,
  hand: "left" | "right" = "right",
) {
  return {
    hand,
    gripStyleStated: "claw",
    measurements,
  } as OwnedScan;
}

function repoReturning(value: OwnedScan | null): Pick<
  ScanRepo,
  "findOwnedScan"
> & {
  findOwnedScan: ReturnType<typeof vi.fn>;
} {
  return { findOwnedScan: vi.fn(async () => value) };
}

function get(headers: Record<string, string> = {}, scanId = SCAN_ID) {
  return new Request(`http://localhost${scanMeasurementsPath(scanId)}`, {
    method: "GET",
    headers,
  });
}

describe("GET /api/scans/{scanId}/measurements: a successful read", () => {
  it("200s with a body that passes scanMeasurementsResponseSchema, to the 0.1 mm the scan stored", async () => {
    const repo = repoReturning(owned(FULL));

    const res = await handleScanMeasurements(get(), SCAN_ID, {
      repo,
      getUserId: async () => null,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(scanMeasurementsResponseSchema.parse(body)).toEqual({
      scanId: SCAN_ID,
      hand: "right",
      measurements: FULL,
    });
    expect(body.measurements.handLengthMm).toBe(183.4);
  });

  it("reports the hand the scan stored", async () => {
    const res = await handleScanMeasurements(get(), SCAN_ID, {
      repo: repoReturning(owned(FULL, "left")),
      getUserId: async () => null,
    });
    expect((await res.json()).hand).toBe("left");
  });

  it("carries Cache-Control: no-store and a JSON content type", async () => {
    const res = await handleScanMeasurements(get(), SCAN_ID, {
      repo: repoReturning(owned(FULL)),
      getUserId: async () => null,
    });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
  });

  it("never sends anything the contract does not list (no grip style, no ids, no calibration)", async () => {
    const res = await handleScanMeasurements(get(), SCAN_ID, {
      repo: repoReturning(owned(FULL)),
      getUserId: async () => null,
    });
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual([
      "hand",
      "measurements",
      "scanId",
    ]);
    expect(JSON.stringify(body)).not.toContain("claw");
  });
});

describe("GET /api/scans/{scanId}/measurements: absent, never null", () => {
  it("omits optional fields the repo reports as undefined", async () => {
    const res = await handleScanMeasurements(get(), SCAN_ID, {
      repo: repoReturning(owned(REQUIRED_ONLY)),
      getUserId: async () => null,
    });

    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain("null");
    expect(Object.keys(JSON.parse(text).measurements).sort()).toEqual([
      "handLengthMm",
      "palmLengthMm",
      "palmWidthMm",
    ]);
  });

  it("maps a repo's null to an absent field instead of sending null or failing the schema", async () => {
    const withNulls = {
      ...REQUIRED_ONLY,
      thumbLengthMm: null,
      indexLengthMm: null,
      middleLengthMm: 79.9,
      ringLengthMm: null,
      pinkyLengthMm: null,
      palmThicknessMm: null,
      knuckleHeightMm: null,
      gripApertureMm: null,
      thumbAngleDeg: null,
    } as unknown as HandMeasurements;

    const res = await handleScanMeasurements(get(), SCAN_ID, {
      repo: repoReturning(owned(withNulls)),
      getUserId: async () => null,
    });

    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain("null");
    expect(JSON.parse(text).measurements).toEqual({
      ...REQUIRED_ONLY,
      middleLengthMm: 79.9,
    });
  });

  it("keeps a legal zero as a value, not an absence", async () => {
    const res = await handleScanMeasurements(get(), SCAN_ID, {
      repo: repoReturning(
        owned({ ...REQUIRED_ONLY, thumbAngleDeg: 0 } as HandMeasurements),
      ),
      getUserId: async () => null,
    });
    // 0 is a legal angle: it is a value, not an absence.
    expect((await res.json()).measurements.thumbAngleDeg).toBe(0);
  });
});

describe("GET /api/scans/{scanId}/measurements: 404 for everyone who does not own the scan", () => {
  it("an unknown scan is 404 with the same body as every other non-owner", async () => {
    const res = await handleScanMeasurements(get(), SCAN_ID, {
      repo: repoReturning(null),
      getUserId: async () => null,
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Scan not found." });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("a scan in someone else's session is 404 (the repo applies the ownership rule)", async () => {
    const findOwnedScan = vi.fn(
      async (_id: string, ctx: { cookieSessionId: string | null }) =>
        ctx.cookieSessionId === MY_SESSION ? owned(FULL) : null,
    );
    const deps = {
      repo: { findOwnedScan } as Pick<ScanRepo, "findOwnedScan">,
      getUserId: async () => null,
    };

    const foreign = await handleScanMeasurements(
      get({ cookie: `scan_session=${OTHER_SESSION}` }),
      SCAN_ID,
      deps,
    );
    const mine = await handleScanMeasurements(
      get({ cookie: `scan_session=${MY_SESSION}` }),
      SCAN_ID,
      deps,
    );

    expect(foreign.status).toBe(404);
    expect(mine.status).toBe(200);
  });

  it("an expired anonymous scan is 404 (the repo returns null for it)", async () => {
    const res = await handleScanMeasurements(
      get({ cookie: `scan_session=${OTHER_SESSION}` }),
      SCAN_ID,
      { repo: repoReturning(null), getUserId: async () => null },
    );
    expect(res.status).toBe(404);
  });

  it.each([
    ["not a uuid", "not-a-uuid"],
    ["an empty-looking id", "%20"],
    ["a path-like id", "..%2f..%2fsession"],
    ["the sibling static route", "session"],
    ["a uuid with trailing text", `${SCAN_ID}x`],
  ])(
    "a malformed id (%s) is 404 and never reaches the repo",
    async (_name, id) => {
      const repo = repoReturning(owned(FULL));

      const res = await handleScanMeasurements(get({}, id), id, {
        repo,
        getUserId: async () => null,
      });

      expect(res.status).toBe(404);
      expect(repo.findOwnedScan).not.toHaveBeenCalled();
      expect(await res.json()).toEqual({ error: "Scan not found." });
    },
  );

  it("a signed-in owner reads the scan from a browser with no scan-session cookie", async () => {
    const repo = repoReturning(owned(FULL));

    const res = await handleScanMeasurements(get(), SCAN_ID, {
      repo,
      getUserId: async () => "user-1",
    });

    expect(res.status).toBe(200);
    expect(repo.findOwnedScan).toHaveBeenCalledWith(
      SCAN_ID,
      expect.objectContaining({ userId: "user-1", cookieSessionId: null }),
    );
  });

  it("hands the repo the caller's cookie session and the clock's time", async () => {
    const repo = repoReturning(owned(FULL));
    const now = new Date("2026-10-06T08:00:00Z");

    await handleScanMeasurements(
      get({ cookie: `scan_session=${MY_SESSION}` }),
      SCAN_ID,
      {
        repo,
        getUserId: async () => null,
        now: () => now,
      },
    );

    expect(repo.findOwnedScan).toHaveBeenCalledWith(SCAN_ID, {
      userId: null,
      cookieSessionId: MY_SESSION,
      now,
    });
  });
});

describe("GET /api/scans/{scanId}/measurements: per-IP rate limit", () => {
  it("429s with no-store and without asking the repo when the limiter rejects", async () => {
    const repo = repoReturning(owned(FULL));

    const res = await handleScanMeasurements(
      get({ "x-vercel-forwarded-for": "203.0.113.9" }),
      SCAN_ID,
      { repo, getUserId: async () => null, limiter: { allow: () => false } },
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(typeof (await res.json()).error).toBe("string");
    expect(repo.findOwnedScan).not.toHaveBeenCalled();
  });

  it("counts a malformed id against the limit too", async () => {
    const seen: string[] = [];
    await handleScanMeasurements(
      get({ "x-vercel-forwarded-for": "203.0.113.9" }, "nope"),
      "nope",
      {
        repo: repoReturning(null),
        getUserId: async () => null,
        limiter: {
          allow: (key) => {
            seen.push(key);
            return true;
          },
        },
      },
    );
    expect(seen).toEqual(["203.0.113.9"]);
  });

  it("does not limit a request with no usable client IP (local dev)", async () => {
    const res = await handleScanMeasurements(get(), SCAN_ID, {
      repo: repoReturning(owned(FULL)),
      getUserId: async () => null,
      limiter: { allow: () => false },
    });
    expect(res.status).toBe(200);
  });
});

describe("GET /api/scans/{scanId}/measurements: it never sends bad data", () => {
  it("500s with a fixed sentence when the stored values fail the contract", async () => {
    // A palm longer than the hand cannot be a real hand; the schema refuses it.
    const bad = { ...FULL, palmLengthMm: 190 };

    const res = await handleScanMeasurements(get(), SCAN_ID, {
      repo: repoReturning(owned(bad)),
      getUserId: async () => null,
    });

    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "Failed to load measurements." });
    expect(text).not.toContain("190");
  });

  it("500s without leaking internals when the repo throws", async () => {
    const repo = {
      findOwnedScan: vi.fn(async () => {
        throw new Error("connection reset at 10.0.0.5:5432");
      }),
    };

    const res = await handleScanMeasurements(get(), SCAN_ID, {
      repo,
      getUserId: async () => null,
    });

    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("10.0.0.5");
    expect(JSON.parse(text)).toEqual({ error: "Failed to load measurements." });
  });
});
