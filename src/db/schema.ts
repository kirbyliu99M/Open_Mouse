import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  ANALYSIS_SOURCES,
  type AnalysisOutput,
} from "../lib/contracts/analysis";
import {
  CONNECTIVITY,
  FRONT_FLARES,
  HAND_COMPATIBILITY,
  HUMP_PLACEMENTS,
  SHAPES,
  SIDE_CURVATURES,
  SIZES,
} from "../lib/contracts/descriptors";
import { CALIBRATION_METHODS } from "../lib/contracts/measurement";
import {
  CONTRIBUTION_BIN_MM,
  MAX_FEEDBACK_CHARS,
  type PainPoint,
} from "../lib/contracts/survey";

// Infrastructure only, from M0. Proves the migration pipeline end to end.
export const scaffoldChecks = pgTable("scaffold_checks", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sizeEnum = pgEnum("mouse_size", SIZES);
export const shapeEnum = pgEnum("mouse_shape", SHAPES);
export const handCompatibilityEnum = pgEnum(
  "hand_compatibility",
  HAND_COMPATIBILITY,
);
export const humpPlacementEnum = pgEnum("hump_placement", HUMP_PLACEMENTS);
export const frontFlareEnum = pgEnum("front_flare", FRONT_FLARES);
export const sideCurvatureEnum = pgEnum("side_curvature", SIDE_CURVATURES);
export const connectivityEnum = pgEnum("connectivity", CONNECTIVITY);
export const descriptorMethodEnum = pgEnum("descriptor_method", [
  "rubric_vision",
  "manual",
]);
export const calibrationMethodEnum = pgEnum(
  "calibration_method",
  CALIBRATION_METHODS,
);
export const gripStyleEnum = pgEnum("grip_style", [
  "palm",
  "claw",
  "fingertip",
]);
export const handSideEnum = pgEnum("hand_side", ["left", "right"]);

const mm = (name: string) =>
  numeric(name, { precision: 5, scale: 1, mode: "number" });
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/**
 * The catalogue. Dimensions come from first-party spec pages only; `size` is
 * computed (see computeSize); visual descriptors stay null until classified.
 */
export const mice = pgTable(
  "mice",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    brand: text("brand").notNull(),
    model: text("model").notNull(),
    lengthMm: mm("length_mm").notNull(),
    widthMm: mm("width_mm").notNull(),
    heightMm: mm("height_mm").notNull(),
    weightG: mm("weight_g"),
    connectivity: connectivityEnum("connectivity"),
    size: sizeEnum("size").notNull(),
    shape: shapeEnum("shape"),
    handCompatibility: handCompatibilityEnum("hand_compatibility"),
    humpPlacement: humpPlacementEnum("hump_placement"),
    frontFlare: frontFlareEnum("front_flare"),
    sideCurvature: sideCurvatureEnum("side_curvature"),
    thumbRest: boolean("thumb_rest"),
    ringFingerRest: boolean("ring_finger_rest"),
    sourceUrl: text("source_url").notNull(),
    specRetrievedAt: timestamp("spec_retrieved_at", {
      withTimezone: true,
    }).notNull(),
    descriptorMethod: descriptorMethodEnum("descriptor_method"),
    descriptorModel: text("descriptor_model"),
    descriptorSourceUrls: jsonb("descriptor_source_urls").$type<string[]>(),
    classifiedAt: timestamp("classified_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("mice_brand_model_unique").on(t.brand, t.model),
    check(
      "mice_dimensions_positive",
      sql`${t.lengthMm} > 0 AND ${t.widthMm} > 0 AND ${t.heightMm} > 0`,
    ),
    check(
      "mice_weight_positive",
      sql`${t.weightG} IS NULL OR ${t.weightG} > 0`,
    ),
    check("mice_source_url_https", sql`${t.sourceUrl} LIKE 'https://%'`),
    // Rubric §2 consistency rules — also enforced in code, this is the backstop.
    check(
      "mice_ambidextrous_is_symmetrical",
      sql`${t.handCompatibility} <> 'ambidextrous' OR ${t.shape} = 'symmetrical'`,
    ),
    check(
      "mice_thumb_rest_is_ergonomic",
      sql`${t.thumbRest} IS NOT TRUE OR ${t.shape} = 'ergonomic'`,
    ),
    check(
      "mice_ring_rest_is_ergonomic",
      sql`${t.ringFingerRest} IS NOT TRUE OR ${t.shape} = 'ergonomic'`,
    ),
  ],
);

/** Shaped for the Auth.js Drizzle adapter so M6 can adopt it unchanged. */
export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", {
    mode: "date",
    withTimezone: true,
  }),
  image: text("image"),
});

/**
 * Auth.js (v5) Drizzle adapter tables (M6, issue #17). Table names are
 * chosen freely — `DrizzleAdapter(db, { usersTable, accountsTable,
 * sessionsTable, verificationTokensTable })` is given this exact mapping in
 * `src/auth.ts`, so nothing here needs Auth.js's default `user`/`account`/
 * `session` table names. `users` above already has the shape the adapter
 * needs. Column *property* names on `accounts` below do have to match
 * `@auth/drizzle-adapter`'s `DefaultPostgresAccountsTable` type exactly
 * (`refresh_token`, not `refreshToken`) — the adapter's internal code reads
 * these as JS object keys, not through the SQL column name.
 *
 * Named `authSessions` (table `auth_sessions`) to keep this fully distinct
 * from `scanSessions` (table `scan_sessions`) below, which is this app's own
 * concept and predates Auth.js.
 */
export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.providerAccountId] }),
    index("accounts_user_id_idx").on(t.userId),
  ],
);

export const authSessions = pgTable("auth_sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

/**
 * Anonymous sessions must expire; signed-in ones need not. Everything below
 * cascades from here, so the M6 cleanup sweep is one DELETE on this table.
 */
export const scanSessions = pgTable(
  "scan_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "scan_sessions_anonymous_expire",
      sql`${t.userId} IS NOT NULL OR ${t.expiresAt} IS NOT NULL`,
    ),
    index("scan_sessions_expires_at_idx").on(t.expiresAt),
  ],
);

export const scans = pgTable("scans", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => scanSessions.id, { onDelete: "cascade" }),
  hand: handSideEnum("hand").notNull(),
  gripStyleStated: gripStyleEnum("grip_style_stated"),
  gripStylePredicted: gripStyleEnum("grip_style_predicted"),
  /**
   * Migration 0007: set once, when this scan's hand profile was contributed to
   * the survey (`POST /api/survey`), which is what makes a second submission
   * for the same scan a 409. It lives on the scan and goes with it. The
   * contribution itself never points back here (see `surveyContributions`).
   *
   * Migrate BEFORE deploying code that has this column. Drizzle's
   * `db.insert(scans).values(...)` names EVERY column of this table in the
   * INSERT (the ones not given are written as `default`), so with this code
   * live and 0007 not yet applied, `POST /api/scans` (`insertScanWithMeasurements`)
   * fails with `column "survey_contributed_at" of relation "scans" does not
   * exist`, not only the survey routes and the account's "Delete everything".
   * The other way round is safe: code that predates 0007 never names the
   * column, and the migration only adds it (nullable, no default). Only a
   * select with an explicit column list, which is what every existing scans
   * read uses, leaves it out.
   */
  surveyContributedAt: timestamp("survey_contributed_at", {
    withTimezone: true,
  }),
  createdAt: createdAt(),
});

/** Derived millimetres only — images never reach the server. */
export const scanMeasurements = pgTable(
  "scan_measurements",
  {
    scanId: uuid("scan_id")
      .primaryKey()
      .references(() => scans.id, { onDelete: "cascade" }),
    handLengthMm: mm("hand_length_mm").notNull(),
    palmLengthMm: mm("palm_length_mm").notNull(),
    palmWidthMm: mm("palm_width_mm").notNull(),
    thumbLengthMm: mm("thumb_length_mm"),
    indexLengthMm: mm("index_length_mm"),
    middleLengthMm: mm("middle_length_mm"),
    ringLengthMm: mm("ring_length_mm"),
    pinkyLengthMm: mm("pinky_length_mm"),
    palmThicknessMm: mm("palm_thickness_mm"),
    knuckleHeightMm: mm("knuckle_height_mm"),
    gripApertureMm: mm("grip_aperture_mm"),
    thumbAngleDeg: mm("thumb_angle_deg"),
    scaleCheckRatio: numeric("scale_check_ratio", {
      precision: 6,
      scale: 4,
      mode: "number",
    }),
    // #63 — the measurement model and calibration evidence the client sent,
    // kept with the scan (and deleted with it). Nullable: rows written before
    // migration 0006 have neither.
    measurementModelVersion: text("measurement_model_version"),
    calibrationMethod: calibrationMethodEnum("calibration_method"),
    calibrationEvidence: jsonb("calibration_evidence"),
  },
  (t) => [
    check(
      "scan_measurements_plausible",
      sql`${t.handLengthMm} BETWEEN 100 AND 280 AND ${t.palmWidthMm} BETWEEN 50 AND 150 AND ${t.palmLengthMm} < ${t.handLengthMm}`,
    ),
  ],
);

const score = (name: string) => smallint(name).notNull();

export const fitResults = pgTable(
  "fit_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => scans.id, { onDelete: "cascade" }),
    mouseId: uuid("mouse_id")
      .notNull()
      .references(() => mice.id, { onDelete: "cascade" }),
    engineVersion: text("engine_version").notNull(),
    rank: smallint("rank").notNull(),
    totalScore: score("total_score"),
    lengthScore: score("length_score"),
    gripWidthScore: score("grip_width_score"),
    heightHumpScore: score("height_hump_score"),
    frontFlareScore: score("front_flare_score"),
    thumbScore: score("thumb_score"),
    weightScore: score("weight_score"),
    reasons: jsonb("reasons").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("fit_results_scan_mouse_version").on(
      t.scanId,
      t.mouseId,
      t.engineVersion,
    ),
    check(
      "fit_results_scores_bounded",
      sql`${t.totalScore} BETWEEN 0 AND 100 AND ${t.lengthScore} BETWEEN 0 AND 100 AND ${t.gripWidthScore} BETWEEN 0 AND 100 AND ${t.heightHumpScore} BETWEEN 0 AND 100 AND ${t.frontFlareScore} BETWEEN 0 AND 100 AND ${t.thumbScore} BETWEEN 0 AND 100 AND ${t.weightScore} BETWEEN 0 AND 100`,
    ),
  ],
);

export const analysisSourceEnum = pgEnum("analysis_source", ANALYSIS_SOURCES);

/**
 * Persists Gemini analysis answers across serverless instances/deploys,
 * keyed by scan and `computeCacheKey`'s sha256 hash
 * (`src/server/analysis/cache.ts`). Rows live exactly as long as their scan:
 * the 24-hour sweep, user deletion, and account deletion cascade to the prose
 * in the same deletion bound. Cross-scan reuse is deliberately given up;
 * identical 1 mm-rounded measurements were required for a hit anyway.
 * `DrizzleAnalysisCache` (`src/server/analysis/drizzle-cache.ts`) is the only
 * writer, and only ever inserts `source: 'model'` (issue #28 acceptance
 * criterion 2: the fallback is deterministic and free to recompute, so
 * caching it saves nothing and would keep serving stale template text after
 * a transient model failure clears). `analysisSourceEnum` still carries both
 * contract values so a row's provenance is self-describing, but the CHECK
 * below is the DB-level half of the guarantee — same "code explains a
 * violation; the DB guarantees none is stored" pattern as the rubric
 * consistency checks on `mice` above.
 */
export const analysisCache = pgTable(
  "analysis_cache",
  {
    scanId: uuid("scan_id")
      .notNull()
      .references(() => scans.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    output: jsonb("output").notNull().$type<AnalysisOutput>(),
    source: analysisSourceEnum("source").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.scanId, t.key] }),
    check("analysis_cache_source_is_model", sql`${t.source} = 'model'`),
  ],
);

/**
 * DB-backed fixed-window rate limiting (`src/server/analysis/rate-limit.ts`
 * has the pure window decision; `drizzle-rate-limiter.ts` the atomic
 * upsert-increment this table backs). One row per limited key; `windowStart`
 * is an epoch-ms fixed-window boundary, not a timestamp column, so the
 * atomic upsert can compare it with plain numeric equality instead of
 * dealing with timestamp/timezone round-tripping through the HTTP driver.
 */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: bigint("window_start", { mode: "number" }).notNull(),
  count: integer("count").notNull(),
});

// --- Survey (migration 0007, contract: src/lib/contracts/survey.ts) -------
//
// Everything about names, lists, wording and thresholds here is a candidate
// (未拍板) until Kirby confirms it.
//
// What these tables hold, and what they deliberately do not:
//   - no `scan_id`, no `session_id`, no foreign key to `scans` or
//     `scan_sessions`: a contribution survives the 24 h anonymous expiry and
//     must not point back to the scan it came from. The only link in either
//     direction is `scans.survey_contributed_at`, a mark on the scan that goes
//     with it.
//   - no timestamp finer than a day. The mark on the scan carries the exact
//     instant, so an exact instant here would let anyone with database access
//     match the contribution to the scan by time. `consented_at` is therefore
//     the start of the UTC day (a CHECK enforces it) and there is no
//     `created_at`.
//   - `feedback` (the one free-text field) and `survey_other_mice.brand` (a
//     slug picked from the contract's `OTHER_MOUSE_BRANDS`, contract v3) are
//     read by the maintainers only; no response schema carries either.
//   - the answer lists (duration, pain points, main use, size feel) are plain
//     text, not enums or CHECKs: the lists are candidates, and the contract's
//     schema is what refuses a value outside them, so a list change is not a
//     migration. The bin sizes, ranges and text lengths are stable shape and
//     are CHECKed here. The comment length imports the contract's constant, so
//     a contract change shows up as drift in `db:check`; the brand and the
//     other short text columns have a sane length bound of their own that does
//     not follow the contract (a brand is a short slug, so 32 characters is
//     room for any list the contract is likely to grow into; the list itself
//     is the schema's to enforce, not a CHECK, so adding a brand is not a
//     migration).
const BIN = sql.raw(String(CONTRIBUTION_BIN_MM));
const BRAND_SLUG_MAX_CHARS = 32;

export const surveyContributions = pgTable(
  "survey_contributions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Set for a signed-in contributor only; null is an anonymous contribution. */
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    consentVersion: text("consent_version").notNull(),
    /** Start of the UTC day on which the person ticked the consent. */
    consentedAt: timestamp("consented_at", { withTimezone: true }).notNull(),
    /** Hand length rounded DOWN to `CONTRIBUTION_BIN_MM`. */
    handLengthBinMm: smallint("hand_length_bin_mm").notNull(),
    /** Palm width rounded DOWN to `CONTRIBUTION_BIN_MM`. */
    palmWidthBinMm: smallint("palm_width_bin_mm").notNull(),
    gripStyle: gripStyleEnum("grip_style").notNull(),
    mainUse: text("main_use"),
    feedback: text("feedback"),
  },
  (t) => [
    index("survey_contributions_user_id_idx").on(t.userId),
    check(
      "survey_contributions_bins",
      // The ranges are the scan's own plausibility ranges
      // (`scan_measurements_plausible`) rounded down to the bin.
      sql`${t.handLengthBinMm} BETWEEN 100 AND 280 AND ${t.handLengthBinMm} % ${BIN} = 0 AND ${t.palmWidthBinMm} BETWEEN 50 AND 150 AND ${t.palmWidthBinMm} % ${BIN} = 0`,
    ),
    check(
      "survey_contributions_consented_on_a_day",
      sql`(${t.consentedAt} AT TIME ZONE 'UTC') = date_trunc('day', ${t.consentedAt} AT TIME ZONE 'UTC')`,
    ),
    check(
      "survey_contributions_consent_version_set",
      sql`char_length(${t.consentVersion}) BETWEEN 1 AND 100`,
    ),
    check(
      "survey_contributions_main_use_length",
      sql`${t.mainUse} IS NULL OR char_length(${t.mainUse}) BETWEEN 1 AND 40`,
    ),
    check(
      "survey_contributions_feedback_length",
      sql`${t.feedback} IS NULL OR char_length(${t.feedback}) BETWEEN 1 AND ${sql.raw(String(MAX_FEEDBACK_CHARS))}`,
    ),
  ],
);

/**
 * One person's rating of one catalogue mouse. `user_id` repeats the
 * contribution's, so a signed-in person has at most one rating per mouse across
 * every contribution (partial unique index) and a later one replaces it.
 */
export const surveyRatings = pgTable(
  "survey_ratings",
  {
    contributionId: uuid("contribution_id")
      .notNull()
      .references(() => surveyContributions.id, { onDelete: "cascade" }),
    mouseId: uuid("mouse_id")
      .notNull()
      .references(() => mice.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    satisfaction: smallint("satisfaction").notNull(),
    duration: text("duration"),
    // jsonb rather than text[]: the same HTTP-driver path `calibration_evidence`
    // already uses, and the list is a candidate.
    painPoints: jsonb("pain_points")
      .$type<PainPoint[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    isCurrent: boolean("is_current").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.contributionId, t.mouseId] }),
    uniqueIndex("survey_ratings_user_mouse_unique")
      .on(t.userId, t.mouseId)
      .where(sql`${t.userId} IS NOT NULL`),
    index("survey_ratings_mouse_id_idx").on(t.mouseId),
    check(
      "survey_ratings_satisfaction_range",
      sql`${t.satisfaction} BETWEEN 1 AND 5`,
    ),
    check(
      "survey_ratings_pain_points_array",
      sql`jsonb_typeof(${t.painPoints}) = 'array'`,
    ),
  ],
);

/**
 * A mouse that is not in the catalogue: the brand slug the person picked from
 * the contract's `OTHER_MOUSE_BRANDS`, and how its size felt. A signed-in person
 * has one row per brand slug (partial unique index), so every brand that is not
 * listed, being the one slug `other`, is one row.
 */
export const surveyOtherMice = pgTable(
  "survey_other_mice",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contributionId: uuid("contribution_id")
      .notNull()
      .references(() => surveyContributions.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    brand: text("brand").notNull(),
    sizeFeel: text("size_feel").notNull(),
    isCurrent: boolean("is_current").notNull().default(false),
  },
  (t) => [
    index("survey_other_mice_contribution_id_idx").on(t.contributionId),
    uniqueIndex("survey_other_mice_user_brand_unique")
      .on(t.userId, t.brand)
      .where(sql`${t.userId} IS NOT NULL`),
    check(
      "survey_other_mice_brand_length",
      sql`char_length(${t.brand}) BETWEEN 1 AND ${sql.raw(String(BRAND_SLUG_MAX_CHARS))}`,
    ),
    check(
      "survey_other_mice_size_feel_length",
      sql`char_length(${t.sizeFeel}) BETWEEN 1 AND 40`,
    ),
  ],
);
