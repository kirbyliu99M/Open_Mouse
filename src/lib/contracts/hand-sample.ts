/**
 * Hand-sample contract (candidate, 未拍板; Kirby 2026-11-08).
 *
 * Palmate keeps a DE-LINKED copy of each scan's measurements by default, so the
 * site can learn the real distribution of hands (internal use only: improving
 * measurement and recommendations, and research; outside the team only
 * de-identified aggregate statistics are ever published). The person can opt
 * out on the confirm screen before the scan is sent.
 *
 * Rules every implementation MUST keep:
 *   - Opt-out, not opt-in, but only under the new notice: the server writes a
 *     sample ONLY when the submission carries `sampleNotice` equal to
 *     `HAND_SAMPLE_NOTICE_VERSION`. A client sends it when the notice was on
 *     screen and the person left "keep an anonymous copy" on. An older client
 *     (built before the notice existed) never sends it, so its scans are never
 *     copied: data collected under the old 24-hour promise is not reused
 *     (PDPA Art. 20).
 *   - No link back: the row has no `scan_id`, `session_id`, `user_id`, no
 *     foreign key to any table, and no time finer than the calendar month
 *     (UTC).
 *   - User-initiated deletes take the copy with them (privacy review
 *     2026-11-08): while the scan exists its copy can be re-identified by
 *     value matching, so deleting one scan, an anonymous session or a whole
 *     account also deletes, in the same batch, at most ONE copy whose values,
 *     hand, method, model version and month match each deleted scan. The 24 h
 *     anonymous expiry, the inactive-account purge and the expire cron do NOT
 *     delete copies: once the scan is gone, nothing can find the copy again,
 *     and the notice says so before the person sends the scan.
 *   - Millimetre values are rounded to `HAND_SAMPLE_ROUND_MM` before storage.
 *   - Never kept: photos, landmarks/pixel coordinates, IP, user agent, locale,
 *     free text.
 *   - Written in the same atomic batch as the scan, so a sample never exists
 *     without its scan having been accepted.
 *   - Aggregates published outside the team suppress any cell with fewer than
 *     `HAND_SAMPLE_MIN_CELL` samples.
 *
 * Change this file only in a PR of its own.
 */
import { z } from "zod";

/** Version of the notice + toggle shown on the confirm screen. */
export const HAND_SAMPLE_NOTICE_VERSION = "hand-sample-notice-v1-draft";

export const handSampleNoticeSchema = z.literal(HAND_SAMPLE_NOTICE_VERSION);

/** Stored millimetre values are rounded to this step. */
export const HAND_SAMPLE_ROUND_MM = 1;

/** Smallest cell size allowed in any statistic shown outside the team. */
export const HAND_SAMPLE_MIN_CELL = 10;

/** Rounds a millimetre value the way the sample table stores it. */
export function roundSampleMm(mm: number): number {
  return Math.round(mm / HAND_SAMPLE_ROUND_MM) * HAND_SAMPLE_ROUND_MM;
}

/** First day of the UTC month containing `d`, the only time a sample keeps. */
export function sampleMonthOf(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
