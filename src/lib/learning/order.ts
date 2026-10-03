/**
 * Does the order of a folder's file names agree with the order the files were
 * written in? Kit v2 takes each photo's pose from the shooting order, and the
 * only order the sorter has is the camera's file names (natural order:
 * IMG_0009 before IMG_0010), because the EXIF capture time is deliberately not
 * read. A phone that restarts its numbering, or a folder merged from two
 * cards, breaks that silently; the file times are a second opinion that costs
 * nothing. Pure.
 */
import { compareFileNames } from "./checks";

export interface FileTime {
  readonly file: string;
  /** Modification time, ms since the epoch. */
  readonly mtimeMs: number;
}

/**
 * How many photos, taken in file-name order, are older than the one before
 * them. 0 when the two orders agree, and also when the times are all equal
 * (a folder copied in one go keeps no times, which says nothing either way).
 */
export function fileTimeInversions(files: readonly FileTime[]): number {
  const ordered = [...files].sort((a, b) => compareFileNames(a.file, b.file));
  let inversions = 0;
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i]!.mtimeMs < ordered[i - 1]!.mtimeMs) inversions++;
  }
  return inversions;
}
