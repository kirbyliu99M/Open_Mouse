/**
 * Pure helpers of the tester scripts (candidate 未拍板; contract
 * src/lib/contracts/tester.ts): code generation, where an export may go, and
 * the CSV. Unit-tested in tests/unit/tester-scripts.test.ts; the scripts
 * themselves (tester-codes, tester-export, tester-delete) only add I/O.
 */
import { isAbsolute, relative, resolve } from "node:path";
import {
  TESTER_CODE_ALPHABET,
  testerCodeSchema,
  testerParticipantSchema,
} from "../src/lib/contracts/tester";
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

/** Whether `target` is `root` or anywhere inside it. */
export function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * The absolute export folder: `outDir` (or the default) resolved against the
 * repo root. Throws for any folder inside the repo: the export holds personal
 * measurements and photos and must never be committed.
 */
export function resolveExportDir(
  outDir: string | undefined,
  repoRoot: string,
): string {
  const target = resolve(repoRoot, outDir ?? DEFAULT_EXPORT_DIR);
  if (isInside(repoRoot, target))
    throw new Error(
      `Refusing to export inside the repository (${target}). Choose a folder outside it.`,
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

/** One CSV cell: quoted when needed; a leading formula character is defused for spreadsheets. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = Array.isArray(value) ? value.join("|") : String(value);
  const safe =
    /^[=+\-@\t\r]/.test(text) && !/^-?\d/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** `shots.csv`: one line per row; `photoFile` is `photos/<shotId>.jpg` when its photo was exported. */
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
