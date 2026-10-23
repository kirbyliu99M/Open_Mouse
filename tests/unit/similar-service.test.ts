/**
 * `GET /api/scans/{scanId}/similar` (src/server/recommend/service.ts), end to
 * end through the handler with injected deps and an in-memory pool. Covers
 * every status the contract lists, the order the checks run in, and the five
 * things the engine's header says its caller must do: only mice this caller may
 * be shown reach it, names come from the current catalogue row, the caller's own
 * account is left out, and a `mice` row is never touched. The same handler runs
 * against the real repos on PGlite in similar-db.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GripStyle } from "../../src/lib/contracts/fit";
import {
  MAX_SIMILAR_MICE,
  similarResponseSchema,
  type SimilarResponse,
} from "../../src/lib/contracts/recommend";
import { errorResponseSchema } from "../../src/lib/contracts/routes";
import { predictGrip } from "../../src/server/fit/grip";
import type { CatalogueMouse } from "../../src/server/fit/types";
import { similarHands } from "../../src/server/recommend/neighbours";
import type {
  PooledContribution,
  SimilarRepo,
} from "../../src/server/recommend/repo";
import {
  handleSimilar,
  type SimilarDeps,
} from "../../src/server/recommend/service";
import type { OwnedScan, ScanRepo } from "../../src/server/scans/repo";

const NOW = new Date("2026-10-11T08:00:00.000Z");
const IP = "203.0.113.7";

// --- the world --------------------------------------------------------------

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

interface WorldScan {
  scanId: string;
  cookie: string | null;
}

interface StoredScan {
  scan: OwnedScan;
  sessionId: string;
  userId: string | null;
  expiresAt: Date | null;
}

/** A scan the caller owns: 186.4 x 82.7 mm, so the bins are 185 and 80. */
const ownedScan = (over: Partial<OwnedScan> = {}): OwnedScan => ({
  hand: "right",
  gripStyleStated: null,
  palmThicknessStated: null,
  measurements: { handLengthMm: 186.4, palmLengthMm: 106.2, palmWidthMm: 82.7 },
  ...over,
});

const mouse = (
  slug: string,
  over: Partial<CatalogueMouse> = {},
): CatalogueMouse => ({
  id: `id-${slug}`,
  slug,
  brand: `Brand ${slug}`,
  model: `Model ${slug}`,
  lengthMm: 120,
  widthMm: 65,
  heightMm: 38,
  weightG: 80,
  size: "medium",
  handCompatibility: "right",
  shape: "ergonomic",
  humpPlacement: null,
  frontFlare: null,
  sideCurvature: null,
  thumbRest: null,
  ringFingerRest: null,
  formFactor: "standard",
  listed: true,
  ...over,
});

let scans: Map<string, StoredScan>;
let counter: number;

function addScan(
  options: {
    userId?: string | null;
    expiresAt?: Date;
    scan?: Partial<OwnedScan>;
  } = {},
): WorldScan {
  const scanId = uuid(++counter);
  const sessionId = uuid(1000 + counter);
  const userId = options.userId ?? null;
  scans.set(scanId, {
    scan: ownedScan(options.scan),
    sessionId,
    userId,
    expiresAt:
      userId === null
        ? (options.expiresAt ?? new Date(NOW.getTime() + 3_600_000))
        : null,
  });
  return { scanId, cookie: userId === null ? sessionId : null };
}

const findOwnedScan = vi.fn<ScanRepo["findOwnedScan"]>(async (scanId, ctx) => {
  const row = scans.get(scanId);
  if (!row) return null;
  if (ctx.userId !== null && row.userId === ctx.userId) return row.scan;
  const viaCookie =
    ctx.cookieSessionId === row.sessionId &&
    row.userId === null &&
    row.expiresAt !== null &&
    row.expiresAt.getTime() > ctx.now.getTime();
  return viaCookie ? row.scan : null;
});

// --- the pool ---------------------------------------------------------------

let catalogue: CatalogueMouse[];
let pool: PooledContribution[];
const loadCatalogue = vi.fn(async () => catalogue);
const loadContributions = vi.fn(async () => pool);

let nextPerson: number;
/** A contributor at the caller's own bins (185 x 80) unless `over` says otherwise. */
function person(
  ratings: [slug: string, satisfaction: number][],
  over: Partial<PooledContribution> = {},
): PooledContribution {
  const id = uuid(5000 + ++nextPerson);
  return {
    id,
    userId: null,
    handLengthBinMm: 185,
    palmWidthBinMm: 80,
    gripStyle: "palm",
    ratings: ratings.map(([slug, satisfaction]) => ({
      mouseId: `id-${slug}`,
      satisfaction,
    })),
    ...over,
  };
}

/** `n` neighbours who each give `slug` the same rating. */
const crowd = (n: number, slug: string, satisfaction: number) =>
  Array.from({ length: n }, () => person([[slug, satisfaction]]));

// --- calling it -------------------------------------------------------------

let signedInAs: string | null;
let allow: ReturnType<typeof vi.fn<(key: string) => Promise<boolean>>>;

const deps = (over: Partial<SimilarDeps> = {}): SimilarDeps => ({
  scanRepo: { findOwnedScan },
  fitRepo: { loadCatalogue },
  similarRepo: { loadContributions } satisfies SimilarRepo,
  limiter: { allow },
  getUserId: async () => signedInAs,
  now: () => NOW,
  ...over,
});

interface CallOptions {
  cookie?: string | null;
  ip?: string | null;
  deps?: Partial<SimilarDeps>;
}

function get(scanId: string, options: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.ip !== null) headers["x-forwarded-for"] = options.ip ?? IP;
  if (options.cookie) headers.cookie = `scan_session=${options.cookie}`;
  return handleSimilar(
    new Request(`http://localhost/api/scans/${scanId}/similar`, { headers }),
    scanId,
    deps(options.deps),
  );
}

/** The scan's owner asking: the cookie of an anonymous scan. */
const getOwn = (scan: WorldScan, options: CallOptions = {}) =>
  get(scan.scanId, { cookie: scan.cookie, ...options });

async function answer(res: Response): Promise<SimilarResponse> {
  expect(res.status).toBe(200);
  return similarResponseSchema.parse(await res.json());
}

const slugs = (r: SimilarResponse) =>
  r.available ? r.mice.map((m) => m.slug) : [];

const expectNoStore = (res: Response) =>
  expect(res.headers.get("cache-control")).toBe("no-store");

beforeEach(() => {
  scans = new Map();
  counter = 0;
  nextPerson = 0;
  catalogue = [mouse("a"), mouse("b")];
  pool = [];
  signedInAs = null;
  allow = vi.fn<(key: string) => Promise<boolean>>(async () => true);
  findOwnedScan.mockClear();
  loadCatalogue.mockClear();
  loadContributions.mockClear();
});

// --- tests ------------------------------------------------------------------

describe("GET /api/scans/{scanId}/similar", () => {
  describe("200", () => {
    it("answers from the neighbours of the caller's hand, with the profile read from the scan", async () => {
      pool = [
        ...[5, 4, 5, 4, 4].map((n) => person([["a", n]])),
        person([["a", 3]], { handLengthBinMm: 105 }), // far away: ignored
        person([["a", 1]], { handLengthBinMm: 200 }), // next cell over: ignored
      ];
      const scan = addScan();
      const res = await getOwn(scan);
      expectNoStore(res);
      const body = await answer(res);
      expect(body).toEqual({
        available: true,
        neighbours: 5,
        // 186.4 and 82.7 rounded DOWN to the 5 mm bin.
        basis: {
          handLengthBinMm: 185,
          palmWidthBinMm: 80,
          gripStyle: predictGrip(186.4, 106.2),
        },
        mice: [
          {
            slug: "a",
            brand: "Brand a",
            model: "Model a",
            raters: 5,
            meanSatisfaction: 4.4,
          },
        ],
      });
    });

    it("a parallax-corrected scan is looked up on the engine's scale (landmark-raw-v3, candidate): the cell the same hand had before correction", async () => {
      pool = [...crowd(5, "a", 4)];
      // 181 x 1.035 = 187.3 and 77.8 x 1.051 = 81.8: bins 185 x 80, where
      // the stored numbers alone would be 180 x 75 (an empty cell here).
      // Grip crosses a threshold too (simulated input): 96.9 / 181 = 0.535 is
      // fingertip, 102.5 / 188.4 = 0.544 is claw.
      const corrected = addScan({
        scan: {
          measurements: {
            handLengthMm: 181,
            palmLengthMm: 96.9,
            palmWidthMm: 77.8,
          },
          parallaxCorrected: true,
        },
      });
      const body = await answer(await getOwn(corrected));
      expect(body.available && body.basis).toEqual({
        handLengthBinMm: 185,
        palmWidthBinMm: 80,
        gripStyle: "claw",
      });
      expect(predictGrip(181 * 1.035, 96.9 * 1.061)).toBe("claw");
      expect(predictGrip(181, 96.9)).toBe("fingertip");
      const plain = addScan({
        scan: {
          measurements: {
            handLengthMm: 181,
            palmLengthMm: 96.9,
            palmWidthMm: 77.8,
          },
          parallaxCorrected: false,
        },
      });
      const plainBody = await answer(await getOwn(plain));
      expect(plainBody.available).toBe(false);
    });

    it("reports the grip the person stated, else the one the fit predicts", async () => {
      pool = [...crowd(5, "a", 4)];
      const stated: GripStyle =
        predictGrip(186.4, 106.2) === "claw" ? "palm" : "claw";
      const scan = addScan({ scan: { gripStyleStated: stated } });
      const body = await answer(await getOwn(scan));
      expect(body.available && body.basis.gripStyle).toBe(stated);
    });

    it("is available: false while the data is thin, and the body is exactly that", async () => {
      const scan = addScan();
      const thin: PooledContribution[][] = [
        [], // nobody
        [person([["a", 5]])], // one neighbour
        [...crowd(4, "a", 5), ...crowd(4, "b", 5)], // eight neighbours, no mouse rated by five
        [...crowd(5, "a", 5)].map((c) => ({ ...c, handLengthBinMm: 250 })), // plenty, but far away
      ];
      for (const contributions of thin) {
        pool = contributions;
        const res = await getOwn(scan);
        expectNoStore(res);
        expect(await res.json()).toEqual({
          available: false,
          reason: "insufficient_data",
        });
      }
    });

    it("lists at most MAX_SIMILAR_MICE mice and always validates against the schema", async () => {
      catalogue = ["a", "b", "c", "d", "e", "f", "g"].map((s) => mouse(s));
      pool = ["a", "b", "c", "d", "e", "f", "g"].flatMap((s, i) =>
        crowd(5 + (i % 3), s, 1 + (i % 5)),
      );
      const scan = addScan();
      const body = await answer(await getOwn(scan));
      expect(body.available && body.mice).toHaveLength(MAX_SIMILAR_MICE);
    });

    it("takes brand and model from the current mice row, never from a contribution", async () => {
      pool = [...crowd(5, "a", 4)];
      const scan = addScan();
      const before = await answer(await getOwn(scan));
      expect(before.available && before.mice[0]).toMatchObject({
        brand: "Brand a",
        model: "Model a",
      });
      // The catalogue renames the mouse: the same rating rows now read new names.
      catalogue = [mouse("a", { brand: "Renamed", model: "Now" }), mouse("b")];
      const after = await answer(await getOwn(scan));
      expect(after.available && after.mice[0]).toMatchObject({
        slug: "a",
        brand: "Renamed",
        model: "Now",
      });
      // A pooled rating carries a mouse id and a number, nothing to read a name from.
      expect(Object.keys(pool[0]!.ratings[0]!).sort()).toEqual([
        "mouseId",
        "satisfaction",
      ]);
    });

    it("ignores a rating whose mouse is no longer in the catalogue", async () => {
      pool = Array.from({ length: 5 }, () =>
        person([
          ["a", 4],
          ["gone", 1],
        ]),
      );
      const scan = addScan();
      const body = await answer(await getOwn(scan));
      expect(slugs(body)).toEqual(["a"]);
    });
  });

  describe("what the caller may be shown", () => {
    // Twenty-five neighbours; B is rated by twenty of them (sixteen 5s, four
    // 4s), A by five 5s (the pair that reverses with the prior: constants.ts),
    // and U by all twenty-five as a 1. Left in, U's twenty-five 1s pull the
    // prior from 4.84 to 2.92 and put B ahead of A.
    const world = (hidden: Partial<CatalogueMouse>) => {
      catalogue = [mouse("a"), mouse("b"), mouse("u", hidden)];
      const ratings: PooledContribution[] = Array.from({ length: 25 }, (_, i) =>
        person([
          ...(i < 5 ? ([["a", 5]] as [string, number][]) : []),
          ...(i >= 5 && i < 25
            ? ([["b", i < 21 ? 5 : 4]] as [string, number][])
            : []),
          ["u", 1],
        ]),
      );
      pool = ratings;
    };

    it.each([
      ["a mouse with listed = false", { listed: false }],
      [
        "a left-handed mouse for a right-hand scan",
        { handCompatibility: "left" as const },
      ],
      ["a trackball", { formFactor: "trackball" as const }],
      ["a vertical mouse", { formFactor: "vertical" as const }],
      ["a mouse taller than the vertical ratio", { heightMm: 80 }],
    ])(
      "%s is not listed and does not move the prior",
      async (_name, hidden) => {
        world(hidden);
        const scan = addScan();
        const filtered = await answer(await getOwn(scan));
        expect(slugs(filtered)).toEqual(["a", "b"]);

        // The same pool with U left in the catalogue as an ordinary mouse: U is
        // listed, and its 1s move the order. So the check above can fail.
        catalogue = [mouse("a"), mouse("b"), mouse("u")];
        const unfiltered = await answer(await getOwn(scan));
        expect(slugs(unfiltered)).toContain("u");
        expect(slugs(unfiltered)).not.toEqual(slugs(filtered));
      },
    );

    // The route asks the engine FIT_ENGINE names for "is this mouse shown": v1,
    // v2 and v3 all hide a vertical mouse and a tall one. Before, only v1 was
    // recognised and any other id fell to v0's rule, which let a vertical mouse
    // through (found by running the suite with the default switched to v3).
    describe.each(["v1", "v2", "v3"])("with FIT_ENGINE=%s", (engine) => {
      beforeEach(() => {
        vi.stubEnv("FIT_ENGINE", engine);
      });
      afterEach(() => {
        vi.unstubAllEnvs();
      });

      it.each([
        ["a vertical mouse", { formFactor: "vertical" as const }],
        ["a mouse taller than the vertical ratio", { heightMm: 80 }],
        ["a trackball", { formFactor: "trackball" as const }],
      ])("%s is not listed and does not move the prior", async (_n, hidden) => {
        world(hidden);
        const scan = addScan();
        expect(slugs(await answer(await getOwn(scan)))).toEqual(["a", "b"]);
      });
    });

    it("never gives the engine a rating of a hidden mouse, so it cannot move any number", async () => {
      world({ listed: false });
      const scan = addScan();
      const via = await answer(await getOwn(scan));
      // What the engine says when the hidden mouse's ratings were never stored.
      const withoutU: PooledContribution[] = pool.map((c) => ({
        ...c,
        ratings: c.ratings.filter((r) => r.mouseId !== "id-u"),
      }));
      pool = withoutU;
      expect(await answer(await getOwn(scan))).toEqual(via);
    });

    it("applies the fit's rule for this hand: a left-hand scan drops a right-handed ergonomic mouse, keeps a symmetrical one", async () => {
      catalogue = [
        mouse("ergo", { handCompatibility: "right", shape: "ergonomic" }),
        mouse("sym", { handCompatibility: "right", shape: "symmetrical" }),
        mouse("ambidextrous", {
          handCompatibility: "ambidextrous",
          shape: "ergonomic",
        }),
      ];
      pool = [
        ...crowd(5, "ergo", 5),
        ...crowd(5, "sym", 4),
        ...crowd(5, "ambidextrous", 3),
      ];
      const left = addScan({ scan: { hand: "left" } });
      const right = addScan({ scan: { hand: "right" } });
      expect(slugs(await answer(await getOwn(left))).sort()).toEqual([
        "ambidextrous",
        "sym",
      ]);
      expect(slugs(await answer(await getOwn(right))).sort()).toEqual([
        "ambidextrous",
        "ergo",
        "sym",
      ]);
    });

    it("keeps a contributor as a neighbour when every rating of theirs was dropped", async () => {
      catalogue = [mouse("a"), mouse("u", { listed: false })];
      pool = [
        ...crowd(5, "a", 4),
        person([["u", 1]]), // only a hidden mouse: still a person with this hand
      ];
      const scan = addScan();
      const body = await answer(await getOwn(scan));
      expect(body.available && body.neighbours).toBe(6);
      expect(slugs(body)).toEqual(["a"]);
    });

    it("hands the engine nothing it would list: the answer matches a direct engine call on the cut pool", async () => {
      world({ listed: false });
      const scan = addScan();
      const body = await answer(await getOwn(scan));
      const direct = similarHands(
        {
          handLengthBinMm: 185,
          palmWidthBinMm: 80,
          gripStyle: predictGrip(186.4, 106.2),
          ownContributionIds: new Set(),
        },
        pool.map((c) => ({
          id: c.id,
          handLengthBinMm: c.handLengthBinMm,
          palmWidthBinMm: c.palmWidthBinMm,
          gripStyle: c.gripStyle,
          ratings: c.ratings
            .filter((r) => r.mouseId !== "id-u")
            .map((r) => {
              const slug = r.mouseId.replace("id-", "");
              return {
                slug,
                brand: `Brand ${slug}`,
                model: `Model ${slug}`,
                satisfaction: r.satisfaction,
              };
            }),
        })),
      );
      expect(body).toEqual(direct);
    });
  });

  describe("the caller's own contributions", () => {
    it("leaves out every contribution of the signed-in account, from any scan, and the prior too", async () => {
      signedInAs = "user-1";
      const scan = addScan({ userId: "user-1" });
      pool = [
        ...crowd(5, "a", 5),
        // Six earlier contributions of this account: one rates A, five rate B.
        // Counted, B would have five raters, clear the floor and enter the prior.
        person([["a", 1]], { userId: "user-1" }),
        ...Array.from({ length: 5 }, () =>
          person([["b", 1]], { userId: "user-1" }),
        ),
      ];
      const body = await answer(await get(scan.scanId));
      expect(body).toMatchObject({
        available: true,
        neighbours: 5,
        mice: [{ slug: "a", raters: 5, meanSatisfaction: 5 }],
      });
    });

    it("is available: false when the caller's own contribution was one of the five that made the floor", async () => {
      signedInAs = "user-1";
      const scan = addScan({ userId: "user-1" });
      pool = [person([["a", 5]], { userId: "user-1" }), ...crowd(4, "a", 4)];
      expect(await (await get(scan.scanId)).json()).toEqual({
        available: false,
        reason: "insufficient_data",
      });
    });

    it("leaves out the caller's own contribution that has NO ratings left (a later answer or an edit took them): it is still the caller, not a neighbour", async () => {
      signedInAs = "user-1";
      const scan = addScan({ userId: "user-1" });
      pool = [
        ...crowd(5, "a", 5),
        // This account's earlier contribution: every rating of it moved on.
        person([], { userId: "user-1" }),
      ];
      const body = await answer(await get(scan.scanId));
      // Counted as a neighbour it would make six.
      expect(body).toMatchObject({ available: true, neighbours: 5 });
    });

    it("counts every other signed-in account's contribution at the same bins: only the caller's own account is left out", async () => {
      signedInAs = "user-1";
      const scan = addScan({ userId: "user-1" });
      pool = [
        ...[5, 3, 4, 4, 4].map((n, i) =>
          person([["a", n]], { userId: `user-${i + 2}` }),
        ),
        person([["a", 1]], { userId: "user-1" }),
        person([], { userId: "user-7" }),
      ];
      const body = await answer(await get(scan.scanId));
      expect(body).toMatchObject({
        available: true,
        // user-2 to user-6, and user-7 (who has no ratings left but is a neighbour).
        neighbours: 6,
        mice: [{ slug: "a", raters: 5, meanSatisfaction: 4 }],
      });
    });

    it("counts another account's contribution, and an anonymous caller leaves out nobody", async () => {
      pool = [
        person([["a", 5]], { userId: "user-2" }),
        person([["a", 3]], { userId: "user-1" }),
        ...crowd(3, "a", 4),
      ];
      const scan = addScan();
      const body = await answer(await getOwn(scan));
      expect(body).toMatchObject({
        neighbours: 5,
        mice: [{ slug: "a", raters: 5, meanSatisfaction: 4 }],
      });
    });
  });

  describe("a typed hand size (manual-entry) is not a reference", () => {
    // Kirby, 2026-10-12 (candidate): a typed width is a skin width and the
    // pool's is a joint-centre width, so the typed scan neither joins the pool
    // nor asks it anything.
    it("answers `not enough data` for a manual-entry scan, whatever the pool holds, and never reads the pool", async () => {
      pool = [...crowd(5, "a", 5)];
      const scan = addScan({ scan: { calibrationMethod: "manual-entry" } });
      const res = await getOwn(scan);
      expectNoStore(res);
      expect(await res.json()).toEqual({
        available: false,
        reason: "insufficient_data",
      });
      expect(loadContributions).not.toHaveBeenCalled();
      expect(loadCatalogue).not.toHaveBeenCalled();
    });

    it.each([
      ["paper-edge"],
      ["user-length"],
      ["printed-sheet"],
      [null],
      [undefined],
    ] as const)(
      "a scan calibrated by %s still gets its neighbours",
      async (method) => {
        pool = [...crowd(5, "a", 5)];
        const scan = addScan({
          scan: method === undefined ? {} : { calibrationMethod: method },
        });
        const body = await answer(await getOwn(scan));
        expect(body.available).toBe(true);
        expect(loadContributions).toHaveBeenCalledTimes(1);
      },
    );

    it("the ownership check still comes first: a foreign manual-entry scan is the same 404", async () => {
      const scan = addScan({ scan: { calibrationMethod: "manual-entry" } });
      const res = await get(scan.scanId, { cookie: null });
      expect(res.status).toBe(404);
    });
  });

  describe("404", () => {
    const notFound = async (res: Response) => {
      expect(res.status).toBe(404);
      expectNoStore(res);
      expect(errorResponseSchema.parse(await res.json())).toEqual({
        error: "Scan not found.",
      });
    };

    it("an unknown scan, one that is someone else's, an expired anonymous one, all with one body", async () => {
      pool = [...crowd(3, "a", 4)];
      const mine = addScan();
      const other = addScan();
      const expired = addScan({ expiresAt: new Date(NOW.getTime() - 1) });
      const claimed = addScan({ userId: "user-1" });

      await notFound(await get(uuid(999), { cookie: mine.cookie })); // unknown
      await notFound(await get(other.scanId, { cookie: mine.cookie })); // foreign cookie
      await notFound(await get(mine.scanId)); // no cookie
      await notFound(await getOwn(expired)); // expired means gone
      await notFound(await get(claimed.scanId, { cookie: mine.cookie })); // claimed: cookie is not enough
      signedInAs = "user-2";
      await notFound(await get(claimed.scanId)); // another account
      expect(loadContributions).not.toHaveBeenCalled();
      expect(loadCatalogue).not.toHaveBeenCalled();
    });

    it("a signed-in owner is served from any browser, with no cookie", async () => {
      pool = [...crowd(5, "a", 4)];
      signedInAs = "user-1";
      const scan = addScan({ userId: "user-1" });
      expect((await get(scan.scanId)).status).toBe(200);
    });

    it.each(["not-a-uuid", "", "../session", "123", `${uuid(1)}x`])(
      "a malformed id (%j) is a 404 and the scan repo is never asked",
      async (id) => {
        const res = await get(id);
        expect(res.status).toBe(404);
        expectNoStore(res);
        expect(findOwnedScan).not.toHaveBeenCalled();
      },
    );
  });

  describe("429", () => {
    it("is refused before anything is read, keyed on the client IP, with no-store", async () => {
      const scan = addScan();
      allow.mockResolvedValue(false);
      const res = await getOwn(scan);
      expect(res.status).toBe(429);
      expectNoStore(res);
      expect(errorResponseSchema.parse(await res.json()).error).toMatch(
        /too many/i,
      );
      expect(allow).toHaveBeenCalledWith(IP);
      expect(findOwnedScan).not.toHaveBeenCalled();
      expect(loadContributions).not.toHaveBeenCalled();
    });

    it("limits a malformed id too, and never limits a request with no usable IP", async () => {
      allow.mockResolvedValue(false);
      expect((await get("nope")).status).toBe(429);
      const scan = addScan();
      expect((await getOwn(scan, { ip: null })).status).toBe(200);
      expect(allow).toHaveBeenCalledTimes(1);
    });
  });

  describe("500, headers and logs", () => {
    let lines: string[];
    beforeEach(() => {
      lines = [];
      for (const level of ["log", "warn", "error"] as const) {
        vi.spyOn(console, level).mockImplementation((line: unknown) => {
          lines.push(String(line));
        });
      }
    });
    afterEach(() => vi.restoreAllMocks());

    it("every response of every status carries Cache-Control: no-store", async () => {
      pool = [...crowd(5, "a", 4)];
      const scan = addScan();
      const responses = [
        await getOwn(scan), // 200
        await get("nope"), // 404
        await get(uuid(999)), // 404
        await getOwn(scan, {
          deps: { limiter: { allow: async () => false } },
        }), // 429
        await getOwn(scan, {
          deps: {
            similarRepo: {
              loadContributions: async () => {
                throw new Error("boom");
              },
            },
          },
        }), // 500
      ];
      expect(responses.map((r) => r.status)).toEqual([200, 404, 404, 429, 500]);
      for (const res of responses) expectNoStore(res);
    });

    it("an answer the contract does not accept is the plain fixed 500: no data in the body, no data in any log line", async () => {
      // The engine drops a rating outside 1 to 5 itself, so the schema is
      // reached with a catalogue row whose brand is not text (a bad row from
      // the database layer): the answer then fails `similarResponseSchema`.
      catalogue = [
        mouse("zq-slug", {
          brand: 424242 as unknown as string,
          model: "Quillmodel",
        }),
      ];
      pool = [...crowd(5, "zq-slug", 4)];
      const scan = addScan();
      const res = await getOwn(scan);
      expect(res.status).toBe(500);
      expectNoStore(res);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({
        error: "Something went wrong. Try again in a moment.",
      });
      expect(text).not.toMatch(/Quillmodel|zq-slug|424242|available/);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).not.toMatch(/Quillmodel|zq-slug|424242/);
        expect(line).not.toContain(scan.scanId);
        expect(line).not.toContain("similar.answered");
      }
      expect(lines.some((l) => l.includes("similar.failed"))).toBe(true);
    });

    it("a failure is the plain 500, and no log line carries a name, a bin, a rating or the scan id", async () => {
      catalogue = [mouse("a", { brand: "Zephyrbrand", model: "Quillmodel" })];
      pool = [...crowd(5, "a", 4)];
      const scan = addScan();
      await getOwn(scan); // answered
      const failed = await getOwn(scan, {
        deps: {
          similarRepo: {
            loadContributions: async () => {
              // A driver error that quotes what it was reading.
              throw Object.assign(
                new Error(
                  `select ... Zephyrbrand Quillmodel 185 80 ${scan.scanId}`,
                ),
                { code: "XX000" },
              );
            },
          },
        },
      });
      expect(failed.status).toBe(500);
      expect(errorResponseSchema.parse(await failed.json())).toEqual({
        error: "Something went wrong. Try again in a moment.",
      });
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).not.toMatch(/Zephyrbrand|Quillmodel|\b185\b|\b80\b/);
        expect(line).not.toContain(scan.scanId);
      }
      expect(lines.some((l) => l.includes("similar.answered"))).toBe(true);
      expect(lines.some((l) => l.includes("similar.failed"))).toBe(true);
    });
  });
});
