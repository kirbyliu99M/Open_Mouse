/**
 * Locale prefixes in URL paths (`src/lib/contracts/locale.ts`, 2026-10-28):
 * `/en/mice` is `/mice` in English; an unprefixed path is the zh-TW URL. Pure,
 * and safe on both sides of the seam.
 */
import { LOCALES, LOCALE_PATH_PREFIX, type Locale } from "../contracts/locale";

export interface SplitPath {
  /** The locale the prefix names, or null for an unprefixed path. */
  locale: Locale | null;
  /** The path without the prefix, always starting with `/`. */
  path: string;
}

/** Splits a pathname into its locale prefix and the route it names. */
export function splitLocalePath(pathname: string): SplitPath {
  for (const locale of LOCALES) {
    const prefix = LOCALE_PATH_PREFIX[locale];
    if (prefix === "") continue;
    if (pathname === prefix) return { locale, path: "/" };
    if (pathname.startsWith(`${prefix}/`)) {
      return { locale, path: pathname.slice(prefix.length) };
    }
  }
  return { locale: null, path: pathname };
}

/** The pathname without any locale prefix (`/en/scan` → `/scan`). */
export function stripLocalePrefix(pathname: string): string {
  return splitLocalePath(pathname).path;
}

/**
 * `path` (an unprefixed site path, optionally with a query or hash) as the URL
 * of `locale`: `/mice` → `/en/mice`, `/` → `/en`. A path that already carries
 * a prefix is re-prefixed, so the function is safe to apply twice. Anything
 * that is not a site path (`https://…`, `#top`, `mailto:`) is returned as is.
 */
export function localizedPath(path: string, locale: Locale): string {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  const cut = path.search(/[?#]/);
  const pathname = cut === -1 ? path : path.slice(0, cut);
  const rest = cut === -1 ? "" : path.slice(cut);
  const bare = stripLocalePrefix(pathname);
  const prefix = LOCALE_PATH_PREFIX[locale];
  if (prefix === "") return `${bare}${rest}`;
  return `${bare === "/" ? prefix : `${prefix}${bare}`}${rest}`;
}
