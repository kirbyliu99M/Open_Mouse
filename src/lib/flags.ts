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
