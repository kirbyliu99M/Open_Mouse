/**
 * Path rules for `npm run learn:sort`. Node only (uses `node:path`), so
 * nothing that runs in the browser imports it. The `path` module is passed
 * in, which lets the tests check Windows rules on any machine.
 */
import { existsSync, lstatSync, readlinkSync, realpathSync } from "node:fs";
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

/**
 * `realpath`, also for a path that does not exist yet: the nearest existing
 * parent is resolved (links and junctions in it followed) and the rest is
 * appended as written. A LINK that points at nothing (a dangling symlink or
 * junction) is followed too, by reading it: `existsSync` says false for it, but
 * a write through it lands where it points, and that may be inside a checkout.
 * A loop of links gives up and returns the plain resolved path.
 */
export function realpathLoose(target: string): string {
  let current = path.resolve(target);
  const tail: string[] = [];
  let hops = 0;
  for (;;) {
    if (existsSync(current)) {
      return path.join(realpathSync.native(current), ...tail);
    }
    let isLink = false;
    try {
      isLink = lstatSync(current).isSymbolicLink();
    } catch {
      // not there at all
    }
    if (isLink) {
      if (++hops > 40) return path.resolve(target);
      current = path.resolve(path.dirname(current), readlinkSync(current));
      continue;
    }
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(target);
    tail.unshift(path.basename(current));
    current = parent;
  }
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
 * Does this path segment, or piece of text, carry the account name? Any
 * letter case, anywhere inside it: an account name turns up in folder names
 * such as `Kirby Photos`, `kirby-DCIM` and Claude Code's project folders
 * (`C--Users-kirby-Desktop-...`), not only as a whole segment. A name shorter
 * than three characters would match half of every path, so for those only a
 * segment that IS the name counts.
 */
export function carriesAccount(
  segment: string,
  username: string | null | undefined,
): boolean {
  if (!username) return false;
  const user = username.toLowerCase();
  const lower = segment.toLowerCase();
  return user.length >= 3 ? lower.includes(user) : lower === user;
}

/**
 * How the run log names the photo folder: relative to `base`, with `/`
 * separators, so the log does not carry the account name in an absolute
 * path such as `C:\Users\<name>\Pictures`. Where no relative path exists
 * (another drive) only the folder's own name is kept. As a last guard, a
 * segment that contains the account name in any letter case
 * (`carriesAccount`), or the one after `Users` or `home`, becomes `~`.
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
  const segments = kept.split(/[\\/]+/).filter((s) => s.length > 0);
  return (
    segments
      .map((segment, i) => {
        const afterHome =
          i > 0 && ["users", "home"].includes(segments[i - 1]!.toLowerCase());
        return carriesAccount(segment, options.username) || afterHome
          ? "~"
          : segment;
      })
      .join("/") || "."
  );
}

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * What a terminal may show. Each absolute path in `paths` is replaced by the
 * shorter form given for it (for example the photo folder by its path relative
 * to the working folder), in either slash style and any letter case, longest
 * first; then every occurrence of the account name (any letter case) becomes
 * `~`. A stack trace, a server's last words or an error from the file system
 * can quote a path; this is the one place they pass through.
 */
export interface RedactOptions {
  readonly username?: string | null;
  readonly paths?: readonly { readonly from: string; readonly to: string }[];
  /**
   * After the known paths: any other absolute path (a drive letter, or a
   * POSIX system root such as /home, /Users, /tmp) becomes `<path>`. For
   * text from tools that name their own folders (Playwright's "Executable
   * doesn't exist at C:\Users\...", a server's crash report).
   */
  readonly hideOtherPaths?: boolean;
  /** Lines that are stack frames ("    at f (file:1:1)") are replaced by one note. */
  readonly dropStackFrames?: boolean;
}

// A path runs to the next quote, angle bracket, pipe or line end; a space is
// part of it (folders have spaces), and so is a balanced (parenthesis), as in
// "Program Files (x86)". A "(" that opens a stack frame's location ends the
// path at the ")" that closes it.
const PATH_BODY = "(?:[^'\"`<>|()\\r\\n]|\\([^()\\r\\n]*\\))*";
const WINDOWS_PATH = new RegExp(
  `(?<![A-Za-z0-9])[A-Za-z]:[\\\\/]${PATH_BODY}`,
  "g",
);
const POSIX_ROOTS =
  "home|Users|root|tmp|var|private|mnt|opt|usr|etc|srv|media|Volumes|run|proc|snap|nix";
const POSIX_PATH = new RegExp(
  `(?<![A-Za-z0-9_.~/:-])/(?:${POSIX_ROOTS})(?![A-Za-z0-9_~-])(?:/${PATH_BODY})?`,
  "g",
);

/** `<path>` for a matched path, keeping the sentence punctuation that followed it. */
function hidePath(match: string): string {
  const tail = /[\s.,;:!?]+$/.exec(match)?.[0] ?? "";
  return `<path>${tail}`;
}

function dropFrames(text: string): string {
  const lines = text.split(/(\r?\n)/);
  const out: string[] = [];
  let inFrames = false;
  for (let i = 0; i < lines.length; i += 2) {
    const line = lines[i]!;
    const eol = lines[i + 1] ?? "";
    if (/^[ \t]+at\s/.test(line)) {
      if (!inFrames) out.push("    (stack frames omitted)" + eol);
      inFrames = true;
      continue;
    }
    inFrames = false;
    out.push(line + eol);
  }
  return out.join("");
}

export function redactText(text: string, options: RedactOptions = {}): string {
  let out = options.dropStackFrames ? dropFrames(text) : text;
  const paths = [...(options.paths ?? [])]
    .filter((p) => p.from.length > 0)
    .sort((a, b) => b.from.length - a.from.length);
  for (const { from, to } of paths) {
    const bare = from.replace(/[\\/]+$/, "");
    const forms = new Set([
      bare,
      bare.replaceAll("\\", "/"),
      bare.replaceAll("/", "\\"),
    ]);
    for (const form of forms) {
      out = out.replace(new RegExp(escapeRegExp(form), "gi"), () => to);
    }
  }
  if (options.hideOtherPaths) {
    out = out.replace(WINDOWS_PATH, hidePath).replace(POSIX_PATH, hidePath);
  }
  const user = options.username;
  if (user && user.length >= 3) {
    out = out.replace(new RegExp(escapeRegExp(user), "gi"), "~");
  }
  return out;
}

/**
 * What `redactText` needs so that nothing `learn:sort` prints carries an
 * absolute path or the account name: the photo and output folders as the
 * relative paths the run log uses, the working folder and this checkout as `.`,
 * every other checkout (main, other worktrees) as `<checkout>`.
 */
export function terminalRedaction(args: {
  /** Where the command ran. */
  readonly cwd: string;
  /** This checkout (where the script and the dev server run). */
  readonly scriptRoot: string;
  /** Every other checkout git lists; may include `scriptRoot`. */
  readonly checkouts?: readonly string[];
  /** The photo folder and the output folder, as given, once known. */
  readonly input?: string;
  readonly outDir?: string;
  readonly username?: string | null;
  readonly api?: PathApi;
}): Required<RedactOptions> {
  const api = args.api ?? path;
  const username = args.username ?? null;
  const shown = (p: string) =>
    relativeInputPath(p, args.cwd, { api, username });
  const paths: { from: string; to: string }[] = [];
  const same = (a: string, b: string) =>
    isInsideDirectory(a, b, api) && isInsideDirectory(b, a, api);
  for (const checkout of args.checkouts ?? []) {
    // This checkout and the working folder are '.', whatever else lists them.
    if (same(checkout, args.scriptRoot) || same(checkout, args.cwd)) continue;
    paths.push({ from: api.resolve(checkout), to: "<checkout>" });
  }
  paths.push({ from: api.resolve(args.scriptRoot), to: "." });
  paths.push({ from: api.resolve(args.cwd), to: "." });
  if (args.input)
    paths.push({ from: api.resolve(args.input), to: shown(args.input) });
  if (args.outDir)
    paths.push({ from: api.resolve(args.outDir), to: shown(args.outDir) });
  // A terminal also hides paths it was not told about, and stack frames.
  return { username, paths, hideOtherPaths: true, dropStackFrames: true };
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

/**
 * Is this command-line path a Git Bash (MSYS) spelling such as `/c/Users/me`?
 * On Windows, Node reads it as the folder "\c\Users\me" on the current drive
 * and will create it: a stray `C:\c` tree. There it is refused (the user
 * passes `C:\Users\me`). Elsewhere `/c/...` is an ordinary path.
 */
export function looksLikeMsysPath(
  value: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32" && /^\/[a-zA-Z](\/|$)/.test(value);
}
