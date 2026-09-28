export const RESULT_HAND_KEY_PREFIX = "openMouse.resultHand.";

export function resultHandKey(scanId: string): string {
  return `${RESULT_HAND_KEY_PREFIX}${scanId}`;
}
