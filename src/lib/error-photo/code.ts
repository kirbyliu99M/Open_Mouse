/**
 * The error photo's deletion code (candidate 未拍板,
 * src/lib/contracts/error-photo.ts): 12 characters from a 32-letter alphabet
 * with no look-alikes (no I, O, 0 or 1), so 60 bits of randomness.
 *
 * 32 is a power of two, so the low five bits of a random byte pick a letter
 * with no modulo bias. The randomness is injected: the server passes
 * `crypto.randomBytes`, a test passes fixed bytes.
 */

/** A-H, J-N, P-Z, 2-9: the contract's `[A-HJ-NP-Z2-9]`. */
export const DELETE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const DELETE_CODE_LENGTH = 12;

export function generateDeleteCode(
  randomBytes: (size: number) => Uint8Array,
): string {
  const bytes = randomBytes(DELETE_CODE_LENGTH);
  if (bytes.length < DELETE_CODE_LENGTH) {
    throw new RangeError("Not enough random bytes for a deletion code.");
  }
  let code = "";
  for (let k = 0; k < DELETE_CODE_LENGTH; k++) {
    code += DELETE_CODE_ALPHABET[bytes[k]! & 31];
  }
  return code;
}
