/**
 * Paths and sizes of the product photos, in a module with no import at all so
 * the click-to-enlarge client component can use them without pulling in the
 * contract (zod) that `mouseMedia.ts` reads files with. `mouseMedia.ts`
 * re-exports all three. Pure.
 */

/**
 * The enlarged photo (click to enlarge): same crop window as the 480 px file,
 * so the aspect ratio is the same, 960 px high. Written by
 * `tools/mouse-media/build_media.py --out-large`; the 75 KB per file and
 * 30 MB total budgets are enforced by `tests/unit/mouse-media.test.ts`.
 * `LARGE_PHOTO_WIDTH` is the width the script derives from the shared window;
 * the test reads the real WebP headers against both constants.
 */
export const LARGE_PHOTO_WIDTH = 1109;
export const LARGE_PHOTO_HEIGHT = 960;

const SMALL_PHOTO_PATH = /^\/images\/mice\/([a-z0-9-]+)\.webp$/;

/**
 * `/images/mice/<slug>.webp` → `/images/mice/l/<slug>.webp`. Anything that is
 * not exactly a small-photo path (already a large path, another folder, a
 * query string, a traversal) is returned unchanged, so a bad value can never
 * produce a path outside `/images/mice/l/`. Pure.
 */
export function largePhotoPath(image: string): string {
  const match = SMALL_PHOTO_PATH.exec(image);
  return match ? `/images/mice/l/${match[1]}.webp` : image;
}
