/**
 * The error photo's deletion code (candidate 未拍板,
 * src/lib/contracts/error-photo.ts): 12 characters from the contract's
 * 32-letter alphabet with no look-alikes (no I, O, 0 or 1), so 60 bits of
 * randomness. The BROWSER makes it before the upload (review #241 round 3),
 * so it can be shown even when no response arrives; the server only checks
 * its format and stores its hash.
 *
 * 32 is a power of two, so the low five bits of a random byte pick a letter
 * with no modulo bias. The randomness is injected: the browser passes
 * `crypto.getRandomValues`, a test passes fixed bytes.
 */
import { ERROR_PHOTO_CODE_ALPHABET } from "../contracts/error-photo";

export const DELETE_CODE_ALPHABET = ERROR_PHOTO_CODE_ALPHABET;
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

/** The browser's crypto source (Web Crypto). */
export function webCryptoBytes(size: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(size));
}
