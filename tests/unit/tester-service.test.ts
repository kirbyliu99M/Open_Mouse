/**
 * The tester routes (src/server/tester/service.ts, candidate; contract
 * src/lib/contracts/tester.ts) with fakes: the env switch (unset -> 404),
 * the code check, participant-only storage, the photo checks shared with the
 * error photos, idempotency on `shotId`, and the clean-up on a failed insert.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const logError = vi.fn();
vi.mock("../../src/server/log", () => ({
  log: { error: (...args: unknown[]) => logError(...args), warn: vi.fn() },
}));

import type { TesterRecord } from "../../src/lib/contracts/tester";
import {
  matchTesterCode,
  parseTesterCodes,
} from "../../src/server/tester/codes";
import type {
  NewTesterShotRow,
  TesterShotRepo,
} from "../../src/server/tester/repo";
import {
  handleTesterCheck,
  handleTesterShot,
  testerPhotoPathname,
  type TesterDeps,
} from "../../src/server/tester/service";
import { RECORD, SHOT } from "./fixtures/tester-record";
import { EXIF_APP1, syntheticJpeg } from "./helpers/synthetic-jpeg";

const CODE = "P07-K7Q2M9";
const OTHER = "P12-ABCDEF";
const UUID = "0b30556a-f67c-429d-9738-f2e18f2b06da";
// 2026-11-09 23:30 in Taipei is still 2026-11-09 15:30 UTC.
const NOW = new Date("2026-11-09T15:30:00Z");

function fakes(overrides: Partial<TesterDeps> = {}) {
  const rows: NewTesterShotRow[] = [];
  const blobs = new Map<string, Uint8Array>();
  const allow = vi.fn(async () => true);
  const repo: TesterShotRepo = {
    hasShot: vi.fn(async (id: string) => rows.some((r) => r.shotId === id)),
    insert: vi.fn(async (row: NewTesterShotRow) => {
      if (rows.some((r) => r.shotId === row.shotId)) return false;
      rows.push(row);
      return true;
    }),
    listPhotosBefore: vi.fn(async () => []),
    clearPhotos: vi.fn(async () => 0),
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
  };
  let n = 0;
  const deps: TesterDeps = {
    codes: [CODE, OTHER],
    blobConfigured: true,
    limiter: () => ({ allow }),
    repo: () => repo,
    blob,
    randomUUID: () =>
      n++ === 0 ? UUID : "1b30556a-f67c-429d-9738-f2e18f2b06da",
    now: () => NOW,
    ...overrides,
  };
  return { deps, rows, blobs, repo, blob, allow };
}

function checkRequest(body: unknown): Request {
  return new Request("http://localhost/api/tester/check", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-vercel-forwarded-for": "203.0.113.7",
    },
  });
}

function shotRequest(
  options: {
    code?: string | null;
    record?: unknown;
    recordText?: string;
    photo?: Blob | null;
  } = {},
): Request {
  const form = new FormData();
  const code = options.code === undefined ? CODE : options.code;
  if (code !== null) form.set("code", code);
  form.set(
    "record",
    options.recordText ?? JSON.stringify(options.record ?? RECORD),
  );
  const photo =
    options.photo === undefined
      ? new Blob([syntheticJpeg()], { type: "image/jpeg" })
      : options.photo;
  if (photo !== null) form.set("photo", photo);
  return new Request("http://localhost/api/tester/shots", {
    method: "POST",
    body: form,
    headers: { "x-vercel-forwarded-for": "203.0.113.7" },
  });
}

describe("parseTesterCodes / matchTesterCode", () => {
  it("is null when the env is unset, empty, or names no valid code", () => {
    expect(parseTesterCodes(undefined)).toBeNull();
    expect(parseTesterCodes("")).toBeNull();
    expect(parseTesterCodes(" , nope,P1-ABCDEF")).toBeNull();
  });

  it("normalises, de-duplicates and drops malformed entries", () => {
    expect(
      parseTesterCodes(" p07-k7q2m9 ,P07-K7Q2M9, bad ,P123-ZZZZZZ"),
    ).toEqual(["P07-K7Q2M9", "P123-ZZZZZZ"]);
  });

  it("matches a configured code typed in any case, and nothing else", () => {
    expect(matchTesterCode(" p07-k7q2m9 ", [OTHER, CODE])).toBe(CODE);
    expect(matchTesterCode("P07-K7Q2M8", [CODE])).toBeNull();
    expect(matchTesterCode("P07-K7Q2M9", [])).toBeNull();
    expect(matchTesterCode(42, [CODE])).toBeNull();
    // The dummy compared for a malformed input never matches a real code.
    expect(matchTesterCode("P00-AAAAAA ", ["P00-AAAAAA"])).toBe("P00-AAAAAA");
    expect(matchTesterCode("garbage", ["P00-AAAAAA"])).toBeNull();
  });
});

describe("handleTesterCheck", () => {
  it("is a 404 when TESTER_CODES is unset, before the limiter or a byte is read", async () => {
    const off = fakes({ codes: null });
    const response = await handleTesterCheck(
      checkRequest({ code: CODE }),
      off.deps,
    );
    expect(response.status).toBe(404);
    expect(off.allow).not.toHaveBeenCalled();
  });

  it("answers 200 with the participant id only for a configured code", async () => {
    const { deps } = fakes();
    const response = await handleTesterCheck(
      checkRequest({ code: "p07-k7q2m9" }),
      deps,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ participant: "P07" });
    expect(JSON.stringify(body)).not.toContain("K7Q2M9");
  });

  it("answers 404 for an unknown, malformed or missing code", async () => {
    const { deps } = fakes();
    for (const body of [
      { code: "P07-K7Q2M8" },
      { code: "nope" },
      {},
      { code: CODE, extra: 1 },
    ]) {
      expect((await handleTesterCheck(checkRequest(body), deps)).status).toBe(
        404,
      );
    }
  });

  it("is a 429 past the per-IP limit", async () => {
    const { deps, allow } = fakes();
    allow.mockResolvedValueOnce(false);
    expect(
      (await handleTesterCheck(checkRequest({ code: CODE }), deps)).status,
    ).toBe(429);
  });
});

describe("handleTesterShot", () => {
  it("is a 404 when TESTER_CODES is unset, touching nothing", async () => {
    const off = fakes({ codes: null });
    expect((await handleTesterShot(shotRequest(), off.deps)).status).toBe(404);
    expect(off.allow).not.toHaveBeenCalled();
    expect(off.repo.insert).not.toHaveBeenCalled();
    expect(off.blob.put).not.toHaveBeenCalled();
  });

  it("is a 404 for a wrong code, storing nothing", async () => {
    const { deps, rows, blob } = fakes();
    for (const code of ["P07-K7Q2M8", null, "P07"]) {
      expect((await handleTesterShot(shotRequest({ code }), deps)).status).toBe(
        404,
      );
    }
    expect(rows).toEqual([]);
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("stores the record under the participant id only, the Taipei day, and the photo privately", async () => {
    const { deps, rows, blobs } = fakes();
    const response = await handleTesterShot(
      shotRequest({ code: "p07-k7q2m9" }),
      deps,
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ shotId: SHOT });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.participant).toBe("P07");
    expect(row.day).toBe("2026-11-09");
    expect(row.photoPathname).toBe(testerPhotoPathname(UUID));
    expect(row.photoPathname).toMatch(/^tester\/[0-9a-f-]{36}\.jpg$/);
    // Never the secret half of the code, anywhere in what is stored.
    expect(JSON.stringify(row)).not.toContain("K7Q2M9");
    expect([...blobs.keys()]).toEqual([row.photoPathname]);
  });

  it("the Taipei day turns over at 16:00 UTC", async () => {
    const { deps, rows } = fakes({
      now: () => new Date("2026-11-09T16:00:00Z"),
    });
    await handleTesterShot(shotRequest(), deps);
    expect(rows[0]!.day).toBe("2026-11-10");
  });

  it("is idempotent on shotId: a repeat answers 200 and stores nothing new", async () => {
    const { deps, rows, blob } = fakes();
    expect((await handleTesterShot(shotRequest(), deps)).status).toBe(201);
    const again = await handleTesterShot(shotRequest(), deps);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ shotId: SHOT });
    expect(rows).toHaveLength(1);
    expect(blob.put).toHaveBeenCalledTimes(1);
  });

  it("a concurrent repeat that lost the unique shotId deletes its own blob and answers 200", async () => {
    const { deps, repo, blob, blobs } = fakes();
    vi.mocked(repo.hasShot).mockResolvedValueOnce(false);
    vi.mocked(repo.insert).mockResolvedValueOnce(false);
    const response = await handleTesterShot(shotRequest(), deps);
    expect(response.status).toBe(200);
    expect(blob.del).toHaveBeenCalledWith([testerPhotoPathname(UUID)]);
    expect(blobs.size).toBe(0);
  });

  it("a failed insert deletes the blob just written and answers 500 without values in the log", async () => {
    const { deps, repo, blobs } = fakes();
    vi.mocked(repo.insert).mockRejectedValueOnce(new Error("db down 190.2"));
    logError.mockClear();
    const response = await handleTesterShot(shotRequest(), deps);
    expect(response.status).toBe(500);
    expect(blobs.size).toBe(0);
    expect(logError).toHaveBeenCalledTimes(1);
    const [event, fields] = logError.mock.calls[0]!;
    expect(event).toBe("tester.failed");
    expect(Object.keys(fields as object).sort()).toEqual([
      "error",
      "op",
      "route",
    ]);
  });

  it("a gave-up record without a photo is stored with no pathname", async () => {
    const { deps, rows, blob } = fakes();
    const gaveUp: TesterRecord = {
      ...RECORD,
      attempts: 3,
      failureCodes: ["NO_HAND", "NO_HAND", "PAPER_NOT_FOUND"],
      gaveUp: true,
      measured: undefined,
      photo: undefined,
    };
    delete (gaveUp as Partial<TesterRecord>).measured;
    delete (gaveUp as Partial<TesterRecord>).photo;
    const response = await handleTesterShot(
      shotRequest({ record: gaveUp, photo: null }),
      deps,
    );
    expect(response.status).toBe(201);
    expect(rows[0]!.photoPathname).toBeNull();
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("refuses a photo that breaks the error-photo rules, or a photo/record mismatch", async () => {
    const { deps, rows } = fakes();
    const cases: { photo?: Blob | null; record?: unknown }[] = [
      {
        photo: new Blob([syntheticJpeg({ beforeFrame: EXIF_APP1 })], {
          type: "image/jpeg",
        }),
      },
      {
        photo: new Blob([syntheticJpeg({ width: 641 })], {
          type: "image/jpeg",
        }),
      },
      { photo: new Blob([syntheticJpeg()], { type: "image/png" }) },
      { photo: null },
      { record: { ...RECORD, photo: undefined } },
    ];
    for (const c of cases) {
      const record = c.record ? JSON.parse(JSON.stringify(c.record)) : RECORD;
      const response = await handleTesterShot(
        shotRequest({ ...c, record }),
        deps,
      );
      expect(response.status).toBe(400);
    }
    expect(rows).toEqual([]);
  });

  it("a photo with no Blob token is a 503; numbers alone are still stored", async () => {
    const { deps, rows } = fakes({ blobConfigured: false });
    expect((await handleTesterShot(shotRequest(), deps)).status).toBe(503);
    const noPhoto: Partial<TesterRecord> = { ...RECORD };
    delete noPhoto.photo;
    expect(
      (
        await handleTesterShot(
          shotRequest({ record: noPhoto, photo: null }),
          deps,
        )
      ).status,
    ).toBe(201);
    expect(rows).toHaveLength(1);
  });

  it("refuses a record that breaks the contract or a phone model with contact details", async () => {
    const { deps, rows } = fakes();
    const bad: unknown[] = [
      { ...RECORD, consent: "other" },
      { ...RECORD, gaveUp: true },
      { ...RECORD, reference: "card" },
      { ...RECORD, firstTryOk: true },
      { ...RECORD, phoneModel: "call 0912345678" },
      { ...RECORD, phoneModel: "me@example.com" },
      { ...RECORD, phoneModel: "https://x.tw" },
      { ...RECORD, extra: 1 },
    ];
    for (const record of bad) {
      expect(
        (await handleTesterShot(shotRequest({ record }), deps)).status,
      ).toBe(400);
    }
    expect(
      (await handleTesterShot(shotRequest({ recordText: "{" }), deps)).status,
    ).toBe(400);
    expect(rows).toEqual([]);
  });
});
