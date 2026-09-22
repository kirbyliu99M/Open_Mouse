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
  /** Cascades to `scans` and `scan_measurements`. No-op if unknown. */
  deleteSession(sessionId: string): Promise<void>;
  /** Returns the number of rows removed. */
  deleteExpiredAnonymousSessions(now: Date): Promise<number>;
}
