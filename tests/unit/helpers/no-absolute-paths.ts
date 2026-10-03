/**
 * "Nothing printed names an absolute path or the account": the assertions the
 * script tests share. NOT a test file.
 *
 * Plain substring checks are wrong here. On Linux the scratch folder is
 * /tmp/xyz, and a correctly redacted, RELATIVE path such as
 * ../../../../tmp/xyz/report.json contains "/tmp/xyz" without leaking anything.
 * So a path counts as a leak only where it stands as an absolute path: with
 * nothing before it that would make it part of a word, a relative path or a
 * URL. That is anything but a letter, digit, "_", ".", "~", "/", "\", "%",
 * "-", ">" or a closing bracket: the start of the text, white space, a quote,
 * a backtick, "(", "[", "{", "<", ",", ";", ":" and "=" all leave it standing
 * as a path.
 *
 * Written on its own, not from the redactor's patterns, so that it can catch
 * what the redactor misses.
 */
import { expect } from "vitest";

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What may NOT stand right before something for it to be an absolute path. */
const NOT_AFTER = String.raw`(?<![A-Za-z0-9_.~/\\%>)\]}-])`;

/** The text names `folder` (either slash style, any letter case) as an absolute path. */
export function namesAbsolutePath(text: string, folder: string): boolean {
  const forms = new Set([
    folder,
    folder.replaceAll("\\", "/"),
    folder.replaceAll("/", "\\"),
  ]);
  return [...forms].some((form) =>
    new RegExp(`${NOT_AFTER}${escapeRegExp(form)}`, "i").test(text),
  );
}

const SEGMENT = String.raw`[^\s/'"\x60<>|()\]}]+`;
const ROOTS =
  "tmp|home|var|Users|private|mnt|root|opt|usr|etc|srv|media|Volumes|run|proc|snap|nix|Applications|Library|System";

const ANY_ABSOLUTE_PATH: readonly RegExp[] = [
  // A drive letter (not the "p:" of "http://").
  /(?<![A-Za-z0-9])[A-Za-z]:[\\/]/,
  // \\server\share
  /(?<![\\A-Za-z0-9])\\\\[^\\\s]+\\/,
  // file:///anything
  /(?<![A-Za-z0-9])file:\/\//i,
  // /a/b, whatever the first folder is
  new RegExp(`${NOT_AFTER}/${SEGMENT}/${SEGMENT}`),
  // /tmp, /home ... on their own
  new RegExp(`${NOT_AFTER}/(?:${ROOTS})(?![A-Za-z0-9_~-])`),
];

/** Any absolute path at all: drive, UNC, file URL, or a POSIX path of two segments (or a system root). */
export function hasAnyAbsolutePath(text: string): boolean {
  return ANY_ABSOLUTE_PATH.some((pattern) => pattern.test(text));
}

/**
 * `text` (something a script printed) leaks nothing: none of `folders` as an
 * absolute path, no absolute path of any kind, no stack frame, and not the
 * account name.
 */
export function expectNoLeak(
  text: string,
  options: {
    /** The folders the run knew about: the repo, the scratch folder, the temp and home folders. */
    readonly folders: readonly string[];
    readonly username?: string | null;
  },
): void {
  for (const folder of options.folders) {
    // (A folder such as "/" would match everything: not a secret to look for.)
    if (folder.length <= 3) continue;
    expect(
      namesAbsolutePath(text, folder),
      `the text names ${folder.length} characters of an absolute folder`,
    ).toBe(false);
  }
  expect(hasAnyAbsolutePath(text), "the text holds an absolute path").toBe(
    false,
  );
  expect(text).not.toMatch(/^\s+at /m);
  const user = options.username;
  if (user && user.length >= 3) {
    expect(text.toLowerCase()).not.toContain(user.toLowerCase());
  }
}
