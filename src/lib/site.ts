/**
 * The site's public name and address, in one place. The share card (its title
 * line and its QR code) and the site footer read these, so a rename or a new
 * domain is one edit. The QR code on the card points at `SITE_URL` and nothing
 * else: never a scan id, never a query string.
 *
 * `SITE_NAME` is the public name (Palmate, 2026-10-08). The code and the README
 * still say Open_Mouse; renaming them is a separate task.
 */
export const SITE_NAME = "Palmate";
/** Public address since 2026-10-21 (Kirby): the custom domain. The old
 * open-mouse.vercel.app still serves the same deployment. */
export const SITE_URL = "https://palmate.kirby-fivesenses.com";
/** The first address; `next.config.ts` redirects it to `SITE_URL` (2026-10-26). */
export const LEGACY_HOST = "open-mouse.vercel.app";
/** The repository is public. */
export const GITHUB_URL = "https://github.com/kirbyliu99M/Open_Mouse";
