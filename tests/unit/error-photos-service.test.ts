/**
 * `POST /api/error-photos` and `/api/error-photos/delete`
 * (src/server/error-photos/service.ts) against fakes: the contract's MUST
 * list, one case each, with no network and no database.
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const logError = vi.fn();
vi.mock("../../src/server/log", () => ({
  log: { error: (...args: unknown[]) => logError(...args), warn: vi.fn() },
}));

import {
  ERROR_PHOTO_CONSENT_VERSION,
  ERROR_PHOTO_MAX_BYTES,
  type ErrorPhotoMeta,
} from "../../src/lib/contracts/error-photo";
import type {
  ErrorPhotoRepo,
  NewErrorPhotoRow,
} from "../../src/server/error-photos/repo";
import {
  ERROR_PHOTO_MAX_BODY_BYTES,
  errorPhotoPathname,
  handleErrorPhotoDelete,
  handleErrorPhotoUpload,
  hashDeleteCode,
  type ErrorPhotoDeps,
} from "../../src/server/error-photos/service";
import { EXIF_APP1, syntheticJpeg } from "./helpers/synthetic-jpeg";

const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const NOW = new Date("2026-11-08T15:42:10Z");

const META: ErrorPhotoMeta = {
  consent: ERROR_PHOTO_CONSENT_VERSION,
  trigger: "numbers-wrong",
  reference: "a4",
  hand: "right",
  measured: { handLengthMm: 188, palmWidthMm: 84 },
  expected: { handLengthMm: 192 },
  deviceClass: "phone",
  captureMode: "camera",
  widthPx: 640,
  heightPx: 480,
};

function fakes(overrides: Partial<ErrorPhotoDeps> = {}) {
  const rows: (NewErrorPhotoRow & { id: string })[] = [];
  const blobs = new Map<string, Uint8Array>();
  const allow = vi.fn(async () => true);
  const repo: ErrorPhotoRepo = {
    insert: vi.fn(async (row: NewErrorPhotoRow) => {
      rows.push({ ...row, id: `row-${rows.length + 1}` });
    }),
    findByCodeHash: vi.fn(async (hash: string) => {
      const row = rows.find((r) => r.deleteCodeSha256 === hash);
      return row ? { id: row.id, blobPathname: row.blobPathname } : null;
    }),
    deleteById: vi.fn(async (id: string) => {
      const at = rows.findIndex((r) => r.id === id);
      if (at >= 0) rows.splice(at, 1);
    }),
    listCreatedBefore: vi.fn(async () => []),
    deleteByIds: vi.fn(async () => 0),
    existingPathnames: vi.fn(async () => []),
  };
  const blob = {
    put: vi.fn(async (pathname: string, body: Uint8Array) => {
      if (blobs.has(pathname)) throw new Error("exists");
      blobs.set(pathname, body);
    }),
    del: vi.fn(async (pathnames: readonly string[]) => {
      for (const p of pathnames) blobs.delete(p);
    }),
    list: vi.fn(async () => ({ blobs: [], hasMore: false })),
  };
  const deps: ErrorPhotoDeps = {
    enabled: true,
    blobConfigured: true,
    limiter: () => ({ allow }),
    repo: () => repo,
    blob,
    randomBytes: (n) => Uint8Array.from({ length: n }, (_, k) => k * 7),
    randomUUID: () => UUID,
    now: () => NOW,
    ...overrides,
  };
  return { deps, rows, blobs, repo, blob, allow };
}

function uploadRequest(
  options: {
    meta?: unknown;
    metaText?: string;
    photo?: Blob | string | null;
    headers?: Record<string, string>;
  } = {},
): Request {
  const form = new FormData();
  const metaText = options.metaText ?? JSON.stringify(options.meta ?? META);
  form.set("meta", metaText);
  const photo =
    options.photo === undefined
      ? new Blob([syntheticJpeg()], { type: "image/jpeg" })
      : options.photo;
  if (photo !== null) form.set("photo", photo);
  return new Request("http://localhost/api/error-photos", {
    method: "POST",
    body: form,
    headers: { "x-vercel-forwarded-for": "203.0.113.7", ...options.headers },
  });
}

function deleteRequest(body: unknown, raw?: string): Request {
  return new Request("http://localhost/api/error-photos/delete", {
    method: "POST",
    body: raw ?? JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-vercel-forwarded-for": "203.0.113.7",
    },
  });
}

describe("handleErrorPhotoUpload", () => {
  it("is a 404 with the flag off and a 503 without the Blob token, touching nothing", async () => {
    const off = fakes({ enabled: false });
    expect(
      (await handleErrorPhotoUpload(uploadRequest(), off.deps)).status,
    ).toBe(404);
    const noToken = fakes({ blobConfigured: false });
    expect(
      (await handleErrorPhotoUpload(uploadRequest(), noToken.deps)).status,
    ).toBe(503);
    for (const f of [off, noToken]) {
      expect(f.allow).not.toHaveBeenCalled();
      expect(f.blob.put).not.toHaveBeenCalled();
      expect(f.repo.insert).not.toHaveBeenCalled();
    }
  });

  it("stores a clean photo privately under a random path and keeps only the code's hash", async () => {
    const f = fakes();
    const res = await handleErrorPhotoUpload(uploadRequest(), f.deps);
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { deleteCode } = (await res.json()) as { deleteCode: string };
    expect(deleteCode).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
    expect(f.blob.put).toHaveBeenCalledTimes(1);
    expect(f.blob.put.mock.calls[0]![0]).toBe(`error-photos/${UUID}.jpg`);
    expect(f.rows).toHaveLength(1);
    const row = f.rows[0]!;
    expect(row.deleteCodeSha256).toBe(
      createHash("sha256").update(deleteCode).digest("hex"),
    );
    expect(JSON.stringify(row)).not.toContain(deleteCode);
    expect(row.blobPathname).toBe(`error-photos/${UUID}.jpg`);
    expect(row.consentVersion).toBe(ERROR_PHOTO_CONSENT_VERSION);
    expect(row.meta).toEqual(META);
    expect(row.bytes).toBe(syntheticJpeg().byteLength);
    expect(row.createdOn.toISOString()).toBe("2026-11-08T00:00:00.000Z");
  });

  it("rate-limits per IP before anything is parsed or written", async () => {
    const f = fakes();
    f.allow.mockResolvedValueOnce(false);
    const res = await handleErrorPhotoUpload(uploadRequest(), f.deps);
    expect(res.status).toBe(429);
    expect(f.allow).toHaveBeenCalledWith("203.0.113.7");
    expect(f.blob.put).not.toHaveBeenCalled();
  });

  it("refuses an oversized body by its declared length before reading or limiting", async () => {
    const f = fakes();
    const res = await handleErrorPhotoUpload(
      new Request("http://localhost/api/error-photos", {
        method: "POST",
        body: "x",
        headers: {
          "content-type": "multipart/form-data; boundary=x",
          "content-length": String(ERROR_PHOTO_MAX_BODY_BYTES + 1),
        },
      }),
      f.deps,
    );
    expect(res.status).toBe(413);
    expect(f.allow).not.toHaveBeenCalled();
  });

  it("refuses an oversized body counted while streaming", async () => {
    const f = fakes();
    // A plain stream with no declared length (a FormData body cancelled
    // mid-way makes undici reject inside its own serializer).
    const chunk = new Uint8Array(64 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > ERROR_PHOTO_MAX_BODY_BYTES) return controller.close();
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const res = await handleErrorPhotoUpload(
      new Request("http://localhost/api/error-photos", {
        method: "POST",
        body,
        duplex: "half",
        headers: { "content-type": "multipart/form-data; boundary=x" },
      } as RequestInit),
      f.deps,
    );
    expect(res.status).toBe(413);
    expect(f.blob.put).not.toHaveBeenCalled();
  });

  it.each([
    ["not JSON", { metaText: "{" }],
    ["an extra field", { meta: { ...META, scanId: "x" } }],
    ["no consent", { meta: { ...META, consent: "yes" } }],
    ["a size over the limit", { meta: { ...META, widthPx: 4000 } }],
    ["a long meta", { metaText: " ".repeat(5000) }],
  ])("400 for metadata with %s", async (_label, options) => {
    const f = fakes();
    const res = await handleErrorPhotoUpload(uploadRequest(options), f.deps);
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain("188");
    expect(f.blob.put).not.toHaveBeenCalled();
  });

  it.each([
    ["no photo", null],
    ["a text field", "hello"],
    ["a PNG type", new Blob([syntheticJpeg()], { type: "image/png" })],
    [
      "Exif in it",
      new Blob([syntheticJpeg({ beforeFrame: EXIF_APP1 })], {
        type: "image/jpeg",
      }),
    ],
    [
      "another size than stated",
      new Blob([syntheticJpeg({ width: 800 })], { type: "image/jpeg" }),
    ],
    [
      "bytes that are not a JPEG",
      new Blob([new Uint8Array(100)], { type: "image/jpeg" }),
    ],
    [
      "over the byte limit",
      new Blob([syntheticJpeg(), new Uint8Array(ERROR_PHOTO_MAX_BYTES)], {
        type: "image/jpeg",
      }),
    ],
  ])("400 for %s", async (_label, photo) => {
    const f = fakes();
    const res = await handleErrorPhotoUpload(uploadRequest({ photo }), f.deps);
    expect(res.status).toBe(400);
    expect(f.blob.put).not.toHaveBeenCalled();
    expect(f.repo.insert).not.toHaveBeenCalled();
  });

  it("400 for a body that is not multipart", async () => {
    const f = fakes();
    const res = await handleErrorPhotoUpload(
      new Request("http://localhost/api/error-photos", {
        method: "POST",
        body: JSON.stringify(META),
        headers: { "content-type": "application/json" },
      }),
      f.deps,
    );
    expect(res.status).toBe(400);
  });

  it("deletes the blob when the row cannot be written, and logs no values", async () => {
    const f = fakes();
    vi.mocked(f.repo.insert).mockRejectedValueOnce(
      new Error(`insert failed: params ${JSON.stringify(META)}`),
    );
    logError.mockClear();
    const res = await handleErrorPhotoUpload(uploadRequest(), f.deps);
    expect(res.status).toBe(500);
    expect(f.blob.del).toHaveBeenCalledWith([`error-photos/${UUID}.jpg`]);
    expect(f.blobs.size).toBe(0);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0]![0]).toBe("error_photo.failed");
    expect(logError.mock.calls[0]![1]).toMatchObject({ op: "upload" });
  });

  it("writes no row when the store refuses the photo", async () => {
    const f = fakes();
    f.blob.put.mockRejectedValueOnce(new Error("store down"));
    const res = await handleErrorPhotoUpload(uploadRequest(), f.deps);
    expect(res.status).toBe(500);
    expect(f.repo.insert).not.toHaveBeenCalled();
  });

  it("never offers a path built from anything but a UUID", () => {
    expect(errorPhotoPathname(UUID.toUpperCase())).toBe(
      `error-photos/${UUID}.jpg`,
    );
    expect(() => errorPhotoPathname("../scans/x")).toThrow(RangeError);
  });
});

describe("handleErrorPhotoDelete", () => {
  async function uploaded() {
    const f = fakes();
    const res = await handleErrorPhotoUpload(uploadRequest(), f.deps);
    const { deleteCode } = (await res.json()) as { deleteCode: string };
    return { f, deleteCode };
  }

  it("deletes the photo and its row with the code (any case, spaces trimmed)", async () => {
    const { f, deleteCode } = await uploaded();
    const res = await handleErrorPhotoDelete(
      deleteRequest({ code: ` ${deleteCode.toLowerCase()} ` }),
      f.deps,
    );
    expect(res.status).toBe(204);
    expect(f.blobs.size).toBe(0);
    expect(f.rows).toHaveLength(0);
    expect(f.repo.findByCodeHash).toHaveBeenCalledWith(
      hashDeleteCode(deleteCode),
    );
  });

  it("404 for a code no photo has, and nothing deleted", async () => {
    const { f } = await uploaded();
    const res = await handleErrorPhotoDelete(
      deleteRequest({ code: "ABCDEFGHJKLM" }),
      f.deps,
    );
    expect(res.status).toBe(404);
    expect(f.rows).toHaveLength(1);
    expect(f.blob.del).not.toHaveBeenCalled();
  });

  it("400 for a malformed code or body", async () => {
    const { f } = await uploaded();
    for (const req of [
      deleteRequest({ code: "ABC" }),
      deleteRequest({ code: "ABCDEFGHIJKL" }),
      deleteRequest({ code: "ABCDEFGHJKLM", extra: 1 }),
      deleteRequest(null, "{"),
    ]) {
      expect((await handleErrorPhotoDelete(req, f.deps)).status).toBe(400);
    }
  });

  it("keeps the row when the blob cannot be deleted, so the code works again", async () => {
    const { f, deleteCode } = await uploaded();
    f.blob.del.mockRejectedValueOnce(new Error("store down"));
    const res = await handleErrorPhotoDelete(
      deleteRequest({ code: deleteCode }),
      f.deps,
    );
    expect(res.status).toBe(500);
    expect(f.rows).toHaveLength(1);
  });

  it("is limited, and off with the flag off or no token", async () => {
    const { f, deleteCode } = await uploaded();
    f.allow.mockResolvedValueOnce(false);
    expect(
      (
        await handleErrorPhotoDelete(
          deleteRequest({ code: deleteCode }),
          f.deps,
        )
      ).status,
    ).toBe(429);
    expect(
      (
        await handleErrorPhotoDelete(deleteRequest({ code: deleteCode }), {
          ...f.deps,
          enabled: false,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await handleErrorPhotoDelete(deleteRequest({ code: deleteCode }), {
          ...f.deps,
          blobConfigured: false,
        })
      ).status,
    ).toBe(503);
    expect(f.rows).toHaveLength(1);
  });
});
