/**
 * The tester photos' retention (src/server/tester/purge.ts, candidate): the
 * batched loop against fakes (bounded, blobs before rows, rows kept) and the
 * hook in the daily cron (src/server/scans/expire-cron.ts), which must not
 * let a tester-purge failure touch the sweeps or the error-photo purge.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const logError = vi.fn();
vi.mock("../../src/server/log", () => ({
  log: { error: (...args: unknown[]) => logError(...args), warn: vi.fn() },
}));

import { handleExpireSessions } from "../../src/server/scans/expire-cron";
import type { ScanRepo } from "../../src/server/scans/repo";
import { purgeTesterPhotos } from "../../src/server/tester/purge";
import type { TesterPhotoRef } from "../../src/server/tester/repo";

describe("purgeTesterPhotos", () => {
  it("asks for rows before the Taipei cutoff day, deletes their blobs first, then NULLs the pathnames", async () => {
    const order: string[] = [];
    const refs: TesterPhotoRef[] = [
      { id: "a", photoPathname: "tester/a.jpg" },
      { id: "b", photoPathname: "tester/b.jpg" },
    ];
    const repo = {
      listPhotosBefore: vi.fn(async () => (order.length === 0 ? refs : [])),
      clearPhotos: vi.fn(async (ids: readonly string[]) => {
        order.push(`clear:${ids.join(",")}`);
        return ids.length;
      }),
      existingPathnames: vi.fn(async () => []),
    };
    const blob = {
      del: vi.fn(async (p: readonly string[]) => {
        order.push(`del:${p.join(",")}`);
      }),
      list: vi.fn(async () => ({ blobs: [], hasMore: false })),
    };
    const report = await purgeTesterPhotos({
      repo,
      blob,
      // 2027-05-08 in Taipei: photos of 2026-11-08 and before go.
      now: () => new Date("2027-05-07T16:30:00Z"),
      limits: { batchSize: 100 },
    });
    expect(repo.listPhotosBefore).toHaveBeenCalledWith("2026-11-09", 100);
    expect(order).toEqual(["del:tester/a.jpg,tester/b.jpg", "clear:a,b"]);
    expect(report).toEqual({ expired: 2, orphans: 0, remaining: false });
  });

  it("stops at its batch limit and says work is left", async () => {
    const full = [{ id: "x", photoPathname: "tester/x.jpg" }];
    const report = await purgeTesterPhotos({
      repo: {
        listPhotosBefore: vi.fn(async () => full),
        clearPhotos: vi.fn(async () => 1),
        existingPathnames: vi.fn(async () => []),
      },
      blob: {
        del: vi.fn(async () => {}),
        list: vi.fn(async () => ({ blobs: [], hasMore: false })),
      },
      limits: { batchSize: 1, maxBatches: 3 },
    });
    expect(report).toEqual({ expired: 3, orphans: 0, remaining: true });
  });

  it("only lists the tester folder for orphans", async () => {
    const list = vi.fn(async () => ({ blobs: [], hasMore: false }));
    await purgeTesterPhotos({
      repo: {
        listPhotosBefore: vi.fn(async () => []),
        clearPhotos: vi.fn(async () => 0),
        existingPathnames: vi.fn(async () => []),
      },
      blob: { del: vi.fn(async () => {}), list },
    });
    expect(list).toHaveBeenCalledWith({ prefix: "tester/" });
  });
});

describe("handleExpireSessions with the tester purge", () => {
  const scanRepo = () =>
    ({
      deleteExpiredAnonymousSessions: vi.fn(async () => 3),
      deleteEndedRateLimitWindows: vi.fn(async () => 7),
    }) as unknown as ScanRepo;
  const authorized = () =>
    new Request("http://localhost/api/cron/expire-sessions", {
      headers: { authorization: "Bearer s3cret" },
    });
  const errorPurge = async () => ({ expired: 1, orphans: 0, remaining: false });

  it("reports the tester purge after the error photos", async () => {
    const res = await handleExpireSessions(authorized(), {
      repo: scanRepo(),
      cronSecret: "s3cret",
      purgeErrorPhotos: errorPurge,
      purgeTesterPhotos: async () => ({
        expired: 4,
        orphans: 2,
        remaining: false,
      }),
    });
    expect(await res.json()).toEqual({
      deleted: 3,
      rateLimitsDeleted: 7,
      errorPhotos: { expired: 1, orphans: 0, remaining: false },
      testerPhotos: { expired: 4, orphans: 2, remaining: false },
    });
  });

  it("a failed tester purge is reported alone, logging only the class", async () => {
    logError.mockClear();
    const res = await handleExpireSessions(authorized(), {
      repo: scanRepo(),
      cronSecret: "s3cret",
      purgeErrorPhotos: errorPurge,
      purgeTesterPhotos: async () => {
        throw new Error("relation tester_shots does not exist");
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      deleted: 3,
      rateLimitsDeleted: 7,
      errorPhotos: { expired: 1, orphans: 0, remaining: false },
      testerPhotos: "failed",
    });
    expect(logError).toHaveBeenCalledWith(
      "tester.purge_failed",
      expect.objectContaining({ op: "purge" }),
    );
  });

  it("without either purge, the answer is exactly the two sweeps", async () => {
    const res = await handleExpireSessions(authorized(), {
      repo: scanRepo(),
      cronSecret: "s3cret",
    });
    expect(await res.json()).toEqual({ deleted: 3, rateLimitsDeleted: 7 });
  });
});
