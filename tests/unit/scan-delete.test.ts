import { describe, expect, it, vi } from "vitest";
import { handleScanDelete } from "../../src/server/scans/delete";
import type { ScanRepo } from "../../src/server/scans/repo";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-09-23T12:00:00Z");

function fixture(expiresAt = new Date("2026-09-24T12:00:00Z")) {
  const scans = new Set([A, B]);
  const repo: Pick<ScanRepo, "deleteOwnedScan" | "findOwnedScan"> = {
    deleteOwnedScan: vi.fn(async (id, ctx) => {
      const owned =
        ctx.userId === "owner" ||
        (ctx.cookieSessionId === "session-1" && expiresAt > ctx.now);
      if (!owned || !scans.has(id)) return false;
      scans.delete(id);
      return true;
    }),
    findOwnedScan: vi.fn(async (id, ctx) =>
      scans.has(id) &&
      (ctx.userId === "owner" ||
        (ctx.cookieSessionId === "session-1" && expiresAt > ctx.now))
        ? {
            hand: "right" as const,
            gripStyleStated: null,
            measurements: {
              handLengthMm: 190,
              palmLengthMm: 108,
              palmWidthMm: 84,
            },
          }
        : null,
    ),
  };
  const request = (cookie?: string) =>
    new Request("http://localhost/api/scans/" + B, {
      method: "DELETE",
      headers: cookie ? { cookie: `scan_session=${cookie}` } : {},
    });
  return { repo, scans, request };
}

describe("handleScanDelete", () => {
  it("deletes B while A remains resolvable in the same anonymous session; second delete is 404", async () => {
    const { repo, request } = fixture();
    const deps = { repo, getUserId: async () => null, now: () => NOW };
    const first = await handleScanDelete(request("session-1"), B, deps);
    expect(first.status).toBe(204);
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(
      await repo.findOwnedScan(A, {
        userId: null,
        cookieSessionId: "session-1",
        now: NOW,
      }),
    ).not.toBeNull();
    const second = await handleScanDelete(request("session-1"), B, deps);
    expect(second.status).toBe(404);
    expect(await second.json()).toEqual({ error: "Scan not found." });
  });

  it("returns 404 for a foreign scan without deleting it", async () => {
    const { repo, scans, request } = fixture();
    const response = await handleScanDelete(request("foreign"), B, {
      repo,
      getUserId: async () => null,
      now: () => NOW,
    });
    expect(response.status).toBe(404);
    expect(scans.has(B)).toBe(true);
  });

  it("returns 404 for an expired anonymous session", async () => {
    const { repo, scans, request } = fixture(new Date("2026-09-23T11:59:59Z"));
    const response = await handleScanDelete(request("session-1"), B, {
      repo,
      getUserId: async () => null,
      now: () => NOW,
    });
    expect(response.status).toBe(404);
    expect(scans.has(B)).toBe(true);
  });

  it("rejects malformed ids before auth or repo access", async () => {
    const { repo, request } = fixture();
    const getUserId = vi.fn(async () => "owner");
    const response = await handleScanDelete(request(), "session", {
      repo,
      getUserId,
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Scan not found." });
    expect(getUserId).not.toHaveBeenCalled();
    expect(repo.deleteOwnedScan).not.toHaveBeenCalled();
  });

  it("allows a signed-in owner without the original cookie", async () => {
    const { repo, request } = fixture();
    const response = await handleScanDelete(request(), B, {
      repo,
      getUserId: async () => "owner",
      now: () => NOW,
    });
    expect(response.status).toBe(204);
  });
});
