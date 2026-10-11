import { MANUAL_ENTRY } from "@/lib/contracts/measurement";
import { resultHandKey } from "./handDisclosure";

export function resultLengthKey(scanId: string): string {
  return `open-mouse:user-length:${scanId}`;
}

/**
 * The typed length stored for a scan, or null when there is none or it is not
 * a plausible length. The bounds are the measurement schema's own hand-length
 * limits (100-280 mm), deliberately WIDER than the range the input accepts
 * today (`USER_LENGTH_RANGE_MM`): the note must still show for a scan made
 * under an earlier, wider range, since hiding it would hide the fact that
 * the scan used no paper. Widen this if the accepted range ever goes wider
 * than the schema's; see the checklist on `USER_LENGTH_RANGE_MM`.
 */
export const STORED_USER_LENGTH_MM = { min: 100, max: 280 } as const;

export function parseStoredUserLength(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const length = Number(raw);
  return Number.isFinite(length) &&
    length >= STORED_USER_LENGTH_MM.min &&
    length <= STORED_USER_LENGTH_MM.max
    ? length
    : null;
}

/**
 * The typed hand length and width of a manual-entry scan (candidate,
 * 2026-10-12), kept per scan like the typed length above: the results page
 * shows "estimated from the numbers you entered" from it, and no other
 * calibration method ever writes it, so the line is hidden for every other
 * scan. Stored as JSON, whole millimetres.
 */
export function resultManualEntryKey(scanId: string): string {
  return `open-mouse:manual-entry:${scanId}`;
}

export interface StoredManualEntry {
  readonly handLengthMm: number;
  readonly handWidthMm: number;
}

export function serializeManualEntry(entry: StoredManualEntry): string {
  return JSON.stringify({
    handLengthMm: entry.handLengthMm,
    handWidthMm: entry.handWidthMm,
  });
}

function inRange(
  value: unknown,
  range: { readonly min: number; readonly max: number },
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= range.min &&
    value <= range.max
  );
}

/**
 * The typed pair stored for a scan, or null when there is none or it is not
 * a pair the contract would have accepted (each number inside its own range;
 * the width / length band is not re-checked, the server already did when the
 * scan was submitted). Anything unreadable is null, never a throw.
 */
export function parseStoredManualEntry(
  raw: string | null,
): StoredManualEntry | null {
  if (raw === null || raw.trim() === "") return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  const { handLengthMm, handWidthMm } = value as Record<string, unknown>;
  return inRange(handLengthMm, MANUAL_ENTRY.handLengthRangeMm) &&
    inRange(handWidthMm, MANUAL_ENTRY.handWidthRangeMm)
    ? { handLengthMm, handWidthMm }
    : null;
}

export function clearScanDisclosures(
  storage: Pick<Storage, "removeItem">,
  scanIds: readonly string[],
): void {
  for (const scanId of scanIds) {
    storage.removeItem(resultLengthKey(scanId));
    storage.removeItem(resultManualEntryKey(scanId));
    // Legacy key, no longer written (see handDisclosure.ts).
    storage.removeItem(resultHandKey(scanId));
  }
}
