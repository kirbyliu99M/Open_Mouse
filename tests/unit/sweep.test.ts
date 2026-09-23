import { describe, expect, it, vi } from "vitest";
import type { ScanRepo } from "../../src/server/scans/repo";
import {
  createSweepThrottle,
  SWEEP_THROTTLE_MS,
} from "../../src/server/scans/sweep";

function fakeRepo(): ScanRepo {
  return {
    findValidSession: vi.fn(async () => null),
    createAnonymousSession: vi.fn(async () => ({ id: "s" })),
    insertScanWithMeasurements: vi.fn(async () => ({ scanId: "scan" })),
    deleteSession: vi.fn(async () => {}),
    deleteExpiredAnonymousSessions: vi.fn(async () => 0),
    claimSession: vi.fn(async () => {}),
    findOwnedScan: vi.fn(async () => null),
  };
}

describe("lazy sweep throttle (issue #17 amendment)", () => {
  it("sweeps on the first call", async () => {
    const repo = fakeRepo();
    const throttle = createSweepThrottle();
    await throttle.maybeSweep(repo, new Date("2026-09-22T00:00:00Z"));
    expect(repo.deleteExpiredAnonymousSessions).toHaveBeenCalledTimes(1);
  });

  it("does not sweep again inside the throttle window", async () => {
    const repo = fakeRepo();
    const throttle = createSweepThrottle();
    const t0 = new Date("2026-09-22T00:00:00Z");
    await throttle.maybeSweep(repo, t0);
    await throttle.maybeSweep(
      repo,
      new Date(t0.getTime() + SWEEP_THROTTLE_MS - 1),
    );
    expect(repo.deleteExpiredAnonymousSessions).toHaveBeenCalledTimes(1);
  });

  it("sweeps again once the window has fully elapsed", async () => {
    const repo = fakeRepo();
    const throttle = createSweepThrottle();
    const t0 = new Date("2026-09-22T00:00:00Z");
    await throttle.maybeSweep(repo, t0);
    await throttle.maybeSweep(repo, new Date(t0.getTime() + SWEEP_THROTTLE_MS));
    expect(repo.deleteExpiredAnonymousSessions).toHaveBeenCalledTimes(2);
  });

  it("throttle state is per-throttle-instance, not global", async () => {
    const repoA = fakeRepo();
    const repoB = fakeRepo();
    const throttleA = createSweepThrottle();
    const throttleB = createSweepThrottle();
    const t0 = new Date("2026-09-22T00:00:00Z");
    await throttleA.maybeSweep(repoA, t0);
    await throttleB.maybeSweep(repoB, t0);
    expect(repoA.deleteExpiredAnonymousSessions).toHaveBeenCalledTimes(1);
    expect(repoB.deleteExpiredAnonymousSessions).toHaveBeenCalledTimes(1);
  });

  it("respects a custom interval", async () => {
    const repo = fakeRepo();
    const throttle = createSweepThrottle(5_000);
    const t0 = new Date("2026-09-22T00:00:00Z");
    await throttle.maybeSweep(repo, t0);
    await throttle.maybeSweep(repo, new Date(t0.getTime() + 4_000));
    expect(repo.deleteExpiredAnonymousSessions).toHaveBeenCalledTimes(1);
    await throttle.maybeSweep(repo, new Date(t0.getTime() + 5_000));
    expect(repo.deleteExpiredAnonymousSessions).toHaveBeenCalledTimes(2);
  });
});
