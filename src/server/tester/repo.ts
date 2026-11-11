/**
 * The `tester_shots` table as the tester routes, the purge and the scripts
 * see it (candidate 未拍板, src/lib/contracts/tester.ts). The real one is
 * `./drizzle-repo.ts`; tests pass a fake or PGlite.
 */
import type { TesterRecord } from "../../lib/contracts/tester";

export interface NewTesterShotRow {
  readonly shotId: string;
  /** `P07`: the only thing that identifies the person. */
  readonly participant: string;
  /** Asia/Taipei date, `YYYY-MM-DD`. */
  readonly day: string;
  readonly record: TesterRecord;
  /** `tester/<uuid>.jpg`, or null without a photo. */
  readonly photoPathname: string | null;
}

export interface TesterPhotoRef {
  readonly id: string;
  readonly photoPathname: string;
}

export interface TesterShotRepo {
  hasShot(shotId: string): Promise<boolean>;
  /** False when a row with this `shotId` already exists (nothing written). */
  insert(row: NewTesterShotRow): Promise<boolean>;
  /** Rows with a photo whose `day` is strictly before `cutoffDay`, oldest first. */
  listPhotosBefore(cutoffDay: string, limit: number): Promise<TesterPhotoRef[]>;
  /** Sets `photo_pathname` to NULL on these rows; returns how many. */
  clearPhotos(ids: readonly string[]): Promise<number>;
  /** Which of `pathnames` a row still points at. */
  existingPathnames(pathnames: readonly string[]): Promise<string[]>;
}
