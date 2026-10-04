import type {
  CalibrationMethod,
  HandMeasurements,
  MeasurementModelVersion,
  ScanSubmission,
} from "../../lib/contracts/measurement";

export interface SessionRecord {
  id: string;
}

/**
 * A session a caller may write scans into (`findValidSession`), with who
 * owns it: `userId` is null for an anonymous (unclaimed, unexpired) session.
 */
export interface UsableSession extends SessionRecord {
  userId: string | null;
}

/** A scan's hand + measurements, returned only once ownership is proven. */
export interface OwnedScan {
  hand: ScanSubmission["hand"];
  gripStyleStated: ScanSubmission["gripStyleStated"] | null;
  measurements: HandMeasurements;
}

/**
 * What `findOwnedScan` checks a scan against — the ownership rule in
 * `src/lib/contracts/routes.ts`'s header, resolved independently of any one
 * caller identity so a signed-in user's own cookie need not be involved.
 */
export interface ScanOwnershipContext {
  /** The signed-in caller's user id, or null when not signed in. */
  userId: string | null;
  /** The session id named by the caller's own anonymous session cookie, or
   * null when the cookie is absent. */
  cookieSessionId: string | null;
  now: Date;
}

export interface ScanInsertInput {
  sessionId: string;
  hand: ScanSubmission["hand"];
  gripStyleStated: ScanSubmission["gripStyleStated"] | null;
  measurements: HandMeasurements;
  /** `calibration.cardScaleRatio` — sheet-vs-card scale agreement; null
   * for a plain-paper scan, which has no card. */
  scaleCheckRatio: number | null;
  /** #63: which measurement model and calibration path produced these
   * numbers, and the evidence the client sent for it. */
  measurementModelVersion: MeasurementModelVersion;
  calibrationMethod: CalibrationMethod;
  calibrationEvidence: ScanSubmission["calibration"];
}

/**
 * The DB seam for the scan API. Route handlers wire `drizzle-repo.ts`'s real
 * implementation; unit tests inject an in-memory fake — no real database in
 * unit tests (AGENTS.md, issue #11).
 */
export interface ScanRepo {
  /**
   * The session `sessionId` names, but only if the caller — signed in as
   * `userId`, or anonymous when null — may write a scan into it (issue #52):
   *
   * - anonymous caller (`userId` null): the session must be unclaimed
   *   (`user_id IS NULL`) and unexpired. A claimed session is never returned,
   *   even though its row still exists — the browser may simply have kept the
   *   cookie after sign-out.
   * - signed-in caller: the session is the caller's own (`user_id = userId`,
   *   which never expires), or it is unclaimed and unexpired (the caller
   *   claims it next — see `claimSession`). A session claimed by anyone else
   *   is never returned.
   *
   * Null in every other case: unknown id, expired, or someone else's. The
   * returned `userId` tells the caller whether a claim is still needed.
   */
  findValidSession(
    sessionId: string,
    userId: string | null,
    now: Date,
  ): Promise<UsableSession | null>;
  createAnonymousSession(expiresAt: Date): Promise<SessionRecord>;
  /**
   * A new session already owned by `userId`: `user_id` set, `expires_at`
   * NULL (allowed by the `scan_sessions_anonymous_expire` CHECK). For a
   * signed-in caller whose cookie names no usable session.
   */
  createClaimedSession(userId: string): Promise<SessionRecord>;
  /** Inserts `scans` and `scan_measurements` atomically. */
  insertScanWithMeasurements(
    input: ScanInsertInput,
  ): Promise<{ scanId: string }>;
  /** Session-wide delete for the separate /api/scans/session endpoint. */
  deleteSession(sessionId: string): Promise<void>;
  /** Returns the number of rows removed. */
  deleteExpiredAnonymousSessions(now: Date): Promise<number>;
  /**
   * Deletes `rate_limits` rows whose fixed window has definitely ended (L2
   * hardening finding — run from the same cron path as
   * `deleteExpiredAnonymousSessions`, `./expire-cron.ts`). Also how any
   * pre-hardening row that stored a raw IP as its key eventually ages out:
   * once its window is old enough, this sweep removes it like any other
   * stale row. Returns the number of rows removed.
   */
  deleteEndedRateLimitWindows(now: Date): Promise<number>;
  /**
   * Attaches an anonymous session to a signed-in user, in one statement:
   * `user_id` is set and `expires_at` cleared only when `sessionId` names a
   * row that is *unclaimed* (`user_id IS NULL`) and not already expired
   * (expired means gone — issue #17 spec amendment). Never reassigns a
   * session that already belongs to someone else; idempotent no-op
   * otherwise. `sessionId` must come only from the caller's own httpOnly
   * cookie — see `src/server/auth/claim.ts`.
   */
  claimSession(sessionId: string, userId: string, now: Date): Promise<void>;

  /**
   * Loads a scan's hand + measurements, but ONLY when `ctx` proves
   * ownership per the rule in `src/lib/contracts/routes.ts`'s header:
   * either the scan's session carries `ctx.userId` (from any browser, once
   * claimed — see `claimSession`), or `ctx.cookieSessionId` names that same
   * session and it has not expired. Null in every other case — unknown
   * scan, a different owner, an expired anonymous session — so every
   * non-owner sees exactly the same 404 (issue #27, criterion 2). Never
   * validates `scanId`'s format itself; callers reject a malformed id
   * before it ever reaches the database.
   */
  findOwnedScan(
    scanId: string,
    ctx: ScanOwnershipContext,
  ): Promise<OwnedScan | null>;
  /** Deletes one owned scan atomically. False for unknown, foreign, expired, or already deleted. */
  deleteOwnedScan(scanId: string, ctx: ScanOwnershipContext): Promise<boolean>;
}
