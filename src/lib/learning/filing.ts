/**
 * Filing a kit v2 run to disk: the EXIF-stripped copies, and each
 * participant's `participant.json`. Node only (`node:fs`); `scripts/learn-sort.ts`
 * is its one caller, and the tests drive it on temporary folders.
 *
 *  - The original in the input folder is only READ, never written, moved,
 *    renamed or touched in any other way.
 *  - A copy is the original's bytes with the metadata stripped
 *    (`prepareFiledCopy`). A file that cannot be stripped (a PNG, a damaged
 *    JPEG) is not copied at all: the sorter reports it and nothing leaves the
 *    input folder carrying EXIF.
 *  - An existing destination, copy or `participant.json`, is never overwritten
 *    (the files are created with the exclusive flag).
 *  - No `truth.json` is written: kit v2 has no ruler truth.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { HandSide, SortedPhoto } from "./kit";
import { prepareFiledCopy, type StripRefusal } from "./exifstrip";
import { isInsideDirectory } from "./paths";
import { emptyLabelsRecord, emptyParticipantRecord } from "./session";
import {
  parseLabelsFile,
  parseParticipantFile,
  photosMissingLabels,
} from "./sessionfile";

export interface FiledCopies {
  /** Destinations written, relative to the output folder. */
  readonly copied: readonly string[];
  /** Destinations that already existed and were left as they were. */
  readonly existing: readonly string[];
  /** Photos that were not copied, and why. The file name only, never a path. */
  readonly refused: readonly {
    readonly file: string;
    readonly reason: StripRefusal | "verification-failed";
  }[];
}

/** Write `bytes` to `target` unless it exists; `true` when it was written. Never overwrites. */
function writeNew(target: string, bytes: Uint8Array | string): boolean {
  if (existsSync(target)) return false;
  mkdirSync(dirname(target), { recursive: true });
  try {
    writeFileSync(target, bytes, { flag: "wx" });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
}

/**
 * Write the stripped copy of every filed photo (those with a `destination`).
 * `inputDir` is read from only.
 */
export function fileStrippedCopies(args: {
  readonly photos: readonly SortedPhoto[];
  readonly inputDir: string;
  readonly outDir: string;
}): FiledCopies {
  const copied: string[] = [];
  const existing: string[] = [];
  const refused: {
    file: string;
    reason: StripRefusal | "verification-failed";
  }[] = [];
  for (const p of args.photos) {
    if (!p.destination) continue;
    const target = join(args.outDir, p.destination);
    if (existsSync(target)) {
      existing.push(p.destination);
      continue;
    }
    const original = readFileSync(join(args.inputDir, p.file));
    const prepared = prepareFiledCopy(
      new Uint8Array(original.buffer, original.byteOffset, original.byteLength),
    );
    if (!prepared.ok) {
      refused.push({ file: p.file, reason: prepared.reason });
      continue;
    }
    if (writeNew(target, prepared.bytes)) copied.push(p.destination);
    else existing.push(p.destination);
  }
  return { copied, existing, refused };
}

/** What reading the participants' records found. */
export interface MouseHands {
  /** Participant id to their mouse hand; `null` while the record has none. */
  readonly hands: Readonly<Record<string, HandSide | null>>;
  /** Participants with no `participant.json` yet. */
  readonly missing: readonly string[];
  /** Records that exist but could not be used, and why (the message names no value). */
  readonly problems: readonly {
    readonly participant: string;
    readonly message: string;
  }[];
}

/** Read each participant's `mouseHand` from `<outDir>/<P###>/participant.json`. Reads only. */
export function readMouseHands(args: {
  readonly participants: readonly string[];
  readonly outDir: string;
}): MouseHands {
  const hands: Record<string, HandSide | null> = {};
  const missing: string[] = [];
  const problems: { participant: string; message: string }[] = [];
  for (const participant of args.participants) {
    const file = join(args.outDir, participant, "participant.json");
    if (!existsSync(file)) {
      missing.push(participant);
      hands[participant] = null;
      continue;
    }
    const parsed = parseParticipantFile(
      readFileSync(file, "utf8"),
      participant,
    );
    if (!parsed.ok) {
      problems.push({ participant, message: parsed.message });
      hands[participant] = null;
      continue;
    }
    hands[participant] = parsed.value.mouseHand;
  }
  return { hands, missing, problems };
}

/**
 * Write a `participant.json` template (`emptyParticipantRecord`) for each
 * participant that has none, for a person to fill in from the consent flow.
 * An existing one is never touched, filled in or not.
 */
export function writeParticipantTemplates(args: {
  readonly participants: readonly string[];
  readonly session: string;
  readonly outDir: string;
}): {
  readonly created: readonly string[];
  readonly existing: readonly string[];
} {
  const created: string[] = [];
  const existing: string[] = [];
  for (const participant of args.participants) {
    const target = join(args.outDir, participant, "participant.json");
    const text =
      JSON.stringify(
        emptyParticipantRecord(participant, args.session),
        null,
        2,
      ) + "\n";
    if (writeNew(target, text)) created.push(participant);
    else existing.push(participant);
  }
  return { created, existing };
}

export interface LabelsOutcome {
  /**
   * `created`: a blank `labels.json` was written. `exists`: there was one,
   * left as it is. `refused`: nothing was written, see `problem`.
   */
  readonly status: "created" | "exists" | "refused";
  /** Filed photos an existing `labels.json` has no entry for; always `[]` when it was just created. */
  readonly missing: readonly string[];
  /** Why nothing was written, or what is wrong with the file that is there; `null` when all is well. */
  readonly problem: string | null;
}

/**
 * Write `labels.json` next to `session.json` (`dir`): one blank entry per
 * filed photo, in shooting order. Kirby fills it in blind (prereg v2, 2.1):
 * the template holds no product verdict and no millimetre value, only the
 * photos' relative destinations (`emptyLabelsRecord`), and it is never put
 * where the run logs are, since those hold the product's verdict for every
 * photo. An existing `labels.json` is never overwritten, filled in or not; if
 * it is there, the filed photos it lacks are reported instead (a photo
 * filed later, say, after a participant was reviewed by hand).
 */
export function writeLabelsTemplate(args: {
  /** The folder `session.json` is in. */
  readonly dir: string;
  /** The folder the run logs go in (`<out>/runs`). */
  readonly runsDir: string;
  readonly session: string;
  /** The filed photos' relative destinations, in shooting order. */
  readonly files: readonly string[];
}): LabelsOutcome {
  if (isInsideDirectory(args.dir, args.runsDir)) {
    return {
      status: "refused",
      missing: [],
      problem:
        "labels.json would sit next to the run logs, which hold the product's verdict for every photo, and the labels must be made blind. Keep session.json outside the runs folder.",
    };
  }
  const target = join(args.dir, "labels.json");
  if (!existsSync(target)) {
    const text =
      JSON.stringify(emptyLabelsRecord(args.session, args.files), null, 2) +
      "\n";
    if (writeNew(target, text)) {
      return { status: "created", missing: [], problem: null };
    }
  }
  const parsed = parseLabelsFile(readFileSync(target, "utf8"));
  if (!parsed.ok) {
    return { status: "exists", missing: [], problem: parsed.message };
  }
  if (parsed.value.session !== args.session) {
    return {
      status: "exists",
      missing: [],
      problem: `labels.json next to this session.json is for session ${parsed.value.session}, not ${args.session}. Keep each session's session.json in a folder of its own.`,
    };
  }
  return {
    status: "exists",
    missing: photosMissingLabels(parsed.value, args.files),
    problem: null,
  };
}
