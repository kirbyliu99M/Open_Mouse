/**
 * Which files in the photo folder `learn:sort` treats as photos. Every
 * image-like file counts, in camera (natural file-name) order, so a file that
 * cannot be filed (a HEIC the browser cannot read, a PNG) keeps its place in
 * the shooting order and the photos after it do not shift pose. Anything else
 * is listed as skipped, so a `.webp` cannot vanish without a word. A `.jfif`
 * is a JPEG under another name and is read as one. Pure.
 */
import { compareFileNames } from "./checks";

const PHOTO_FILE = /\.(jpe?g|jfif|png|heic|heif)$/i;

export function listPhotoFiles(names: readonly string[]): {
  readonly photos: string[];
  readonly skipped: string[];
} {
  const photos = names.filter((n) => PHOTO_FILE.test(n)).sort(compareFileNames);
  const skipped = names
    .filter((n) => !PHOTO_FILE.test(n))
    .sort(compareFileNames);
  return { photos, skipped };
}

/** The line for the summary when files were skipped, or `null`. Names are shown, up to ten. */
export function skippedFilesLine(skipped: readonly string[]): string | null {
  if (skipped.length === 0) return null;
  const shown = skipped.slice(0, 10).join(", ");
  const more = skipped.length > 10 ? ` and ${skipped.length - 10} more` : "";
  return `Skipped ${skipped.length} file${skipped.length === 1 ? "" : "s"} that ${skipped.length === 1 ? "is" : "are"} not photos (.jpg, .jpeg, .jfif, .png, .heic, .heif): ${shown}${more}.`;
}
