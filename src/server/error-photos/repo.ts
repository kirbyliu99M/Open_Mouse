/**
 * The `error_photos` table as the error-photo routes and the purge see it
 * (candidate 未拍板, src/lib/contracts/error-photo.ts). The real one is
 * `./drizzle-repo.ts`; tests pass a fake.
 */
import type { ErrorPhotoMeta } from "../../lib/contracts/error-photo";

export interface NewErrorPhotoRow {
  readonly consentVersion: string;
  readonly blobPathname: string;
  /** Lower-case hex SHA-256 of the deletion code; the code itself is never stored. */
  readonly deleteCodeSha256: string;
  readonly meta: ErrorPhotoMeta;
  readonly bytes: number;
  /** Start of the UTC day of the upload. */
  readonly createdOn: Date;
}

export interface ErrorPhotoRef {
  readonly id: string;
  readonly blobPathname: string;
}

export interface ErrorPhotoRepo {
  insert(row: NewErrorPhotoRow): Promise<void>;
  findByCodeHash(deleteCodeSha256: string): Promise<ErrorPhotoRef | null>;
  deleteById(id: string): Promise<void>;
  /** Rows created strictly before `cutoff`, oldest first, at most `limit`. */
  listCreatedBefore(cutoff: Date, limit: number): Promise<ErrorPhotoRef[]>;
  deleteByIds(ids: readonly string[]): Promise<number>;
  /** Which of `pathnames` a row still points at. */
  existingPathnames(pathnames: readonly string[]): Promise<string[]>;
}
