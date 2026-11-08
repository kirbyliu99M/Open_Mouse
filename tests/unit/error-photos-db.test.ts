/**
 * `createDrizzleErrorPhotoRepo` against a real Postgres (PGlite) with every
 * migration applied (0015 adds `error_photos`): the SQL it generates, and the
 * table's own checks (day-aligned `created_on`, hex hash, unique path).
 */
import { describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });
vi.mock("server-only", () => ({}));

import {
  ERROR_PHOTO_CONSENT_VERSION,
  type ErrorPhotoMeta,
} from "../../src/lib/contracts/error-photo";
import { createDrizzleErrorPhotoRepo } from "../../src/server/error-photos/drizzle-repo";
import { hashDeleteCode } from "../../src/server/error-photos/service";
import { migratedDatabase } from "./fixtures/pglite";

type RepoDb = Parameters<typeof createDrizzleErrorPhotoRepo>[0];

const META: Omit<ErrorPhotoMeta, "consent"> = {
  trigger: "scan-failed",
  reference: "card",
  failureCode: "HAND_NOT_DETECTED",
  widthPx: 800,
  heightPx: 600,
};

const row = (k: number, createdOn: string) => ({
  consentVersion: ERROR_PHOTO_CONSENT_VERSION,
  blobPathname: `error-photos/${k}.jpg`,
  deleteCodeSha256: hashDeleteCode(`CODE${k}`),
  meta: META,
  bytes: 1000 + k,
  createdOn: new Date(`${createdOn}T00:00:00Z`),
});

describe("createDrizzleErrorPhotoRepo", () => {
  it("inserts, finds by hash, lists by age, checks paths and deletes", async () => {
    const { pg, db } = await migratedDatabase();
    const repo = createDrizzleErrorPhotoRepo(db as unknown as RepoDb);
    await repo.insert(row(1, "2026-01-01"));
    await repo.insert(row(2, "2026-03-01"));
    await repo.insert(row(3, "2026-11-08"));

    const found = await repo.findByCodeHash(hashDeleteCode("CODE2"));
    expect(found?.blobPathname).toBe("error-photos/2.jpg");
    expect(await repo.findByCodeHash(hashDeleteCode("NOPE"))).toBeNull();

    const old = await repo.listCreatedBefore(
      new Date("2026-03-01T00:00:00Z"),
      10,
    );
    expect(old.map((r) => r.blobPathname)).toEqual(["error-photos/1.jpg"]);
    const limited = await repo.listCreatedBefore(
      new Date("2027-01-01T00:00:00Z"),
      2,
    );
    expect(limited.map((r) => r.blobPathname)).toEqual([
      "error-photos/1.jpg",
      "error-photos/2.jpg",
    ]);

    expect(
      (
        await repo.existingPathnames([
          "error-photos/1.jpg",
          "error-photos/9.jpg",
        ])
      ).sort(),
    ).toEqual(["error-photos/1.jpg"]);
    expect(await repo.existingPathnames([])).toEqual([]);

    expect(await repo.deleteByIds(limited.map((r) => r.id))).toBe(2);
    expect(await repo.deleteByIds([])).toBe(0);
    await repo.deleteById(found!.id); // already gone: no error
    const { rows } = await pg.query<{ blob_pathname: string; meta: unknown }>(
      "SELECT blob_pathname, meta FROM error_photos",
    );
    expect(rows.map((r) => r.blob_pathname)).toEqual(["error-photos/3.jpg"]);
    expect(rows[0]!.meta).toEqual(META);
  });

  it("the table refuses a time that is not a day start, a bad hash and a reused path", async () => {
    const { db } = await migratedDatabase();
    const repo = createDrizzleErrorPhotoRepo(db as unknown as RepoDb);
    await expect(
      repo.insert({
        ...row(1, "2026-01-01"),
        createdOn: new Date("2026-01-01T05:00:00Z"),
      }),
    ).rejects.toThrow();
    await expect(
      repo.insert({ ...row(1, "2026-01-01"), deleteCodeSha256: "CODE1" }),
    ).rejects.toThrow();
    await repo.insert(row(1, "2026-01-01"));
    await expect(
      repo.insert({
        ...row(2, "2026-01-01"),
        blobPathname: "error-photos/1.jpg",
      }),
    ).rejects.toThrow();
  });
});
