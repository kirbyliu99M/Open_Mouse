/**
 * The error photos' retention (candidate 未拍板,
 * src/lib/contracts/error-photo.ts): run from the existing daily cron
 * (`/api/cron/expire-sessions`, src/server/scans/expire-cron.ts), no cron
 * entry of its own.
 *
 *  1. Expired: every row whose `created_on` (the start of its upload's UTC
 *     day) is more than `ERROR_PHOTO_RETENTION_DAYS` days before the start of
 *     today (UTC) has its blob deleted, then its row, in batches.
 *  2. Orphans: every blob under `error-photos/` with no row pointing at it,
 *     uploaded more than a day ago (an upload whose row insert failed and
 *     whose own clean-up failed too). The day's margin keeps an upload in
 *     flight (blob written, row not yet) safe.
 *
 * The arithmetic and the selection are pure and unit-tested
 * (tests/unit/error-photos-purge.test.ts); the loop is tested with fakes.
 * Bounded: at most `maxBatches` x `batchSize` rows and `maxListPages` store
 * pages a run, and no new step after `budgetMs`; what is left goes the next
 * day (`remaining`).
 */
import { ERROR_PHOTO_RETENTION_DAYS } from "../../lib/contracts/error-photo";
import { startOfUtcDay } from "../survey/profile";
import type { ErrorPhotoRepo } from "./repo";
import { ERROR_PHOTO_PREFIX, type ErrorPhotoBlobStore } from "./service";

export const DAY_MS = 24 * 60 * 60 * 1000;
/** An unreferenced blob younger than this may be an upload in flight. */
export const ORPHAN_MIN_AGE_MS = DAY_MS;

export interface ErrorPhotoPurgeLimits {
  readonly retentionDays: number;
  readonly batchSize: number;
  readonly maxBatches: number;
  readonly maxListPages: number;
  readonly budgetMs: number;
}

export const DEFAULT_ERROR_PHOTO_PURGE_LIMITS: ErrorPhotoPurgeLimits = {
  retentionDays: ERROR_PHOTO_RETENTION_DAYS,
  batchSize: 100,
  maxBatches: 10,
  maxListPages: 5,
  budgetMs: 20_000,
};

/**
 * Rows created strictly before this instant are past retention. A photo sent
 * on UTC day D (`created_on` = D 00:00) is kept through day D + N and deleted
 * by the first run on day D + N + 1.
 */
export function errorPhotoPurgeCutoff(now: Date, retentionDays: number): Date {
  if (!Number.isInteger(retentionDays) || retentionDays < 1)
    throw new RangeError("retentionDays must be a positive integer.");
  return new Date(startOfUtcDay(now).getTime() - retentionDays * DAY_MS);
}

/** Of `blobs`, the pathnames under the prefix that no row names and that are old enough to delete. */
export function selectOrphanPathnames(
  blobs: readonly { readonly pathname: string; readonly uploadedAt: Date }[],
  referenced: ReadonlySet<string>,
  now: Date,
  minAgeMs: number = ORPHAN_MIN_AGE_MS,
): string[] {
  return blobs
    .filter(
      (b) =>
        b.pathname.startsWith(ERROR_PHOTO_PREFIX) &&
        !referenced.has(b.pathname) &&
        now.getTime() - b.uploadedAt.getTime() >= minAgeMs,
    )
    .map((b) => b.pathname);
}

/** Only old-enough blobs under the prefix need a row lookup. */
function agedCandidates(
  blobs: readonly { readonly pathname: string; readonly uploadedAt: Date }[],
  now: Date,
  minAgeMs: number,
): string[] {
  return selectOrphanPathnames(blobs, new Set(), now, minAgeMs);
}

export interface ErrorPhotoPurgeReport {
  /** Rows (and their blobs) removed for age. */
  readonly expired: number;
  /** Blobs removed that had no row. */
  readonly orphans: number;
  /** A limit stopped the run with work left. */
  readonly remaining: boolean;
}

export async function purgeErrorPhotos(deps: {
  readonly repo: ErrorPhotoRepo;
  readonly blob: Pick<ErrorPhotoBlobStore, "del" | "list">;
  readonly now?: () => Date;
  readonly limits?: Partial<ErrorPhotoPurgeLimits>;
}): Promise<ErrorPhotoPurgeReport> {
  const limits = { ...DEFAULT_ERROR_PHOTO_PURGE_LIMITS, ...deps.limits };
  const clock = deps.now ?? (() => new Date());
  const started = clock();
  const overBudget = () =>
    clock().getTime() - started.getTime() >= limits.budgetMs;
  const cutoff = errorPhotoPurgeCutoff(started, limits.retentionDays);

  let expired = 0;
  let remaining = false;
  for (let batch = 0; ; batch++) {
    if (batch >= limits.maxBatches || overBudget()) {
      remaining = true;
      break;
    }
    const refs = await deps.repo.listCreatedBefore(cutoff, limits.batchSize);
    if (refs.length === 0) break;
    // Blobs first: a row whose delete fails afterwards is found again
    // tomorrow, and deleting a blob that is already gone is harmless.
    await deps.blob.del(refs.map((r) => r.blobPathname));
    expired += await deps.repo.deleteByIds(refs.map((r) => r.id));
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
      prefix: ERROR_PHOTO_PREFIX,
      ...(cursor ? { cursor } : {}),
    });
    const now = clock();
    const candidates = agedCandidates(listed.blobs, now, ORPHAN_MIN_AGE_MS);
    if (candidates.length > 0) {
      const referenced = new Set(await deps.repo.existingPathnames(candidates));
      const gone = selectOrphanPathnames(
        listed.blobs,
        referenced,
        now,
        ORPHAN_MIN_AGE_MS,
      );
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
