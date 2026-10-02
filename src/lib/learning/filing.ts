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
import { parseParticipantFile } from "./sessionfile";
import { emptyParticipantRecord } from "./session";

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
