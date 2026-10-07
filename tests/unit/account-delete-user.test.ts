/**
 * "Delete everything" deletes the account (issue #136): the `users` row with
 * the Google email, name and image goes too, and the foreign keys carry the
 * delete to `accounts`, `auth_sessions`, `scan_sessions` and everything under
 * them, and to the survey rows. Run on a real Postgres (PGlite, with the repo's
 * migrations), through the real account repo and the real handler.
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

import { handleAccountDeleteAll } from "../../src/server/account/handlers";
import type { AccountRepo } from "../../src/server/account/repo";
import { SURVEY_CONSENT_VERSION } from "../../src/lib/contracts/survey";
import { startOfUtcDay } from "../../src/server/survey/profile";
import {
  NOW,
  createPgliteSurveyWorld,
  type SurveyWorld,
} from "./fixtures/survey-world";
import { USE_A, FEEL_RIGHT, BRAND_A } from "./fixtures/survey-values";

/** Every table that holds a row of one user, and how to count it. */
const USER_TABLES: Record<string, string> = {
  users: `select count(*)::int as n from users where id = $1`,
  accounts: `select count(*)::int as n from accounts where user_id = $1`,
  auth_sessions: `select count(*)::int as n from auth_sessions where user_id = $1`,
  scan_sessions: `select count(*)::int as n from scan_sessions where user_id = $1`,
  scans: `select count(*)::int as n from scans s join scan_sessions ss on ss.id = s.session_id where ss.user_id = $1`,
  scan_measurements: `select count(*)::int as n from scan_measurements m join scans s on s.id = m.scan_id join scan_sessions ss on ss.id = s.session_id where ss.user_id = $1`,
  fit_results: `select count(*)::int as n from fit_results f join scans s on s.id = f.scan_id join scan_sessions ss on ss.id = s.session_id where ss.user_id = $1`,
  analysis_cache: `select count(*)::int as n from analysis_cache a join scans s on s.id = a.scan_id join scan_sessions ss on ss.id = s.session_id where ss.user_id = $1`,
  survey_contributions: `select count(*)::int as n from survey_contributions where user_id = $1`,
  survey_ratings: `select count(*)::int as n from survey_ratings where user_id = $1`,
  survey_other_mice: `select count(*)::int as n from survey_other_mice where user_id = $1`,
};

describe("Delete everything deletes the account, on a real Postgres", () => {
  let world: Awaited<ReturnType<typeof createPgliteSurveyWorld>>;
  let repo: AccountRepo;

  beforeAll(async () => {
    world = await createPgliteSurveyWorld();
    const { createDrizzleAccountRepo } =
      await import("../../src/server/account/drizzle-repo");
    type AccountDb = Parameters<typeof createDrizzleAccountRepo>[0];
    repo = createDrizzleAccountRepo(world.db as AccountDb);
  });
  afterAll(() => world.close());
  beforeEach(() => world.reset());

  async function counts(userId: string) {
    const out: Record<string, number> = {};
    for (const [table, sql] of Object.entries(USER_TABLES)) {
      const { rows } = await world.pg.query<{ n: number }>(sql, [userId]);
      out[table] = rows[0]!.n;
    }
    return out;
  }

  /** A user with a Google account, two browsers signed in, and one scan with
   * every kind of row under it. */
  async function seedUser(
    w: SurveyWorld & { pg: typeof world.pg },
    id: string,
  ) {
    await w.pg.query(
      `insert into users (id, name, email, image) values ($1, 'Name', $2, 'https://example.test/a.png')`,
      [id, `${id}@example.test`],
    );
    await w.pg.query(
      `insert into accounts (user_id, type, provider, provider_account_id) values ($1, 'oauth', 'google', $2)`,
      [id, `google-${id}`],
    );
    for (const token of ["a", "b"]) {
      await w.pg.query(
        `insert into auth_sessions (session_token, user_id, expires) values ($1, $2, now() + interval '1 day')`,
        [`${id}-token-${token}`, id],
      );
    }
    const mouseId = await w.addMouse(`mouse-${id}`);
    const scan = await w.addScan({ userId: id });
    await w.pg.query(
      `insert into fit_results (scan_id, mouse_id, engine_version, rank, total_score, length_score, grip_width_score, height_hump_score, front_flare_score, thumb_score, weight_score, reasons) values ($1, $2, 'v1', 1, 50, 50, 50, 50, 50, 50, 50, '[]'::jsonb)`,
      [scan.scanId, mouseId],
    );
    await w.pg.query(
      `insert into analysis_cache (scan_id, key, output, source) values ($1, 'k', '{}'::jsonb, 'model')`,
      [scan.scanId],
    );
    const result = await w.surveyRepo.recordContribution({
      scanId: scan.scanId,
      userId: id,
      consentVersion: SURVEY_CONSENT_VERSION,
      consentedAt: startOfUtcDay(NOW),
      markedAt: NOW,
      handLengthBinMm: 185,
      palmWidthBinMm: 80,
      gripStyle: "claw",
      mainUse: USE_A,
      feedback: null,
      ratings: [
        {
          mouseId,
          satisfaction: 4,
          duration: null,
          painPoints: [],
          isCurrent: false,
        },
      ],
      otherMouse: { brand: BRAND_A, sizeFeel: FEEL_RIGHT, isCurrent: false },
    });
    expect(result).toBe("stored");
  }

  it("lists every table with a user_id column, so a new one cannot be forgotten", async () => {
    const { rows } = await world.pg.query<{ table_name: string }>(
      `select distinct table_name from information_schema.columns
       where table_schema = 'public' and column_name in ('user_id', 'userId')
       order by table_name`,
    );
    expect(rows.map((r) => r.table_name).sort()).toEqual(
      Object.keys(USER_TABLES)
        .filter((t) =>
          [
            "accounts",
            "auth_sessions",
            "scan_sessions",
            "survey_contributions",
            "survey_ratings",
            "survey_other_mice",
          ].includes(t),
        )
        .sort(),
    );
  });

  it("leaves no row of the user in any table, and does not touch another user's", async () => {
    await seedUser(world, "user-1");
    await seedUser(world, "user-2");
    const before2 = await counts("user-2");
    const before1 = await counts("user-1");
    // The seed really put something in every table.
    for (const [table, n] of Object.entries(before1)) {
      expect(n, table).toBeGreaterThan(0);
    }

    const res = await handleAccountDeleteAll({
      repo,
      getUserId: async () => "user-1",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deletedScans: 1 });
    const after1 = await counts("user-1");
    for (const [table, n] of Object.entries(after1)) {
      expect(n, table).toBe(0);
    }
    expect(await counts("user-2")).toEqual(before2);
    // Not even the Google profile is left anywhere.
    const { rows } = await world.pg.query<{ n: number }>(
      `select count(*)::int as n from users where email = 'user-1@example.test'`,
    );
    expect(rows[0]!.n).toBe(0);
  });

  it("deletes the account of a user who has no scans", async () => {
    await world.addUser("user-1");

    expect(await repo.deleteAllScans("user-1")).toBe(0);

    expect((await counts("user-1")).users).toBe(0);
  });

  it("runs clearSession after the delete, and a failing clearSession still answers 200", async () => {
    await seedUser(world, "user-1");
    const order: string[] = [];
    const res = await handleAccountDeleteAll({
      repo: {
        ...repo,
        deleteAllScans: async (id) => {
          const n = await repo.deleteAllScans(id);
          order.push("deleted");
          return n;
        },
      },
      getUserId: async () => "user-1",
      clearSession: async () => {
        order.push("cleared");
        throw new Error("cookies unavailable");
      },
    });
    expect(res.status).toBe(200);
    expect(order).toEqual(["deleted", "cleared"]);
    expect((await counts("user-1")).users).toBe(0);
  });
});
