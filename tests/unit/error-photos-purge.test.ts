/**
 * The error photos' retention (src/server/error-photos/purge.ts): the cutoff
 * arithmetic, the orphan selection, the batched loop against fakes, and the
 * hook in the daily cron (src/server/scans/expire-cron.ts).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const logError = vi.fn();
vi.mock("../../src/server/log", () => ({
  log: { error: (...args: unknown[]) => logError(...args), warn: vi.fn() },
}));

import { ERROR_PHOTO_RETENTION_DAYS } from "../../src/lib/contracts/error-photo";
import type {
  ErrorPhotoRef,
  ErrorPhotoRepo,
} from "../../src/server/error-photos/repo";
import {
  DAY_MS,
  errorPhotoPurgeCutoff,
  purgeErrorPhotos,
  selectOrphanPathnames,
} from "../../src/server/error-photos/purge";
import { handleExpireSessions } from "../../src/server/scans/expire-cron";
import type { ScanRepo } from "../../src/server/scans/repo";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("errorPhotoPurgeCutoff", () => {
  it("counts whole UTC days back from the start of today", () => {
    const cutoff = errorPhotoPurgeCutoff(
      new Date("2026-11-08T23:59:59Z"),
      ERROR_PHOTO_RETENTION_DAYS,
    );
    expect(cutoff.toISOString()).toBe("2026-05-12T00:00:00.000Z");
    // The same any time of that day.
    expect(
      errorPhotoPurgeCutoff(
        new Date("2026-11-08T00:00:00Z"),
        ERROR_PHOTO_RETENTION_DAYS,
      ).getTime(),
    ).toBe(cutoff.getTime());
  });

  it("keeps a photo through day D + N and deletes it on day D + N + 1", () => {
    const sentOn = day("2026-01-01");
    const keptOn = new Date(
      sentOn.getTime() + ERROR_PHOTO_RETENTION_DAYS * DAY_MS + 12 * 3600_000,
    );
    const goneOn = new Date(
      sentOn.getTime() + (ERROR_PHOTO_RETENTION_DAYS + 1) * DAY_MS + 60_000,
    );
    // `created_on < cutoff` is what the repo deletes.
    expect(
      sentOn < errorPhotoPurgeCutoff(keptOn, ERROR_PHOTO_RETENTION_DAYS),
    ).toBe(false);
    expect(
      sentOn < errorPhotoPurgeCutoff(goneOn, ERROR_PHOTO_RETENTION_DAYS),
    ).toBe(true);
  });

  it("uses the contract's retention by default and refuses nonsense", () => {
    expect(ERROR_PHOTO_RETENTION_DAYS).toBe(180);
    expect(() => errorPhotoPurgeCutoff(new Date(), 0)).toThrow(RangeError);
    expect(() => errorPhotoPurgeCutoff(new Date(), 1.5)).toThrow(RangeError);
  });
});

describe("selectOrphanPathnames", () => {
  const now = new Date("2026-11-08T03:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("selects only old, unreferenced blobs under error-photos/", () => {
    const blobs = [
      { pathname: "error-photos/a.jpg", uploadedAt: ago(2 * DAY_MS) },
      { pathname: "error-photos/b.jpg", uploadedAt: ago(2 * DAY_MS) },
      // Young: may be an upload whose row is being written right now.
      { pathname: "error-photos/c.jpg", uploadedAt: ago(DAY_MS - 1) },
      // Exactly a day old: old enough.
      { pathname: "error-photos/d.jpg", uploadedAt: ago(DAY_MS) },
      // Not ours (the preview debug photos share the store).
      { pathname: "debug/x/photo.jpg", uploadedAt: ago(9 * DAY_MS) },
    ];
    expect(
      selectOrphanPathnames(blobs, new Set(["error-photos/b.jpg"]), now),
    ).toEqual(["error-photos/a.jpg", "error-photos/d.jpg"]);
  });
});

function fakeRepo(refs: ErrorPhotoRef[], referenced: string[] = []) {
  const rows = [...refs];
  const repo: ErrorPhotoRepo = {
    insert: vi.fn(),
    findByCodeHash: vi.fn(),
    deleteById: vi.fn(),
    listCreatedBefore: vi.fn(async (_cutoff: Date, limit: number) =>
      rows.slice(0, limit),
    ),
    deleteByIds: vi.fn(async (ids: readonly string[]) => {
      let n = 0;
      for (const id of ids) {
        const at = rows.findIndex((r) => r.id === id);
        if (at >= 0) {
          rows.splice(at, 1);
          n++;
        }
      }
      return n;
    }),
    existingPathnames: vi.fn(async (paths: readonly string[]) =>
      paths.filter((p) => referenced.includes(p)),
    ),
  };
  return { repo, rows };
}

const refs = (n: number): ErrorPhotoRef[] =>
  Array.from({ length: n }, (_, k) => ({
    id: `id-${k}`,
    blobPathname: `error-photos/${k}.jpg`,
  }));

describe("purgeErrorPhotos", () => {
  const now = () => new Date("2026-11-08T03:00:00Z");

  it("deletes expired blobs then rows in batches, and asks with the cutoff", async () => {
    const { repo, rows } = fakeRepo(refs(5));
    const blob = {
      del: vi.fn(async () => {}),
      list: vi.fn(async () => ({ blobs: [], hasMore: false })),
    };
    const report = await purgeErrorPhotos({
      repo,
      blob,
      now,
      limits: { batchSize: 2 },
    });
    expect(report).toEqual({ expired: 5, orphans: 0, remaining: false });
    expect(rows).toHaveLength(0);
    expect(blob.del).toHaveBeenCalledTimes(3);
    expect(blob.del.mock.calls[0]).toEqual([
      ["error-photos/0.jpg", "error-photos/1.jpg"],
    ]);
    expect(vi.mocked(repo.listCreatedBefore).mock.calls[0]![0]).toEqual(
      errorPhotoPurgeCutoff(now(), ERROR_PHOTO_RETENTION_DAYS),
    );
  });

  it("stops at the batch limit and says work is left", async () => {
    const { repo, rows } = fakeRepo(refs(10));
    const report = await purgeErrorPhotos({
      repo,
      blob: {
        del: vi.fn(async () => {}),
        list: vi.fn(async () => ({ blobs: [], hasMore: false })),
      },
      now,
      limits: { batchSize: 3, maxBatches: 2 },
    });
    expect(report.expired).toBe(6);
    expect(report.remaining).toBe(true);
    expect(rows).toHaveLength(4);
  });

  it("does not delete a row whose blob could not be deleted", async () => {
    const { repo, rows } = fakeRepo(refs(2));
    await expect(
      purgeErrorPhotos({
        repo,
        blob: {
          del: vi.fn(async () => {
            throw new Error("store down");
          }),
          list: vi.fn(),
        },
        now,
      }),
    ).rejects.toThrow("store down");
    expect(rows).toHaveLength(2);
  });

  it("sweeps unreferenced old blobs page by page", async () => {
    const { repo } = fakeRepo([], ["error-photos/kept.jpg"]);
    const old = new Date(now().getTime() - 3 * DAY_MS);
    const pages = [
      {
        blobs: [
          { pathname: "error-photos/kept.jpg", uploadedAt: old },
          { pathname: "error-photos/orphan1.jpg", uploadedAt: old },
        ],
        cursor: "next",
        hasMore: true,
      },
      {
        blobs: [
          { pathname: "error-photos/orphan2.jpg", uploadedAt: old },
          { pathname: "error-photos/new.jpg", uploadedAt: now() },
        ],
        hasMore: false,
      },
    ];
    const blob = {
      del: vi.fn(async () => {}),
      list: vi.fn(async () => pages.shift()!),
    };
    const report = await purgeErrorPhotos({ repo, blob, now });
    expect(report).toEqual({ expired: 0, orphans: 2, remaining: false });
    expect(blob.list).toHaveBeenNthCalledWith(1, { prefix: "error-photos/" });
    expect(blob.list).toHaveBeenNthCalledWith(2, {
      prefix: "error-photos/",
      cursor: "next",
    });
    expect(blob.del.mock.calls).toEqual([
      [["error-photos/orphan1.jpg"]],
      [["error-photos/orphan2.jpg"]],
    ]);
  });
});

describe("handleExpireSessions with the error-photo purge", () => {
  const scanRepo = () =>
    ({
      deleteExpiredAnonymousSessions: vi.fn(async () => 3),
      deleteEndedRateLimitWindows: vi.fn(async () => 7),
    }) as unknown as ScanRepo;
  const authorized = () =>
    new Request("http://localhost/api/cron/expire-sessions", {
      headers: { authorization: "Bearer s3cret" },
    });

  it("adds the purge's counts after the two sweeps", async () => {
    const purge = vi.fn(async () => ({
      expired: 2,
      orphans: 1,
      remaining: false,
    }));
    const res = await handleExpireSessions(authorized(), {
      repo: scanRepo(),
      cronSecret: "s3cret",
      purgeErrorPhotos: purge,
    });
    expect(await res.json()).toEqual({
      deleted: 3,
      rateLimitsDeleted: 7,
      errorPhotos: { expired: 2, orphans: 1, remaining: false },
    });
  });

  it("reports a failed purge without failing the sweeps, logging only the class", async () => {
    logError.mockClear();
    const res = await handleExpireSessions(authorized(), {
      repo: scanRepo(),
      cronSecret: "s3cret",
      purgeErrorPhotos: async () => {
        throw new Error("relation error_photos does not exist");
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      deleted: 3,
      rateLimitsDeleted: 7,
      errorPhotos: "failed",
    });
    expect(logError).toHaveBeenCalledWith(
      "error_photo.purge_failed",
      expect.objectContaining({ op: "purge" }),
    );
  });

  it("never runs the purge for an unauthorised caller", async () => {
    const purge = vi.fn();
    const res = await handleExpireSessions(
      new Request("http://localhost/api/cron/expire-sessions"),
      { repo: scanRepo(), cronSecret: "s3cret", purgeErrorPhotos: purge },
    );
    expect(res.status).toBe(401);
    expect(purge).not.toHaveBeenCalled();
  });
});
