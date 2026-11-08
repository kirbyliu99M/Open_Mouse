/**
 * The tester photos' retention (candidate 未拍板, src/lib/contracts/tester.ts):
 * run from the existing daily cron (`/api/cron/expire-sessions`,
 * src/server/scans/expire-cron.ts), no cron entry of its own.
 *
 *  1. Expired: every row with a photo whose `day` (Asia/Taipei) is more than
 *     `TESTER_PHOTO_RETENTION_DAYS` days before today (Asia/Taipei) has its
 *     blob deleted, then its `photo_pathname` set to NULL. The ROW stays: the
 *     numbers are kept until Kirby deletes them (scripts/tester-delete.ts).
 *  2. Orphans: every blob under `tester/` that no row points at, uploaded
 *     more than a day ago (an upload whose row insert failed and whose own
 *     clean-up failed too, or a blob a NULLing missed). The day's margin keeps
 *     an upload in flight safe.
 *
 * Bounded like the error-photo purge: at most `maxBatches` x `batchSize` rows
 * and `maxListPages` store pages a run, no new step after `budgetMs`; what is
 * left goes the next day (`remaining`). Unit-tested with fakes
 * (tests/unit/tester-purge.test.ts).
 */
import { TESTER_PHOTO_RETENTION_DAYS } from "../../lib/contracts/tester";
import {
  DEFAULT_ERROR_PHOTO_PURGE_LIMITS,
  ORPHAN_MIN_AGE_MS,
  type ErrorPhotoPurgeLimits,
} from "../error-photos/purge";
import type { ErrorPhotoBlobStore } from "../error-photos/service";
import { addDays, taipeiDay } from "./day";
import type { TesterShotRepo } from "./repo";
import { TESTER_PHOTO_PREFIX } from "./service";

/**
 * Photos of rows whose day is strictly before this day are past retention: a
 * photo taken on Taipei day D is kept through D + N and its blob deleted by
 * the first run on D + N + 1.
 */
export function testerPhotoCutoffDay(now: Date, retentionDays: number): string {
  if (!Number.isInteger(retentionDays) || retentionDays < 1)
    throw new RangeError("retentionDays must be a positive integer.");
  return addDays(taipeiDay(now), -retentionDays);
}

export interface TesterPhotoPurgeReport {
  /** Photos removed for age (their rows kept, pathname NULL). */
  readonly expired: number;
  /** Blobs removed that had no row. */
  readonly orphans: number;
  /** A limit stopped the run with work left. */
  readonly remaining: boolean;
}

export async function purgeTesterPhotos(deps: {
  readonly repo: Pick<
    TesterShotRepo,
    "listPhotosBefore" | "clearPhotos" | "existingPathnames"
  >;
  readonly blob: Pick<ErrorPhotoBlobStore, "del" | "list">;
  readonly now?: () => Date;
  readonly limits?: Partial<ErrorPhotoPurgeLimits>;
}): Promise<TesterPhotoPurgeReport> {
  const limits = {
    ...DEFAULT_ERROR_PHOTO_PURGE_LIMITS,
    retentionDays: TESTER_PHOTO_RETENTION_DAYS,
    ...deps.limits,
  };
  const clock = deps.now ?? (() => new Date());
  const started = clock();
  const overBudget = () =>
    clock().getTime() - started.getTime() >= limits.budgetMs;
  const cutoff = testerPhotoCutoffDay(started, limits.retentionDays);

  let expired = 0;
  let remaining = false;
  for (let batch = 0; ; batch++) {
    if (batch >= limits.maxBatches || overBudget()) {
      remaining = true;
      break;
    }
    const refs = await deps.repo.listPhotosBefore(cutoff, limits.batchSize);
    if (refs.length === 0) break;
    // Blobs first: a NULLing that fails afterwards is found again tomorrow,
    // and deleting a blob that is already gone is harmless.
    await deps.blob.del(refs.map((r) => r.photoPathname));
    expired += await deps.repo.clearPhotos(refs.map((r) => r.id));
    if (refs.length < limits.batchSize) break;
  }

  let orphans = 0;
  let cursor: string | undefined;
  for (let page = 0; ; page++) {
    if (page >= limits.maxListPages || overBudget()) {
      remaining = true;
      break;
    }
    const listed = await deps.blob.list({
      prefix: TESTER_PHOTO_PREFIX,
      ...(cursor ? { cursor } : {}),
    });
    const nowMs = clock().getTime();
    const aged = listed.blobs
      .filter(
        (b) =>
          b.pathname.startsWith(TESTER_PHOTO_PREFIX) &&
          nowMs - b.uploadedAt.getTime() >= ORPHAN_MIN_AGE_MS,
      )
      .map((b) => b.pathname);
    if (aged.length > 0) {
      const referenced = new Set(await deps.repo.existingPathnames(aged));
      const gone = aged.filter((p) => !referenced.has(p));
      if (gone.length > 0) {
        await deps.blob.del(gone);
        orphans += gone.length;
      }
    }
    if (!listed.hasMore || !listed.cursor) break;
    cursor = listed.cursor;
  }

  return { expired, orphans, remaining };
}
