/**
 * Seeds for the inactive-account purge tests on PGlite (the repo's own
 * migrations applied): accounts with every kind of child row, and the knobs the
 * purge reads (last activity, scan age, session expiry). Every time is written
 * as an offset from the DATABASE's `now()`, because that is the clock the purge
 * uses. Not a test file itself.
 */
import { SURVEY_CONSENT_VERSION } from "../../../src/lib/contracts/survey";
import { startOfUtcDay } from "../../../src/server/survey/profile";
import { NOW, type SurveyWorld } from "./survey-world";
import { USE_A, FEEL_RIGHT, BRAND_A } from "./survey-values";
import type { PGlite } from "@electric-sql/pglite";

export type PurgeWorld = SurveyWorld & { pg: PGlite; db: object };

/** Every table that holds a row of one user, and how to count it. */
export const USER_TABLES: Record<string, string> = {
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
  result_feedback: `select count(*)::int as n from result_feedback where user_id = $1`,
};

export async function counts(
  pg: PGlite,
  userId: string,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [table, sql] of Object.entries(USER_TABLES)) {
    const { rows } = await pg.query<{ n: number }>(sql, [userId]);
    out[table] = rows[0]!.n;
  }
  return out;
}

/**
 * Row counts of the WHOLE of each user-owned table, not filtered by user. A
 * count by `user_id` reads 0 for a row that a changed foreign key
 * (`ON DELETE SET NULL`) left behind as an anonymous row; a whole-table count
 * does not. Compare it with the counts of the accounts that must survive.
 */
export async function tableTotals(pg: PGlite): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of Object.keys(USER_TABLES)) {
    const { rows } = await pg.query<{ n: number }>(
      `select count(*)::int as n from ${table}`,
    );
    out[table] = rows[0]!.n;
  }
  return out;
}

/** Primary-key values of every row of the user, per table, for an id-level check. */
const ROW_IDS: Record<string, { own: string; all: string }> = {
  users: {
    own: `select id::text as k from users where id = $1`,
    all: `select id::text as k from users`,
  },
  scan_sessions: {
    own: `select id::text as k from scan_sessions where user_id = $1`,
    all: `select id::text as k from scan_sessions`,
  },
  scans: {
    own: `select s.id::text as k from scans s join scan_sessions ss on ss.id = s.session_id where ss.user_id = $1`,
    all: `select id::text as k from scans`,
  },
  scan_measurements: {
    own: `select m.scan_id::text as k from scan_measurements m join scans s on s.id = m.scan_id join scan_sessions ss on ss.id = s.session_id where ss.user_id = $1`,
    all: `select scan_id::text as k from scan_measurements`,
  },
  fit_results: {
    own: `select f.id::text as k from fit_results f join scans s on s.id = f.scan_id join scan_sessions ss on ss.id = s.session_id where ss.user_id = $1`,
    all: `select id::text as k from fit_results`,
  },
  survey_contributions: {
    own: `select id::text as k from survey_contributions where user_id = $1`,
    all: `select id::text as k from survey_contributions`,
  },
  survey_ratings: {
    own: `select (contribution_id::text || ':' || mouse_id::text) as k from survey_ratings where user_id = $1`,
    all: `select (contribution_id::text || ':' || mouse_id::text) as k from survey_ratings`,
  },
  survey_other_mice: {
    own: `select id::text as k from survey_other_mice where user_id = $1`,
    all: `select id::text as k from survey_other_mice`,
  },
  result_feedback: {
    own: `select id::text as k from result_feedback where user_id = $1`,
    all: `select id::text as k from result_feedback`,
  },
};

/** The ids of the user's rows, taken before a delete. */
export async function rowIds(
  pg: PGlite,
  userId: string,
): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const [table, q] of Object.entries(ROW_IDS)) {
    out[table] = (await pg.query<{ k: string }>(q.own, [userId])).rows.map(
      (r) => r.k,
    );
  }
  return out;
}

/** Of the ids taken by `rowIds`, those that still exist in the table, owner or no owner. */
export async function survivingRowIds(
  pg: PGlite,
  before: Record<string, string[]>,
): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const [table, ids] of Object.entries(before)) {
    const present = new Set(
      (await pg.query<{ k: string }>(ROW_IDS[table]!.all)).rows.map((r) => r.k),
    );
    out[table] = ids.filter((id) => present.has(id));
  }
  return out;
}

export interface SeedAccount {
  /** Postgres interval text before the database's now(): `last_active_at = now() - this`. */
  lastActiveAgo?: string;
  /** `last_active_at = now() + this` (a clock-skew value in the future). */
  lastActiveAhead?: string;
  /** Interval text; when set, the user has a scan created `now() - this`. */
  scanAgo?: string;
  /** Interval text; when set, an auth session expiring `now() + this`. */
  sessionExpiresIn?: string;
  /** Interval text; when set, an auth session that expired `now() - this`. */
  sessionExpiredAgo?: string;
}

/**
 * A user with a Google account and, per the options, sessions and one scan with
 * every kind of row under it (fit result, analysis cache, a survey
 * contribution with its rating and other-mouse row).
 */
export async function seedAccount(
  w: PurgeWorld,
  id: string,
  options: SeedAccount = {},
): Promise<void> {
  const { pg } = w;
  const lastActive = options.lastActiveAhead
    ? `now() + $3::interval`
    : `now() - $3::interval`;
  await pg.query(
    `insert into users (id, name, email, image, last_active_at)
     values ($1, 'Name', $2, 'https://example.test/a.png', ${lastActive})`,
    [
      id,
      `${id}@example.test`,
      options.lastActiveAhead ?? options.lastActiveAgo ?? "0 seconds",
    ],
  );
  await pg.query(
    `insert into accounts (user_id, type, provider, provider_account_id) values ($1, 'oauth', 'google', $2)`,
    [id, `google-${id}`],
  );
  if (options.sessionExpiresIn) {
    await pg.query(
      `insert into auth_sessions (session_token, user_id, expires) values ($1, $2, now() + $3::interval)`,
      [`${id}-live`, id, options.sessionExpiresIn],
    );
  }
  if (options.sessionExpiredAgo) {
    await pg.query(
      `insert into auth_sessions (session_token, user_id, expires) values ($1, $2, now() - $3::interval)`,
      [`${id}-dead`, id, options.sessionExpiredAgo],
    );
  }
  if (options.scanAgo === undefined) return;
  const mouseId = await w.addMouse(`mouse-${id}`);
  const scan = await w.addScan({ userId: id });
  await pg.query(
    `update scans set created_at = now() - $2::interval where id = $1`,
    [scan.scanId, options.scanAgo],
  );
  await pg.query(
    `insert into fit_results (scan_id, mouse_id, engine_version, rank, total_score, length_score, grip_width_score, height_hump_score, front_flare_score, thumb_score, weight_score, reasons) values ($1, $2, 'v1', 1, 50, 50, 50, 50, 50, 50, 50, '[]'::jsonb)`,
    [scan.scanId, mouseId],
  );
  await pg.query(
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
  if (result !== "stored") throw new Error(`seed failed: ${result}`);
  await pg.query(
    `insert into result_feedback (user_id, notice_version, stars, locale, engine_version, grip, calibration_method, top_mice, created_on) values ($1, 'n', 4, 'zh-TW', 'v1', 'claw', 'printed-sheet', '[]'::jsonb, date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')`,
    [id],
  );
}

/** An anonymous scan session (user_id NULL) with a scan, however old. */
export async function seedAnonymous(
  w: PurgeWorld,
  options: { expiredAgo?: string; liveFor?: string },
): Promise<string> {
  const { pg } = w;
  const { rows } = await pg.query<{ id: string }>(
    `insert into scan_sessions (user_id, expires_at, created_at)
     values (null, ${
       options.expiredAgo ? `now() - $1::interval` : `now() + $1::interval`
     }, now() - interval '200 days') returning id`,
    [options.expiredAgo ?? options.liveFor ?? "1 hour"],
  );
  const sessionId = rows[0]!.id;
  await pg.query(
    `insert into scans (session_id, hand, created_at) values ($1, 'right', now() - interval '200 days')`,
    [sessionId],
  );
  return sessionId;
}
