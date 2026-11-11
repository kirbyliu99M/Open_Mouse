/**
 * Helpers of the tester scripts (candidate 未拍板; contract
 * src/lib/contracts/tester.ts): code generation, where an export may go, the
 * CSV, and the local copy's retention and deletion. Unit-tested in
 * tests/unit/tester-scripts.test.ts; the scripts themselves (tester-codes,
 * tester-export, tester-delete) only add the network.
 *
 * The local export follows the same rules as the server (the consent text
 * says so): a photo older than `TESTER_PHOTO_RETENTION_DAYS` (Taipei days) is
 * deleted from the export folder on each export, and a participant's
 * deletion also removes their rows and photos from the export folder.
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import {
  TESTER_CODE_ALPHABET,
  TESTER_PHOTO_RETENTION_DAYS,
  testerCodeSchema,
  testerParticipantSchema,
} from "../src/lib/contracts/tester";
import { addDays, taipeiDay } from "../src/server/tester/day";
import type { TesterShotRow } from "../src/server/tester/drizzle-repo";

/** The export folder used when none is given, relative to the repo root. */
export const DEFAULT_EXPORT_DIR = "../accuracy-collection-2026-11-08/export/";
const SUFFIX_LENGTH = 6;

/**
 * `n` codes P01..Pnn (P001..Pnnn past 99), each with a 6-character suffix
 * from the contract's 32-letter alphabet (the low five bits of a random byte:
 * no modulo bias). `randomBytes` is injected (node:crypto in the script).
 */
export function generateTesterCodes(
  n: number,
  randomBytes: (size: number) => Uint8Array,
): string[] {
  if (!Number.isInteger(n) || n < 1 || n > 999)
    throw new RangeError("Give a number of codes from 1 to 999.");
  const width = n > 99 ? 3 : 2;
  const codes: string[] = [];
  for (let k = 1; k <= n; k++) {
    const bytes = randomBytes(SUFFIX_LENGTH);
    if (bytes.length < SUFFIX_LENGTH) throw new RangeError("Not enough bytes.");
    let suffix = "";
    for (let i = 0; i < SUFFIX_LENGTH; i++)
      suffix += TESTER_CODE_ALPHABET[bytes[i]! & 31];
    codes.push(
      testerCodeSchema.parse(`P${String(k).padStart(width, "0")}-${suffix}`),
    );
  }
  return codes;
}

/**
 * `path` with every symbolic link resolved, also for a path that does not
 * exist yet (its nearest existing ancestor is resolved, the rest appended).
 */
export function realPath(path: string): string {
  const abs = resolve(path);
  if (existsSync(abs)) return realpathSync.native(abs);
  const parent = dirname(abs);
  if (parent === abs) return abs;
  return join(realPath(parent), basename(abs));
}

/** Whether `target` is `root` or anywhere inside it, after resolving links (case-blind, as Windows paths are). */
export function isInside(root: string, target: string): boolean {
  const rel = relative(
    realPath(root).toLowerCase(),
    realPath(target).toLowerCase(),
  );
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * The absolute export folder: `outDir` (or the default) resolved against the
 * repo root (`git rev-parse --show-toplevel` in the script), links resolved.
 * Throws for any folder inside the repo: the export holds personal
 * measurements and photos and must never be committed.
 */
export function resolveExportDir(
  outDir: string | undefined,
  repoRoot: string,
): string {
  const target = realPath(resolve(repoRoot, outDir ?? DEFAULT_EXPORT_DIR));
  if (isInside(repoRoot, target))
    throw new Error(
      `Refusing to use a folder inside the repository (${target}). Choose a folder outside it.`,
    );
  return target;
}

/** `P07` from the command line, or an error. */
export function parseParticipantArg(raw: string | undefined): string {
  const parsed = testerParticipantSchema.safeParse(raw?.trim().toUpperCase());
  if (!parsed.success) throw new Error("Give a participant id such as P07.");
  return parsed.data;
}

const CSV_COLUMNS = [
  "shotId",
  "participant",
  "day",
  "consentVersion",
  "hand",
  "measurers",
  "handLengthA1",
  "handLengthA2",
  "handLengthB1",
  "handLengthB2",
  "palmWidthA1",
  "palmWidthA2",
  "palmWidthB1",
  "palmWidthB2",
  "palmWidthEdge",
  "phoneModel",
  "surface",
  "lighting",
  "reference",
  "cardType",
  "deliberatelyPoor",
  "captureMode",
  "attempts",
  "firstTryOk",
  "failureCodes",
  "gaveUp",
  "measuredHandLengthMm",
  "measuredPalmWidthMm",
  "measurementModelVersion",
  "calibrationMethod",
  "photoFile",
  "photoWidthPx",
  "photoHeightPx",
] as const;

/**
 * One CSV cell, quoted when needed. Only a real number is written as is; any
 * text starting with = + - @ (or a tab or carriage return) gets a leading
 * `'`, so a spreadsheet never runs it as a formula.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const text = Array.isArray(value) ? value.join("|") : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** `shots.csv`: one line per row; `photoFile` is `photos/<shotId>.jpg` when its photo is in the folder. */
export function shotsCsv(
  rows: readonly TesterShotRow[],
  exportedPhotos: ReadonlySet<string>,
): string {
  const lines: string[] = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    const values: Record<string, unknown> = {
      ...row,
      photoFile: exportedPhotos.has(row.shotId)
        ? `photos/${row.shotId}.jpg`
        : "",
    };
    lines.push(CSV_COLUMNS.map((c) => csvCell(values[c])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function recordsJsonl(rows: readonly TesterShotRow[]): string {
  return (
    rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "")
  );
}

/** `records.jsonl` text -> rows (blank lines skipped). */
export function parseRecordsJsonl(text: string): TesterShotRow[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as TesterShotRow);
}

/** Photos of rows on days strictly before this are past retention (the server purge's rule). */
export function localPhotoCutoffDay(
  now: Date,
  retentionDays: number = TESTER_PHOTO_RETENTION_DAYS,
): string {
  return addDays(taipeiDay(now), -retentionDays);
}

/**
 * The shots whose photo may be in the export folder: the server still has it
 * and its day is within retention. Any other local photo is deleted.
 */
export function photosToKeep(
  rows: readonly Pick<TesterShotRow, "shotId" | "day" | "photoPathname">[],
  cutoffDay: string,
): Set<string> {
  return new Set(
    rows
      .filter((r) => r.photoPathname !== null && r.day >= cutoffDay)
      .map((r) => r.shotId),
  );
}

const PHOTO_FILE = /^([0-9a-f-]{36})\.jpg$/i;

/** The shot ids of the photos now in `<dir>/photos`. */
export function localPhotoIds(dir: string): string[] {
  const photos = join(dir, "photos");
  if (!existsSync(photos)) return [];
  return readdirSync(photos).flatMap((name) => {
    const m = PHOTO_FILE.exec(name);
    return m ? [m[1]!] : [];
  });
}

/** Deletes every local photo whose shot is not in `keep`; returns how many went. */
export function pruneLocalPhotos(
  dir: string,
  keep: ReadonlySet<string>,
): number {
  let removed = 0;
  for (const id of localPhotoIds(dir)) {
    if (keep.has(id)) continue;
    rmSync(join(dir, "photos", `${id}.jpg`), { force: true });
    removed++;
  }
  return removed;
}

/** Writes `shots.csv` and `records.jsonl` for `rows`, naming only photos present in the folder. */
export function writeExportFiles(
  dir: string,
  rows: readonly TesterShotRow[],
): void {
  const present = new Set(localPhotoIds(dir));
  writeFileSync(join(dir, "shots.csv"), shotsCsv(rows, present));
  writeFileSync(join(dir, "records.jsonl"), recordsJsonl(rows));
}

/**
 * Removes one participant from an export folder: their rows from
 * `records.jsonl` and `shots.csv` (both rewritten), and their photos. A
 * folder without an export is left alone. `dryRun` only counts.
 */
export function removeParticipantLocally(
  dir: string,
  participant: string,
  dryRun: boolean,
): { rows: number; photos: number } {
  const recordsPath = join(dir, "records.jsonl");
  if (!existsSync(recordsPath)) return { rows: 0, photos: 0 };
  const rows = parseRecordsJsonl(readFileSync(recordsPath, "utf8"));
  const gone = rows.filter((r) => r.participant === participant);
  const goneIds = new Set(gone.map((r) => r.shotId));
  const photos = localPhotoIds(dir).filter((id) => goneIds.has(id));
  if (dryRun) return { rows: gone.length, photos: photos.length };
  for (const id of photos)
    rmSync(join(dir, "photos", `${id}.jpg`), { force: true });
  writeExportFiles(
    dir,
    rows.filter((r) => r.participant !== participant),
  );
  return { rows: gone.length, photos: photos.length };
}

/**
 * `tester-delete` arguments: `P07 [--yes] [--out <dir>]`, in any order. The
 * value after `--out` is read first, so it is never taken for the id.
 */
export function parseDeleteArgs(args: readonly string[]): {
  participant: string;
  yes: boolean;
  outDir: string | undefined;
} {
  const outAt = args.indexOf("--out");
  if (
    outAt >= 0 &&
    (outAt + 1 >= args.length || args[outAt + 1]!.startsWith("--"))
  )
    throw new Error("--out needs a folder.");
  const outDir = outAt >= 0 ? args[outAt + 1] : undefined;
  const known = new Set(["--yes", "--out"]);
  const unknown = args.find((a) => a.startsWith("--") && !known.has(a));
  if (unknown) throw new Error(`Unknown option ${unknown}.`);
  const positional = args.filter(
    (a, i) => !a.startsWith("--") && !(outAt >= 0 && i === outAt + 1),
  );
  if (positional.length !== 1)
    throw new Error("Give exactly one participant id such as P07.");
  return {
    participant: parseParticipantArg(positional[0]),
    yes: args.includes("--yes"),
    outDir,
  };
}

/**
 * `tester-export` arguments: `[outDir] [--prune-only]`. `--prune-only` works
 * offline on the folder's own `records.jsonl` (no database, no Blob store).
 */
export function parseExportArgs(args: readonly string[]): {
  outDir: string | undefined;
  pruneOnly: boolean;
} {
  const unknown = args.find((a) => a.startsWith("--") && a !== "--prune-only");
  if (unknown) throw new Error(`Unknown option ${unknown}.`);
  const positional = args.filter((a) => !a.startsWith("--"));
  if (positional.length > 1) throw new Error("Give at most one folder.");
  return { outDir: positional[0], pruneOnly: args.includes("--prune-only") };
}

/**
 * Offline retention on an export folder: deletes local photos older than the
 * retention (by each row's own `day` in `records.jsonl`) or with no row, and
 * rewrites `shots.csv`. Returns how many photos went; a folder without an
 * export is left alone.
 */
export function pruneExportFolder(dir: string, now: Date): number {
  const recordsPath = join(dir, "records.jsonl");
  if (!existsSync(recordsPath)) return 0;
  const rows = parseRecordsJsonl(readFileSync(recordsPath, "utf8"));
  const keep = new Set(
    rows.filter((r) => r.day >= localPhotoCutoffDay(now)).map((r) => r.shotId),
  );
  const removed = pruneLocalPhotos(dir, keep);
  writeExportFiles(dir, rows);
  return removed;
}
