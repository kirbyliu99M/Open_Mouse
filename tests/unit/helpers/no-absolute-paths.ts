/**
 * "Nothing printed names an absolute path or the account": the assertions the
 * script tests share. NOT a test file.
 *
 * Plain substring checks are wrong here. On Linux the scratch folder is
 * /tmp/xyz, and a correctly redacted, RELATIVE path such as
 * ../../../../tmp/xyz/report.json contains "/tmp/xyz" without leaking anything.
 * So a path counts as a leak only where it stands as an absolute path: at the
 * start of the text or after whitespace, a quote, a parenthesis or "=".
 */
import { expect } from "vitest";

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where an absolute path can begin in a message. */
const BEFORE = String.raw`(?:^|[\s'"(=])`;

/** The text names `folder` (either slash style, any letter case) as an absolute path. */
export function namesAbsolutePath(text: string, folder: string): boolean {
  const forms = new Set([
    folder,
    folder.replaceAll("\\", "/"),
    folder.replaceAll("/", "\\"),
  ]);
  return [...forms].some((form) =>
    new RegExp(`${BEFORE}${escapeRegExp(form)}`, "im").test(text),
  );
}

/** Any absolute path at all: a drive letter, or a POSIX path under a system root. */
export function hasAnyAbsolutePath(text: string): boolean {
  // (A drive letter, not the "p:" of "http://".)
  if (/(?<![A-Za-z0-9])[A-Za-z]:[\\/]/.test(text)) return true;
  return new RegExp(
    `${BEFORE}/(?:tmp|home|var|Users|private|mnt|root|opt|usr|etc|srv|Volumes)(?:/|$)`,
    "m",
  ).test(text);
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
