/**
 * LEGACY. The left-hand note used to be driven by this per-scan browser
 * storage key. It now reads `hand` from the fit response (#62), so nothing
 * writes the key any more; it is only removed (when a scan is deleted, and
 * when a results page finds a leftover) so old entries do not stay behind.
 */
export const RESULT_HAND_KEY_PREFIX = "openMouse.resultHand.";

export function resultHandKey(scanId: string): string {
  return `${RESULT_HAND_KEY_PREFIX}${scanId}`;
}
