export const PHOTO_PRIVACY_COPY =
  "Your photo never leaves your phone. Only measurements are sent.";

/**
 * The same promise for a screen a person can reach from a computer, where
 * "your phone" would be wrong (the desktop entry offers an upload). Candidate
 * wording, pending Kirby's confirmation; `PHOTO_PRIVACY_COPY` above stays as
 * is (tests/e2e/scan.spec.ts pins its text).
 */
export const PHOTO_PRIVACY_COPY_THIS_DEVICE =
  "Your photo never leaves this device. Only measurements are sent.";
