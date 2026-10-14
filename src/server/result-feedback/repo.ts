import type {
  ResultFeedbackSnapshot,
  ResultFeedbackSubmission,
} from "../../lib/contracts/result-feedback";

/**
 * Everything one accepted rating writes, in one piece. The body fields come
 * from the validated body; the snapshot is read on the server from the scan
 * (`./snapshot.ts`). Nothing else comes from the client.
 */
export interface FeedbackWrite {
  /**
   * The scan that was rated. Used ONLY to set the scan's `result_feedback_at`
   * mark (and to refuse a second rating of the same scan); the stored row
   * never carries it.
   */
  scanId: string;
  /** The signed-in rater, or null for an anonymous one. */
  userId: string | null;
  noticeVersion: ResultFeedbackSubmission["notice"];
  stars: number;
  comment: string | null;
  locale: ResultFeedbackSubmission["locale"];
  snapshot: ResultFeedbackSnapshot;
  /** Start of the UTC day of the rating: nothing finer is kept on the row. */
  createdOn: Date;
  /** The exact instant, written to the scan's mark only; it goes with the scan. */
  markedAt: Date;
}

/**
 * - `stored`: the row is in, and the scan is marked.
 * - `already_rated`: the scan was marked already; nothing was written (409).
 * - `scan_gone`: the scan no longer exists (deleted or expired between the
 *   ownership check and the write); nothing was written (404).
 */
export type RecordFeedbackResult = "stored" | "already_rated" | "scan_gone";

/**
 * The DB seam for the feedback route. The route wires `drizzle-repo.ts`; unit
 * tests inject an in-memory fake.
 */
export interface ResultFeedbackRepo {
  /**
   * Writes the row and sets the scan's mark, ALL OR NOTHING. The
   * one-rating-per-scan rule is decided inside that same write, not in a check
   * before it, so two ratings of one scan at the same instant cannot both be
   * stored.
   */
  recordFeedback(write: FeedbackWrite): Promise<RecordFeedbackResult>;

  /** Whether the scan carries the mark; null when the scan does not exist. */
  isRated(scanId: string): Promise<boolean | null>;

  /**
   * Deletes every row of `userId`; returns how many. A scan's mark stays (it
   * is not feedback; it goes with the scan).
   */
  withdrawFeedback(userId: string): Promise<number>;
}
