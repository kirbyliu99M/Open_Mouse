/**
 * The run log: everything one `/learn/check` download or one
 * `npm run learn:sort` run knows about a batch of photos, in one JSON file.
 * Pure and free of Node imports, so the checker page can use it too.
 *
 * Format 2 (2026-09-30). Field by field: docs/learning/README.md.
 */
import type { PaperSize } from "../contracts/measurement";
import { compareFileNames } from "./checks";
import { LEARNING_KIT_VERSION, sortPhotos, type SortResult } from "./kit";
import {
  stampProvenance,
  type LearningPhotoReport,
  type Provenance,
} from "./report";

export const RUN_LOG_FORMAT = "open-mouse-learning-run/2" as const;

export interface LearningRunLog {
  readonly format: typeof RUN_LOG_FORMAT;
  /** When the run happened. Not when any photo was taken. */
  readonly createdAt: string;
  readonly kitVersion: number;
  readonly gitSha: string | null;
  readonly gitDirty: boolean | null;
  readonly paperSize: PaperSize;
  /** The photo folder, relative to where the sorter ran; `null` in a download from the checker page. */
  readonly input: string | null;
  /** Each report carries `kitVersion`, `gitSha` and `gitDirty` too, so one can be lifted out alone. */
  readonly reports: readonly LearningPhotoReport[];
  readonly sort: SortResult;
}

export const NO_PROVENANCE: Provenance = { gitSha: null, gitDirty: null };

export function buildRunLog(args: {
  readonly reports: readonly LearningPhotoReport[];
  readonly sort: SortResult;
  readonly paperSize: PaperSize;
  /** Already relative (see `relativeInputPath`), or `null`. */
  readonly input: string | null;
  readonly provenance: Provenance;
  readonly now: Date;
}): LearningRunLog {
  return {
    format: RUN_LOG_FORMAT,
    createdAt: args.now.toISOString(),
    kitVersion: LEARNING_KIT_VERSION,
    gitSha: args.provenance.gitSha,
    gitDirty: args.provenance.gitDirty,
    paperSize: args.paperSize,
    input: args.input,
    reports: args.reports.map((r) => stampProvenance(r, args.provenance)),
    sort: args.sort,
  };
}

const FULL_HASH = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/**
 * Which commit produced a run log. `git` runs one git command in the
 * checkout that serves the checker and returns its output. Any failure
 * (no git, not a repository) gives nulls: a log is still worth having.
 */
export function readGitProvenance(
  git: (args: readonly string[]) => string,
): Provenance {
  try {
    const sha = git(["rev-parse", "HEAD"]).trim().toLowerCase();
    if (!FULL_HASH.test(sha)) return NO_PROVENANCE;
    const dirty = git(["status", "--porcelain"]).trim().length > 0;
    return { gitSha: sha, gitDirty: dirty };
  } catch {
    return NO_PROVENANCE;
  }
}

/**
 * File the reports the way `learn:sort` and the checker page both do: in
 * natural file-name order (camera order), a photo to retake is not filed even
 * if its QR code was read, and the detected hand is compared with the page's.
 * A mismatch is still filed (the page is the ground truth of what was asked)
 * but flagged.
 */
export function sortReports(
  reports: readonly LearningPhotoReport[],
): SortResult {
  const ordered = [...reports].sort((a, b) => compareFileNames(a.file, b.file));
  return sortPhotos(
    ordered.map((r, i) => ({
      file: r.file,
      takenAt: i,
      code: r.verdict === "retake" ? null : r.code,
      detectedHand: r.hand?.handedness ?? null,
    })),
    LEARNING_KIT_VERSION,
  );
}
