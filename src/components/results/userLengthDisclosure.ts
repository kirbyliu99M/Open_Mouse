import { resultHandKey } from "./handDisclosure";

export function resultLengthKey(scanId: string): string {
  return `open-mouse:user-length:${scanId}`;
}

export function clearScanDisclosures(
  storage: Pick<Storage, "removeItem">,
  scanIds: readonly string[],
): void {
  for (const scanId of scanIds) {
    storage.removeItem(resultLengthKey(scanId));
    storage.removeItem(resultHandKey(scanId));
  }
}
