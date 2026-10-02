/**
 * The run log: everything one `/learn/check` download or one
 * `npm run learn:sort` run knows about a batch of photos, in one JSON file.
 * Pure and free of Node imports, so the checker page can use it too.
 *
 * Format 3 (2026-10-02): format 2 plus the kit v2 fields `protocol`, `session`
 * and `sheet` (null in a kit v1 log). Field by field: docs/learning/README.md.
 */
import type { PaperSize } from "../contracts/measurement";
import { compareFileNames } from "./checks";
import {
  KIT_V1_VERSION,
  LEARNING_KIT_VERSION,
  sortPhotos,
  type HandSide,
  type SortResult,
} from "./kit";
import { classifyPose } from "./posecheck";
import {
  PROTOCOL_AGREED_V2,
  type KitV2Sheet,
  type SessionRecord,
} from "./session";
import {
  sortPhotosV2,
  type KitV2SortResult,
  type SortV2Options,
} from "./sortv2";
import {
  stampProvenance,
  type LearningPhotoReport,
  type Provenance,
} from "./report";

export const RUN_LOG_FORMAT = "open-mouse-learning-run/3" as const;

/** The format kit v1 run logs were written in (2026-09-30 to 2026-10-02); `buildRunLog` no longer writes it. */
export const RUN_LOG_FORMAT_V2 = "open-mouse-learning-run/2" as const;

export interface LearningRunLog {
  readonly format: typeof RUN_LOG_FORMAT;
  /** When the run happened. Not when any photo was taken. */
  readonly createdAt: string;
  /** 1 for a kit v1 run, 2 for kit v2. */
  readonly kitVersion: number;
  /** `"agreed-v2"` for a kit v2 run; `null` for kit v1 (its values are `candidate-v1`, never mixed with these). */
  readonly protocol: typeof PROTOCOL_AGREED_V2 | null;
  /** The session record the run was sorted under (`session.json`); `null` in kit v1 and in a download from the checker page. */
  readonly session: SessionRecord | null;
  /** The sheet the photos were taken on (`"A"` or `"B"`); `null` for kit v1. */
  readonly sheet: KitV2Sheet | null;
  readonly gitSha: string | null;
  readonly gitDirty: boolean | null;
  readonly paperSize: PaperSize;
  /** The photo folder, relative to where the sorter ran; `null` in a download from the checker page. */
  readonly input: string | null;
  /** Each report carries `kitVersion`, `gitSha` and `gitDirty` too, so one can be lifted out alone. */
  readonly reports: readonly LearningPhotoReport[];
  /** Kit v1: the QR-per-pose sort. Kit v2: the order-based sort (`KitV2SortResult`, which extends `SortResult`). */
  readonly sort: SortResult;
}

export const NO_PROVENANCE: Provenance = { gitSha: null, gitDirty: null };

/** What turns a run log into a kit v2 one. */
export interface KitV2RunInfo {
  /** The session the sorter was given; `null` for a download from the checker page, which has none. */
  readonly session: SessionRecord | null;
  readonly sheet: KitV2Sheet;
}

export function buildRunLog(args: {
  readonly reports: readonly LearningPhotoReport[];
  readonly sort: SortResult;
  readonly paperSize: PaperSize;
  /** Already relative (see `relativeInputPath`), or `null`. */
  readonly input: string | null;
  readonly provenance: Provenance;
  readonly now: Date;
  /** Set for a kit v2 run. Without it the log is a kit v1 one, exactly as before. */
  readonly kitV2?: KitV2RunInfo;
}): LearningRunLog {
  const v2 = args.kitV2;
  return {
    format: RUN_LOG_FORMAT,
    createdAt: args.now.toISOString(),
    kitVersion: v2 ? LEARNING_KIT_VERSION : KIT_V1_VERSION,
    protocol: v2 ? PROTOCOL_AGREED_V2 : null,
    session: v2?.session ?? null,
    sheet: v2?.sheet ?? null,
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
    KIT_V1_VERSION,
  );
}

/**
 * Kit v2: sort the reports by shooting order. Reports go in natural file-name
 * order (camera order), and, unlike `sortReports`, a photo that would be
 * retaken is still filed when it names a participant: a kit v2 photo the product
 * refuses is data, and dropping one would shift the shooting order of the rest.
 * The pose check is run on each photo's landmarks here.
 */
export function sortReportsV2(
  reports: readonly LearningPhotoReport[],
  options: {
    /** Participant id to the hand they use a mouse with (`participant.json`). */
    readonly mouseHands?: Readonly<Record<string, HandSide | null | undefined>>;
    /** Participant id to `shotCounts` from `participant.json`. */
    readonly shotCounts?: SortV2Options["shotCounts"];
    /** Input files whose copy cannot be made. */
    readonly unfileable?: SortV2Options["unfileable"];
  } = {},
): KitV2SortResult {
  const ordered = [...reports].sort((a, b) => compareFileNames(a.file, b.file));
  return sortPhotosV2(
    ordered.map((r, i) => ({
      file: r.file,
      takenAt: i,
      code: r.code,
      detectedHand: r.hand?.handedness ?? null,
      predictedPose: classifyPose(r.hand?.landmarksPx).predicted,
    })),
    {
      mouseHands: options.mouseHands,
      shotCounts: options.shotCounts,
      unfileable: options.unfileable,
    },
  );
}
