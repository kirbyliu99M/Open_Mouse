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

export function clearScanDisclosures(
  storage: Pick<Storage, "removeItem">,
  scanIds: readonly string[],
): void {
  for (const scanId of scanIds) {
    storage.removeItem(resultLengthKey(scanId));
    // Legacy key, no longer written (see handDisclosure.ts).
    storage.removeItem(resultHandKey(scanId));
  }
}
