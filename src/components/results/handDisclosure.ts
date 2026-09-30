/**
 * LEGACY. The left-hand note used to be driven by this per-scan browser
 * storage key. It now reads `hand` from the fit response (#62), so nothing
 * writes the key any more. Every key with this prefix is swept away when a
 * results page or the account page loads, and a deleted scan's key with it,
 * so old entries do not stay behind.
 */
export const RESULT_HAND_KEY_PREFIX = "openMouse.resultHand.";

export function resultHandKey(scanId: string): string {
  return `${RESULT_HAND_KEY_PREFIX}${scanId}`;
}

/**
 * Removes every key left by the legacy hand disclosure, whatever scan it was
 * for. Keys are collected first and removed after: removing while walking
 * `key(i)` shifts the indexes. Returns how many were removed.
 */
export function sweepLegacyHandKeys(
  storage: Pick<Storage, "length" | "key" | "removeItem">,
): number {
  const found: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key !== null && key.startsWith(RESULT_HAND_KEY_PREFIX)) found.push(key);
  }
  for (const key of found) storage.removeItem(key);
  return found.length;
}
