import type {
  HandMeasurements,
  ScanSubmission,
} from "../../lib/contracts/measurement";

export interface SessionRecord {
  id: string;
}

export interface ScanInsertInput {
  sessionId: string;
  hand: ScanSubmission["hand"];
  gripStyleStated: ScanSubmission["gripStyleStated"] | null;
  measurements: HandMeasurements;
  /** `calibration.cardScaleRatio` — sheet-vs-card scale agreement. */
  scaleCheckRatio: number;
}

/**
 * The DB seam for the scan API. Route handlers wire `drizzle-repo.ts`'s real
 * implementation; unit tests inject an in-memory fake — no real database in
 * unit tests (AGENTS.md, issue #11).
 */
export interface ScanRepo {
  /** Null if the id is unknown, or known but past `expiresAt`. */
  findValidSession(sessionId: string, now: Date): Promise<SessionRecord | null>;
  createAnonymousSession(expiresAt: Date): Promise<SessionRecord>;
  /** Inserts `scans` and `scan_measurements` atomically. */
  insertScanWithMeasurements(
    input: ScanInsertInput,
  ): Promise<{ scanId: string }>;
  /**
   * Cascades to `scans` and `scan_measurements`. No-op if unknown, and no-op
   * if the session has already been claimed by a signed-in user (`user_id`
   * set) — this is the `pagehide` beacon's target, which the client only
   * fires for anonymous callers (issue #17), but the guard is enforced here
   * too so a claimed session can never be deleted this way, only through
   * `/account`'s explicit delete-everything.
   */
  deleteSession(sessionId: string): Promise<void>;
  /** Returns the number of rows removed. */
  deleteExpiredAnonymousSessions(now: Date): Promise<number>;
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
}
