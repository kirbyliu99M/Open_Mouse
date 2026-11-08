/**
 * Build-time feature flags. Every flag is OFF unless a `NEXT_PUBLIC_*`
 * environment variable turns it on at build time, so production stays off
 * with no Vercel configuration change.
 *
 * Read each variable as a literal `process.env.NEXT_PUBLIC_NAME` member
 * access: Next.js inlines it into the client bundle at build time, and a
 * dynamic lookup (`process.env[name]`) is NOT inlined and would always read
 * as unset in the browser.
 */

/** Only the exact strings "1" and "true" (any case) turn a flag on. */
export function parseFlag(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true";
}

/**
 * The "No paper? Use a ruler instead" entry, which lets a user type in their
 * hand length instead of scanning with paper.
 *
 * OFF until the M2 photo measurement of the no-paper gates (middle-finger
 * straightness >= 0.95, palm-width / hand-length 0.38-0.56). Both thresholds
 * are still candidates (commit f4bc7d4: measure on the M2 photos before
 * deploying). Turn it on for a build with
 * `NEXT_PUBLIC_TYPED_HAND_LENGTH_ENTRY=1`. The flag hides only the entry:
 * device routing (desktop QR, in-app browser notice, LINE
 * `openExternalBrowser=1`) does not depend on it.
 */
export const TYPED_HAND_LENGTH_ENTRY_ENABLED = parseFlag(
  process.env.NEXT_PUBLIC_TYPED_HAND_LENGTH_ENTRY,
);

/**
 * v3.4 (2026-11-05, candidate 未拍板): the card reference on the easy scan
 * (A4 / Letter / 卡片). OFF unless a build sets
 * `NEXT_PUBLIC_CARD_REFERENCE_ENABLED=1`. Off, the reference chip only
 * toggles A4 / Letter as before and no card option, card guide, motion
 * sensor request or card copy shows anywhere, and the card's code is not
 * loaded; a stored card choice is ignored and the stored paper size is used
 * (A4 for an older build's "card"). The card mode opens only after its precision gate (card vs
 * A4 hand length on the same photos, |mean| <= 2 mm and SD <= 2 mm,
 * candidate) passes.
 */
export const CARD_REFERENCE_ENABLED = parseFlag(
  process.env.NEXT_PUBLIC_CARD_REFERENCE_ENABLED,
);

/**
 * Error photos (Kirby 2026-11-08, candidate 未拍板;
 * src/lib/contracts/error-photo.ts): the one opt-in way a photo reaches the
 * server. OFF unless a build sets exactly `NEXT_PUBLIC_ERROR_PHOTO_ENABLED=1`
 * (only "1", not "true": this one sends a photo). Client code tests
 * `process.env.NEXT_PUBLIC_ERROR_PHOTO_ENABLED === "1"` inline at each use
 * (next.config.ts always defines the variable, so the build folds the test
 * and drops the off branch with its `import()`; review F1); there is
 * deliberately no exported constant to import. The routes read it through
 * this function.
 */
export function errorPhotoFlag(raw: string | undefined): boolean {
  return raw === "1";
}
