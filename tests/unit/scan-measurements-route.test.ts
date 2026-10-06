import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The route file wires the real pieces (the Drizzle repo, the DB-backed
 * limiter, `auth()`) to `handleScanMeasurements`. Those pieces are replaced;
 * what is under test is the wiring: the limiter's key prefix and numbers are
 * pinned, so the viewer's read neither shares a counter with another route nor
 * quietly gets a different budget.
 */
vi.mock("server-only", () => ({}));

const createDrizzleRateLimiter = vi.fn();
const createDrizzleScanRepo = vi.fn();
const findOwnedScan = vi.fn();
vi.mock("../../src/auth", () => ({ auth: async () => null }));
vi.mock("../../src/server/analysis/drizzle-rate-limiter", () => ({
  createDrizzleRateLimiter: (options: unknown) => {
    createDrizzleRateLimiter(options);
    return { allow: () => true };
  },
}));
vi.mock("../../src/server/scans/drizzle-repo", () => ({
  createDrizzleScanRepo: () => {
    createDrizzleScanRepo();
    return { findOwnedScan };
  },
}));

import { GET } from "../../src/app/api/scans/[scanId]/measurements/route";
import {
  FIT_RATE_LIMIT_MAX,
  FIT_RATE_LIMIT_WINDOW_MS,
} from "../../src/server/scans/rate-limit-config";

const SCAN_ID = "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f";

const call = () =>
  GET(
    new Request(`https://example.test/api/scans/${SCAN_ID}/measurements`, {
      headers: { "x-vercel-forwarded-for": "203.0.113.45" },
    }),
    { params: Promise.resolve({ scanId: SCAN_ID }) },
  );

afterEach(() => {
  createDrizzleRateLimiter.mockReset();
  createDrizzleScanRepo.mockReset();
  findOwnedScan.mockReset();
});

describe("app/api/scans/[scanId]/measurements/route.ts", () => {
  it("limits per IP with the fit route's window and count, under its own key prefix", async () => {
    findOwnedScan.mockResolvedValue(null);

    await call();

    expect(createDrizzleRateLimiter).toHaveBeenCalledTimes(1);
    expect(createDrizzleRateLimiter).toHaveBeenCalledWith({
      windowMs: FIT_RATE_LIMIT_WINDOW_MS,
      limit: FIT_RATE_LIMIT_MAX,
      keyPrefix: "measurements:",
    });
  });

  it("does not share a counter: no other route uses the prefix `measurements:`, and no two routes share any prefix", () => {
    // Each prefix is hashed with the IP into one stored row; the same prefix
    // would mean the same row, so one route's requests would spend another's
    // budget. (The analysis route's global cap passes "" on purpose: its own
    // key text carries the namespace.)
    const prefixes: { file: string; prefix: string }[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (entry === "route.ts") {
          const source = readFileSync(path, "utf8");
          for (const match of source.matchAll(/keyPrefix:\s*"([^"]*)"/g))
            prefixes.push({ file: path, prefix: match[1]! });
        }
      }
    };
    walk(join(process.cwd(), "src", "app", "api"));

    const named = prefixes.filter((p) => p.prefix !== "");
    // Not an exact list: another route may add its own prefix.
    expect(named.filter((p) => p.prefix === "measurements:")).toHaveLength(1);
    expect(new Set(named.map((p) => p.prefix)).size).toBe(named.length);
  });

  it("answers through the service: an unknown scan is a 404 with no-store", async () => {
    findOwnedScan.mockResolvedValue(null);

    const res = await call();

    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(findOwnedScan).toHaveBeenCalledTimes(1);
  });
});
