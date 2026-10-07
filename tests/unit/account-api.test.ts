import { describe, expect, it, vi } from "vitest";
import {
  handleAccountDeleteAll,
  handleAccountScansList,
} from "../../src/server/account/handlers";
import type { AccountRepo, AccountScan } from "../../src/server/account/repo";

const sampleScan: AccountScan = {
  scanId: "scan-1",
  createdAt: "2026-09-22T00:00:00.000Z",
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
    palmThicknessMm: 30,
    knuckleHeightMm: 20,
    gripApertureMm: 90,
    thumbAngleDeg: 45,
  },
};

function fakeRepo(scans: AccountScan[] = [sampleScan]): AccountRepo {
  return {
    listScans: vi.fn(async () => scans),
    deleteAllScans: vi.fn(async () => scans.length),
  };
}

describe("GET /api/account/scans — an anonymous user never sees /account data", () => {
  it("401s and never touches the repo when there is no signed-in user", async () => {
    const repo = fakeRepo();
    const res = await handleAccountScansList({
      repo,
      getUserId: async () => null,
    });

    expect(res.status).toBe(401);
    expect(repo.listScans).not.toHaveBeenCalled();
  });

  it("returns only the signed-in user's scans, in the export shape", async () => {
    const repo = fakeRepo([sampleScan]);
    const res = await handleAccountScansList({
      repo,
      getUserId: async () => "user-1",
    });

    expect(res.status).toBe(200);
    expect(repo.listScans).toHaveBeenCalledWith("user-1");
    const body = await res.json();
    expect(body).toEqual({
      scans: [
        {
          scanId: "scan-1",
          createdAt: "2026-09-22T00:00:00.000Z",
          hand: "left",
          gripStyleStated: "palm",
          measurements: expect.objectContaining({
            handLengthMm: 180,
            palmLengthMm: 100,
            palmWidthMm: 85,
          }),
        },
      ],
    });
    // Export shape: round-trips through JSON with no undefined/function
    // values, and carries no server-internal fields (no sessionId, userId).
    expect(Object.keys(body.scans[0]).sort()).toEqual(
      ["createdAt", "gripStyleStated", "hand", "measurements", "scanId"].sort(),
    );
  });

  it("is never cacheable — the body is personal hand-measurement data", async () => {
    const repo = fakeRepo([sampleScan]);
    const res = await handleAccountScansList({
      repo,
      getUserId: async () => "user-1",
    });

    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("DELETE /api/account/scans — delete-everything", () => {
  it("401s and never touches the repo when there is no signed-in user", async () => {
    const repo = fakeRepo();
    const res = await handleAccountDeleteAll({
      repo,
      getUserId: async () => null,
    });

    expect(res.status).toBe(401);
    expect(repo.deleteAllScans).not.toHaveBeenCalled();
  });

  it("does not clear any session when nobody is signed in, and clears it once after a delete", async () => {
    const clearSession = vi.fn(async () => {});
    await handleAccountDeleteAll({
      repo: fakeRepo(),
      getUserId: async () => null,
      clearSession,
    });
    expect(clearSession).not.toHaveBeenCalled();

    const res = await handleAccountDeleteAll({
      repo: fakeRepo(),
      getUserId: async () => "user-1",
      clearSession,
    });
    expect(res.status).toBe(200);
    expect(clearSession).toHaveBeenCalledTimes(1);
  });

  it("deletes only the signed-in user's scans and reports the count", async () => {
    const repo = fakeRepo([sampleScan, { ...sampleScan, scanId: "scan-2" }]);
    const res = await handleAccountDeleteAll({
      repo,
      getUserId: async () => "user-1",
    });

    expect(res.status).toBe(200);
    expect(repo.deleteAllScans).toHaveBeenCalledWith("user-1");
    expect(await res.json()).toEqual({ deletedScans: 2 });
  });

  it("is never cacheable — the count is derived from personal data", async () => {
    const repo = fakeRepo([sampleScan]);
    const res = await handleAccountDeleteAll({
      repo,
      getUserId: async () => "user-1",
    });

    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
