import { en } from "@/lib/copy/privacy";

/** The English promise. For the visitor's language use `privacyCopy(locale)`
 * from `@/lib/copy/privacy`. */
export const PHOTO_PRIVACY_COPY = en.photoStaysOnPhone;

/**
 * The same promise for a screen a person can reach from a computer, where
 * "your phone" would be wrong (the desktop entry offers an upload). Candidate
 * wording, pending Kirby's confirmation; `PHOTO_PRIVACY_COPY` above stays as
 * is (tests/e2e/scan.spec.ts pins its text).
 */
export const PHOTO_PRIVACY_COPY_THIS_DEVICE = en.photoStaysOnDevice;
