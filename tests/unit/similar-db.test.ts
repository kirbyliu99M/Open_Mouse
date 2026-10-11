/**
 * The similar-hand route against the real repos on PGlite (a real Postgres with
 * the repo's own migrations): the pool query, and the handler end to end with
 * the real scan repo, fit repo and similar repo. Catches what the in-memory
 * fakes of similar-service.test.ts cannot: a column that maps wrong, a join that
 * drops a contribution, a `mice` row's `listed` and `form_factor` as the
 * database stores them, and that the route never deletes or rewrites a `mice`
 * row (neighbours.ts, item 3).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

import { similarResponseSchema } from "../../src/lib/contracts/recommend";
import { createDrizzleFitRepo } from "../../src/server/fit/drizzle-repo";
import { createDrizzleSimilarRepo } from "../../src/server/recommend/drizzle-repo";
import { handleSimilar } from "../../src/server/recommend/service";
import { NOW, createPgliteSurveyWorld } from "./fixtures/survey-world";

type PgWorld = Awaited<ReturnType<typeof createPgliteSurveyWorld>>;

let world: PgWorld;

beforeAll(async () => {
  world = await createPgliteSurveyWorld();
});
afterAll(() => world.close());
beforeEach(async () => {
  await world.reset();
  await world.addUser("user-1");
  await world.addUser("user-2");
});

type Db = NonNullable<Parameters<typeof createDrizzleSimilarRepo>[0]>;
const similarRepo = () => createDrizzleSimilarRepo(world.db as Db);
const fitRepo = () => createDrizzleFitRepo(world.db as Db);

/** One contribution with its ratings; returns its id. */
async function contribute(
  options: {
    userId?: string | null;
    hand?: number;
    palm?: number;
    grip?: "palm" | "claw" | "fingertip";
    ratings?: [mouseId: string, satisfaction: number][];
  } = {},
): Promise<string> {
  const { rows } = await world.pg.query<{ id: string }>(
    `insert into survey_contributions
       (user_id, consent_version, consented_at, hand_length_bin_mm, palm_width_bin_mm, grip_style)
     values ($1, 'v1', date_trunc('day', now() at time zone 'UTC') at time zone 'UTC', $2, $3, $4)
     returning id`,
    [
      options.userId ?? null,
      options.hand ?? 185,
      options.palm ?? 80,
      options.grip ?? "palm",
    ],
  );
  const id = rows[0]!.id;
  for (const [mouseId, satisfaction] of options.ratings ?? []) {
    await world.pg.query(
      `insert into survey_ratings (contribution_id, mouse_id, user_id, satisfaction)
       values ($1, $2, $3, $4)`,
      [id, mouseId, options.userId ?? null, satisfaction],
    );
  }
  return id;
}

describe("the pool query on PGlite", () => {
  it("is empty with no contribution", async () => {
    expect(await similarRepo().loadContributions()).toEqual([]);
  });

  it("returns every contribution once, with its bins, grip, account and ratings", async () => {
    const a = await world.addMouse("mouse-a");
    const b = await world.addMouse("mouse-b");
    const first = await contribute({
      userId: "user-1",
      hand: 190,
      palm: 85,
      grip: "claw",
      ratings: [
        [a, 5],
        [b, 2],
      ],
    });
    const second = await contribute({ ratings: [[a, 3]] });
    const empty = await contribute({ hand: 175, palm: 75 }); // every rating replaced

    const loaded = await similarRepo().loadContributions();
    const byId = new Map(loaded.map((c) => [c.id, c]));
    expect(loaded).toHaveLength(3);

    const one = byId.get(first)!;
    expect(one).toMatchObject({
      userId: "user-1",
      handLengthBinMm: 190,
      palmWidthBinMm: 85,
      gripStyle: "claw",
    });
    expect(
      [...one.ratings].sort((x, y) => x.satisfaction - y.satisfaction),
    ).toEqual([
      { mouseId: b, satisfaction: 2 },
      { mouseId: a, satisfaction: 5 },
    ]);
    expect(byId.get(second)).toMatchObject({
      userId: null,
      ratings: [{ mouseId: a, satisfaction: 3 }],
    });
    // A contribution with no rating left is still a person with that hand.
    expect(byId.get(empty)).toMatchObject({
      handLengthBinMm: 175,
      palmWidthBinMm: 75,
      ratings: [],
    });
  });
});

describe("handleSimilar on PGlite", () => {
  let signedInAs: string | null;
  beforeEach(() => {
    signedInAs = null;
  });

  const get = (scanId: string, cookie: string | null) =>
    handleSimilar(
      new Request(`http://localhost/api/scans/${scanId}/similar`, {
        headers: cookie ? { cookie: `scan_session=${cookie}` } : {},
      }),
      scanId,
      {
        scanRepo: world.scanRepo,
        fitRepo: fitRepo(),
        similarRepo: similarRepo(),
        limiter: { allow: () => true },
        getUserId: async () => signedInAs,
        now: () => NOW,
      },
    );

  const miceRows = async () =>
    (await world.pg.query(`select * from mice order by slug`)).rows;

  it("answers from the stored rows: names from mice, hidden mice out, own account out, mice rows untouched", async () => {
    const a = await world.addMouse("mouse-a");
    const hidden = await world.addMouse("mouse-hidden");
    const trackball = await world.addMouse("mouse-trackball");
    await world.pg.query(`update mice set listed = false where id = $1`, [
      hidden,
    ]);
    await world.pg.query(
      `update mice set form_factor = 'trackball' where id = $1`,
      [trackball],
    );
    await world.pg.query(
      `update mice set brand = 'Acme', model = 'Zed' where id = $1`,
      [a],
    );

    signedInAs = "user-1";
    const scan = await world.addScan({
      userId: "user-1",
      handLengthMm: 186.4,
      palmWidthMm: 82.7,
    });
    await contribute({
      ratings: [
        [a, 5],
        [hidden, 1],
        [trackball, 1],
      ],
    });
    await contribute({
      ratings: [
        [a, 3],
        [hidden, 1],
        [trackball, 1],
      ],
    });
    // The caller's own contribution, from another scan: left out.
    await contribute({
      userId: "user-1",
      ratings: [
        [a, 1],
        [hidden, 1],
      ],
    });

    const before = await miceRows();
    const res = await get(scan.scanId, scan.cookieSessionId);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = similarResponseSchema.parse(await res.json());
    expect(body).toEqual({
      available: true,
      neighbours: 2,
      basis: {
        handLengthBinMm: 185,
        palmWidthBinMm: 80,
        // 186.4 mm long, palm 106.2 mm: whatever the fit predicts for it.
        gripStyle: expect.stringMatching(/^(palm|claw|fingertip)$/),
      },
      mice: [
        {
          slug: "mouse-a",
          brand: "Acme",
          model: "Zed",
          raters: 2,
          meanSatisfaction: 4,
        },
      ],
    });
    // Reading never rewrites or deletes a catalogue row.
    expect(await miceRows()).toEqual(before);
  });

  it("is a 404 for another account's scan and available: false for a thin pool", async () => {
    const a = await world.addMouse("mouse-a");
    const scan = await world.addScan({ userId: "user-1" });
    await contribute({ ratings: [[a, 4]] });

    signedInAs = "user-2";
    expect((await get(scan.scanId, null)).status).toBe(404);

    signedInAs = "user-1";
    const res = await get(scan.scanId, null);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      available: false,
      reason: "insufficient_data",
    });
  });
});
