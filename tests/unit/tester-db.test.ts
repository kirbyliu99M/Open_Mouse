/**
 * `tester_shots` (migration 0016, candidate; contract
 * src/lib/contracts/tester.ts) on a real Postgres (PGlite with the repo's own
 * migrations), through the real route handler and repo:
 *
 *   - a shot is stored with the participant id only, the day only, the tape
 *     values exactly as typed; no column could hold the code's secret half;
 *   - a repeat of the same `shotId` stores nothing new (route and table);
 *   - the CHECKs refuse a malformed participant and implausible millimetres;
 *   - the purge deletes old photos and NULLs their pathname, keeping the row;
 *   - `tester-delete` removes every row of one participant and nothing else.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createDrizzleTesterShotRepo,
  createTesterAdmin,
} from "../../src/server/tester/drizzle-repo";
import { purgeTesterPhotos } from "../../src/server/tester/purge";
import {
  handleTesterShot,
  type TesterDeps,
} from "../../src/server/tester/service";
import { RECORD, SHOT } from "./fixtures/tester-record";
import { count, migratedDatabase } from "./fixtures/pglite";
import { syntheticJpeg } from "./helpers/synthetic-jpeg";

type Db = Parameters<typeof createDrizzleTesterShotRepo>[0];

const CODE = "P07-K7Q2M9";

async function world() {
  const { pg, db } = await migratedDatabase();
  const repo = createDrizzleTesterShotRepo(db as unknown as Db);
  const admin = createTesterAdmin(db as unknown as Db);
  const blobs = new Map<string, { body: Uint8Array; uploadedAt: Date }>();
  const blob = {
    put: vi.fn(async (pathname: string, body: Uint8Array) => {
      blobs.set(pathname, { body, uploadedAt: new Date() });
    }),
    del: vi.fn(async (pathnames: readonly string[]) => {
      for (const p of pathnames) blobs.delete(p);
    }),
    list: vi.fn(async ({ prefix }: { prefix: string }) => ({
      blobs: [...blobs.entries()]
        .filter(([p]) => p.startsWith(prefix))
        .map(([pathname, b]) => ({ pathname, uploadedAt: b.uploadedAt })),
      hasMore: false,
    })),
  };
  let n = 0;
  const deps = (now: Date): TesterDeps => ({
    open: false,
    codes: [CODE, "P08-ABCDEF"],
    blobConfigured: true,
    limiter: () => ({ allow: async () => true }),
    repo: () => repo,
    blob,
    randomUUID: () =>
      `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    now: () => now,
  });
  return { pg, repo, admin, blob, blobs, deps };
}

function shotRequest(code: string, record: unknown, photo = true): Request {
  const form = new FormData();
  form.set("code", code);
  form.set("record", JSON.stringify(record));
  if (photo)
    form.set("photo", new Blob([syntheticJpeg()], { type: "image/jpeg" }));
  return new Request("http://localhost/api/tester/shots", {
    method: "POST",
    body: form,
  });
}

describe("tester_shots on Postgres", () => {
  it("stores one row per shot: participant id, Taipei day, tape as typed, no code", async () => {
    const { pg, deps } = await world();
    const response = await handleTesterShot(
      shotRequest(CODE, RECORD),
      deps(new Date("2026-11-09T17:00:00Z")),
    );
    expect(response.status).toBe(201);
    const { rows } = await pg.query<Record<string, unknown>>(
      "SELECT * FROM tester_shots",
    );
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.participant).toBe("P07");
    expect(row.day).toEqual(expect.anything());
    expect(
      String(row.day instanceof Date ? row.day.toISOString() : row.day),
    ).toContain("2026-11-10");
    expect(Number(row.hand_length_a1)).toBe(188.5);
    expect(Number(row.palm_width_b2)).toBe(84);
    expect(row.measurers).toBe(2);
    expect(row.failure_codes).toEqual(["LOW_LANDMARK_CONFIDENCE"]);
    expect(row.photo_pathname).toMatch(/^tester\/[0-9a-f-]{36}\.jpg$/);
    // No column holds the code's secret half, an IP, a time or an account.
    expect(JSON.stringify(row)).not.toContain("K7Q2M9");
    const { rows: columns } = await pg.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'tester_shots'",
    );
    const names = columns.map((c) => c.column_name);
    expect(names).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^(code|tester_code|ip|ip_address|user_agent|user_id|session_id|scan_id|email|name|created_at)$/,
        ),
      ]),
    );
    expect(names.filter((n) => /_at$|time/.test(n))).toEqual([]);
  });

  it("a repeated shotId stores nothing new, through the route and the table", async () => {
    const { pg, repo, deps, blobs } = await world();
    const d = deps(new Date("2026-11-09T03:00:00Z"));
    expect((await handleTesterShot(shotRequest(CODE, RECORD), d)).status).toBe(
      201,
    );
    expect((await handleTesterShot(shotRequest(CODE, RECORD), d)).status).toBe(
      200,
    );
    expect(
      await repo.insert({
        shotId: SHOT,
        participant: "P07",
        day: "2026-11-09",
        record: RECORD,
        photoPathname: null,
      }),
    ).toBe(false);
    expect(await count(pg, "SELECT count(*)::int AS n FROM tester_shots")).toBe(
      1,
    );
    expect(blobs.size).toBe(1);
  });

  it("the CHECKs refuse a malformed participant and implausible millimetres", async () => {
    const { repo } = await world();
    const base = {
      shotId: "11111111-1111-4111-8111-111111111111",
      participant: "P07",
      day: "2026-11-09",
      record: RECORD,
      photoPathname: null,
    };
    await expect(repo.insert({ ...base, participant: "P7" })).rejects.toThrow();
    // Open mode's anonymous ids: W + 8 alphabet chars only (no I, O, 0, 1).
    for (const bad of [
      "WK7Q2M9XI",
      "WK7Q2M9X0",
      "wk7q2m9xa",
      "W1234567",
      "WK7Q2M9XAA",
    ])
      await expect(
        repo.insert({ ...base, participant: bad }),
        bad,
      ).rejects.toThrow();
    expect(
      await repo.insert({
        ...base,
        shotId: "22222222-2222-4222-8222-222222222222",
        participant: "WK7Q2M9XA",
      }),
    ).toBe(true);
    await expect(
      repo.insert({ ...base, participant: "P07-K7Q2M9" }),
    ).rejects.toThrow();
    await expect(
      repo.insert({
        ...base,
        record: {
          ...RECORD,
          measured: { ...RECORD.measured!, handLengthMm: 999 },
        },
      }),
    ).rejects.toThrow();
    await expect(
      repo.insert({
        ...base,
        record: {
          ...RECORD,
          tape: { ...RECORD.tape, palmWidthEdge: 12 },
        },
      }),
    ).rejects.toThrow();
    expect(await repo.insert(base)).toBe(true);
    // A give-up before any analysis: zero attempts is allowed.
    const { measured: _m, photo: _p, ...noMeasure } = RECORD;
    void _m;
    void _p;
    expect(
      await repo.insert({
        ...base,
        shotId: "55555555-5555-4555-8555-555555555555",
        record: {
          ...noMeasure,
          attempts: 0,
          failureCodes: [],
          firstTryOk: false,
          gaveUp: true,
        },
      }),
    ).toBe(true);
    await expect(
      repo.insert({
        ...base,
        shotId: "66666666-6666-4666-8666-666666666666",
        record: { ...RECORD, attempts: 51 },
      }),
    ).rejects.toThrow();
    // The contract's refinements, mirrored by CHECKs: zero attempts only on a
    // give-up, and firstTryOk exactly for one attempt that measured.
    await expect(
      repo.insert({
        ...base,
        shotId: "77777777-7777-4777-8777-777777777777",
        record: { ...RECORD, attempts: 0 },
      }),
    ).rejects.toThrow();
    await expect(
      repo.insert({
        ...base,
        shotId: "88888888-8888-4888-8888-888888888888",
        record: { ...RECORD, attempts: 2, firstTryOk: true },
      }),
    ).rejects.toThrow();
    expect(
      await repo.insert({
        ...base,
        shotId: "99999999-9999-4999-8999-999999999999",
        record: { ...RECORD, attempts: 1, firstTryOk: true },
      }),
    ).toBe(true);
  });

  it("the purge deletes photos past retention and NULLs their pathname, keeping the rows", async () => {
    const { pg, repo, blob, blobs } = await world();
    const old = "00000000-0000-4000-8000-0000000000aa";
    const fresh = "00000000-0000-4000-8000-0000000000bb";
    for (const [i, day, uuid] of [
      [1, "2026-05-01", old],
      [2, "2026-11-01", fresh],
    ] as const) {
      const pathname = `tester/${uuid}.jpg`;
      blobs.set(pathname, {
        body: new Uint8Array([1]),
        uploadedAt: new Date("2026-01-01T00:00:00Z"),
      });
      await pg.query(
        `INSERT INTO tester_shots ${columnsSql()} VALUES ${valuesSql(i, day, pathname)}`,
      );
    }
    // An orphan old enough to go, and one in flight (too young).
    blobs.set("tester/00000000-0000-4000-8000-0000000000cc.jpg", {
      body: new Uint8Array([1]),
      uploadedAt: new Date("2026-11-01T00:00:00Z"),
    });
    const now = new Date("2026-11-09T04:00:00Z");
    blobs.set("tester/00000000-0000-4000-8000-0000000000dd.jpg", {
      body: new Uint8Array([1]),
      uploadedAt: new Date(now.getTime() - 60_000),
    });
    const report = await purgeTesterPhotos({ repo, blob, now: () => now });
    expect(report).toEqual({ expired: 1, orphans: 1, remaining: false });
    expect([...blobs.keys()].sort()).toEqual([
      "tester/00000000-0000-4000-8000-0000000000bb.jpg",
      "tester/00000000-0000-4000-8000-0000000000dd.jpg",
    ]);
    expect(await count(pg, "SELECT count(*)::int AS n FROM tester_shots")).toBe(
      2,
    );
    expect(
      await count(
        pg,
        "SELECT count(*)::int AS n FROM tester_shots WHERE photo_pathname IS NULL",
      ),
    ).toBe(1);
  });

  it("deleting a participant removes all of its rows and no one else's", async () => {
    const { pg, admin, deps } = await world();
    const d = deps(new Date("2026-11-09T03:00:00Z"));
    await handleTesterShot(shotRequest(CODE, RECORD), d);
    await handleTesterShot(
      shotRequest(CODE, {
        ...RECORD,
        shotId: "22222222-2222-4222-8222-222222222222",
      }),
      d,
    );
    await handleTesterShot(
      shotRequest("P08-ABCDEF", {
        ...RECORD,
        shotId: "33333333-3333-4333-8333-333333333333",
      }),
      d,
    );
    const p07 = await admin.listParticipant("P07");
    expect(p07).toHaveLength(2);
    expect(p07.every((r) => r.photoPathname?.startsWith("tester/"))).toBe(true);
    expect(await admin.deleteParticipant("P07")).toBe(2);
    expect(await count(pg, "SELECT count(*)::int AS n FROM tester_shots")).toBe(
      1,
    );
    expect((await admin.listAll()).map((r) => r.participant)).toEqual(["P08"]);
  });
});

/** Raw INSERT helpers for the purge test (rows on chosen days). */
function columnsSql(): string {
  return `(shot_id, participant, consent_version, day, hand, measurers,
    hand_length_a1, hand_length_a2, palm_width_a1, palm_width_a2, phone_model,
    surface, lighting, reference, deliberately_poor, capture_mode, attempts,
    first_try_ok, failure_codes, gave_up, measured_hand_length_mm,
    measured_palm_width_mm, photo_pathname)`;
}

function valuesSql(i: number, day: string, pathname: string): string {
  const shot = `44444444-4444-4444-8444-${String(i).padStart(12, "0")}`;
  return `('${shot}', 'P07', 'tester-consent-v1-draft', '${day}', 'right', 1,
    188.5, 189, 84, 84.5, 'Pixel 8', 'white', 'daylight', 'a4', false,
    'camera', 1, true, '{}', false, 190.2, 83.7, '${pathname}')`;
}
