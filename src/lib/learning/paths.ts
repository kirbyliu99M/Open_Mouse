/**
 * Path rules for `npm run learn:sort`. Node only (uses `node:path`), so
 * nothing that runs in the browser imports it. The `path` module is passed
 * in, which lets the tests check Windows rules on any machine.
 */
import path, { type PlatformPath } from "node:path";

export type PathApi = Pick<
  PlatformPath,
  "resolve" | "relative" | "isAbsolute" | "basename" | "sep"
>;

/**
 * Is `candidate` the directory itself or anything below it? Compares
 * resolved paths segment by segment, so `D:\repo-data` is not inside
 * `D:\repo`, and on Windows the comparison ignores letter case.
 */
export function isInsideDirectory(
  candidate: string,
  directory: string,
  api: PathApi = path,
): boolean {
  const rel = api.relative(api.resolve(directory), api.resolve(candidate));
  if (rel === "") return true;
  // A different drive comes back as an absolute path.
  if (api.isAbsolute(rel)) return false;
  return rel !== ".." && !rel.startsWith(`..${api.sep}`);
}

/** The first of `roots` that contains `candidate`, or `null`. */
export function containingRoot(
  candidate: string,
  roots: readonly string[],
  api: PathApi = path,
): string | null {
  return roots.find((root) => isInsideDirectory(candidate, root, api)) ?? null;
}

/**
 * How the run log names the photo folder: relative to `base`, with `/`
 * separators, so the log does not carry the account name in an absolute
 * path such as `C:\Users\<name>\Pictures`. Where no relative path exists
 * (another drive) only the folder's own name is kept. As a last guard, a
 * segment equal to `username`, or the one after `Users` or `home`, becomes
 * `~`.
 */
export function relativeInputPath(
  input: string,
  base: string,
  options: { api?: PathApi; username?: string | null } = {},
): string {
  const api = options.api ?? path;
  const rel = api.relative(api.resolve(base), api.resolve(input));
  const kept =
    rel === "" ? "." : api.isAbsolute(rel) ? api.basename(input) : rel;
  const user = options.username?.toLowerCase();
  const segments = kept.split(/[\\/]+/).filter((s) => s.length > 0);
  return (
    segments
      .map((segment, i) => {
        const lower = segment.toLowerCase();
        const afterHome =
          i > 0 && ["users", "home"].includes(segments[i - 1]!.toLowerCase());
        return lower === user || afterHome ? "~" : segment;
      })
      .join("/") || "."
  );
}
