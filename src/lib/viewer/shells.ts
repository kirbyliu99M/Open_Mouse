/**
 * Which 3D shell, if any, the viewer may request for a mouse.
 *
 * The only way a URL for a model file is ever built: the slug is checked
 * against the index (the manifest's own `shells` and `noShell`, see
 * `shell-index.generated.json`) and the path the index holds is checked again
 * for shape, so no slug, API value or edited index can make the viewer ask
 * for anything outside `public/models/shells/`. Nothing is decoded or
 * normalised: a slug that is not exactly a manifest slug is not a shell.
 *
 * Pure, no I/O.
 */

/** Where the shell files are served from. Everything `shellUrl` returns starts with it. */
export const SHELL_URL_PREFIX = "/models/shells/";

/** The part of `public/models/manifest.json` the viewer needs. */
export interface ShellManifest {
  readonly shells: readonly { readonly slug: string; readonly path: string }[];
  readonly noShell: readonly { readonly slug: string }[];
}

// Lower-case words joined by single hyphens: the shape of every catalogue slug.
// No dot, slash, percent sign or backslash can pass, so there is nothing for a
// traversal to be made of.
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 80;

// What a manifest `path` for a shell must look like: exactly `shells/<name>.glb`.
const SHELL_PATH_PATTERN = /^shells\/([a-z0-9]+(?:-[a-z0-9]+)*\.glb)$/;

/**
 * The URL of the shell for `slug`, or null when the viewer must show its
 * "no preview" state instead: an unknown slug, a mouse the manifest lists as
 * having no shell, a slug of the wrong shape, or a manifest entry whose path
 * is not a plain `shells/<name>.glb`. Null is never an error.
 */
export function shellUrl(
  slug: unknown,
  manifest: ShellManifest,
): string | null {
  if (typeof slug !== "string") return null;
  if (slug.length === 0 || slug.length > MAX_SLUG_LENGTH) return null;
  if (!SLUG_PATTERN.test(slug)) return null;
  if (manifest.noShell.some((entry) => entry.slug === slug)) return null;

  const entry = manifest.shells.find((candidate) => candidate.slug === slug);
  if (!entry) return null;

  const match = SHELL_PATH_PATTERN.exec(entry.path);
  if (!match) return null;
  return `${SHELL_URL_PREFIX}${match[1]}`;
}

/**
 * The compact index the browser carries: slugs and paths only, none of the
 * manifest's sources, hashes or audit numbers (130 kB). Derived by
 * `scripts/build-viewer-shell-index.ts` and checked against the manifest by a
 * unit test.
 */
export function buildShellIndex(manifest: {
  shells: readonly { slug: string; path: string }[];
  noShell: readonly { slug: string }[];
}): ShellManifest {
  return {
    shells: manifest.shells.map(({ slug, path }) => ({ slug, path })),
    noShell: manifest.noShell.map(({ slug }) => ({ slug })),
  };
}
