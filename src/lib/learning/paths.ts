/**
 * Path rules for `npm run learn:sort`. Node only (uses `node:path`), so
 * nothing that runs in the browser imports it. The `path` module is passed
 * in, which lets the tests check Windows rules on any machine.
 */
import path, { type PlatformPath } from "node:path";
import type { PaperSize } from "../contracts/measurement";
import type { SortResult } from "./kit";
import type { LearningPhotoReport, Provenance } from "./report";
import { buildRunLog, type LearningRunLog } from "./runlog";

export type PathApi = Pick<
  PlatformPath,
  "resolve" | "relative" | "isAbsolute" | "basename" | "dirname" | "sep"
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

/**
 * The checkout that owns `scriptRoot`. In a git worktree that is not
 * `scriptRoot` itself: `git rev-parse --git-common-dir` names the main
 * checkout's `.git`, and the main checkout is its parent. Worktrees often sit
 * inside the main checkout's folder, so output there is as much "inside the
 * repo" as output next to the script. With no git answer (`null`) or a relative
 * one such as `.git`, the checkout is `scriptRoot` itself.
 */
export function mainCheckoutOf(
  scriptRoot: string,
  gitCommonDir: string | null,
  api: PathApi = path,
): string {
  if (!gitCommonDir) return scriptRoot;
  return api.dirname(api.resolve(scriptRoot, gitCommonDir));
}

/**
 * The worktree paths in the output of `git worktree list --porcelain`: one
 * `worktree <path>` line per worktree, the main checkout first. Every one of
 * them is somewhere the sorter must not write photos, since another
 * worktree's folder can be committed from there.
 */
export function parseWorktreeList(output: string): string[] {
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Every checkout an output folder must stay out of: this one, the main
 * checkout, and every other worktree git knows about.
 */
export function refusalRoots(
  scriptRoot: string,
  gitCommonDir: string | null,
  worktreeList: string,
  api: PathApi = path,
): string[] {
  const roots = [
    scriptRoot,
    mainCheckoutOf(scriptRoot, gitCommonDir, api),
    ...parseWorktreeList(worktreeList),
  ];
  return [...new Set(roots.map((root) => api.resolve(root)))];
}

/**
 * Where `learn:sort` may not write, from what git says about this checkout.
 * `git` runs one git command in the checkout and returns its output, or `null`
 * if it failed (no git, not a repository): the answer is then just this
 * checkout. `mainRoot` is the checkout the default output folder sits next to.
 */
export function gitRefusalRoots(
  scriptRoot: string,
  git: (args: readonly string[]) => string | null,
  api: PathApi = path,
): { mainRoot: string; roots: string[] } {
  const common = git(["rev-parse", "--git-common-dir"])?.trim() || null;
  const list = git(["worktree", "list", "--porcelain"]) ?? "";
  return {
    mainRoot: mainCheckoutOf(scriptRoot, common, api),
    roots: refusalRoots(scriptRoot, common, list, api),
  };
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

/**
 * The run log `learn:sort` writes. The photo folder is named relative to where
 * the command ran and with the account name removed (`relativeInputPath`); an
 * absolute path never reaches the file.
 */
export function buildSorterRunLog(args: {
  readonly reports: readonly LearningPhotoReport[];
  readonly sort: SortResult;
  readonly paperSize: PaperSize;
  /** The photo folder as given (absolute or not). */
  readonly input: string;
  /** Where the command ran. */
  readonly cwd: string;
  readonly username: string | null;
  readonly provenance: Provenance;
  readonly now: Date;
  readonly api?: PathApi;
}): LearningRunLog {
  return buildRunLog({
    reports: args.reports,
    sort: args.sort,
    paperSize: args.paperSize,
    input: relativeInputPath(args.input, args.cwd, {
      api: args.api,
      username: args.username,
    }),
    provenance: args.provenance,
    now: args.now,
  });
}
