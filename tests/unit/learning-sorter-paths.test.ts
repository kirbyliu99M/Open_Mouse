/**
 * Where `learn:sort` may write, and what its run log says about the photo
 * folder: the parts of the script that are pure or only need git.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildSorterRunLog,
  containingRoot,
  gitRefusalRoots,
  parseWorktreeList,
  refusalRoots,
} from "../../src/lib/learning/paths";
import { sortReports } from "../../src/lib/learning/runlog";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("parseWorktreeList", () => {
  const output = [
    "worktree C:/work/Open_Mouse",
    "HEAD a3d7f3ad0f440fedb09231666ae0a477d6cd7731",
    "branch refs/heads/main",
    "",
    "worktree C:/work/Open_Mouse/.claude/worktrees/learning kit",
    "HEAD 8bcb666000000000000000000000000000000000",
    "branch refs/heads/learning-kit",
    "",
    "worktree C:/Temp/gone",
    "HEAD a430a7ccf51f4da3284632c248789106b3813991",
    "detached",
    "prunable gitdir file points to non-existent location",
    "",
    "worktree C:/work/bare.git",
    "bare",
    "",
  ].join("\n");

  it("reads one path per worktree, including a path with a space, a detached one and a prunable one", () => {
    expect(parseWorktreeList(output)).toEqual([
      "C:/work/Open_Mouse",
      "C:/work/Open_Mouse/.claude/worktrees/learning kit",
      "C:/Temp/gone",
      "C:/work/bare.git",
    ]);
  });

  it("copes with Windows line endings and with no output at all", () => {
    expect(parseWorktreeList(output.replaceAll("\n", "\r\n"))).toHaveLength(4);
    expect(parseWorktreeList("")).toEqual([]);
    expect(parseWorktreeList("HEAD abc\nbranch refs/heads/x\n")).toEqual([]);
  });
});

describe("refusalRoots", () => {
  const win = path.win32;

  it("holds this checkout, the main checkout and every other worktree, each once", () => {
    const roots = refusalRoots(
      "C:\\work\\Open_Mouse\\.claude\\worktrees\\learning-kit",
      "C:/work/Open_Mouse/.git",
      [
        "worktree C:/work/Open_Mouse",
        "worktree C:/work/Open_Mouse/.claude/worktrees/learning-kit",
        "worktree C:/work/Open_Mouse-claude",
        "",
      ].join("\n"),
      win,
    );
    expect(roots).toEqual([
      "C:\\work\\Open_Mouse\\.claude\\worktrees\\learning-kit",
      "C:\\work\\Open_Mouse",
      "C:\\work\\Open_Mouse-claude",
    ]);
  });

  it("refuses a sibling worktree as an output place, and allows the folder next to the main checkout", () => {
    const roots = refusalRoots(
      "C:\\work\\Open_Mouse\\.claude\\worktrees\\learning-kit",
      "C:/work/Open_Mouse/.git",
      "worktree C:/work/Open_Mouse\nworktree C:/work/Open_Mouse-claude\n",
      win,
    );
    // Another worktree that sits OUTSIDE the main checkout's folder.
    expect(
      containingRoot(
        "C:\\work\\Open_Mouse-claude\\Fixtures\\learning",
        roots,
        win,
      ),
    ).toBe("C:\\work\\Open_Mouse-claude");
    // The default: next to the main checkout, inside no worktree.
    expect(
      containingRoot("C:\\work\\Fixtures\\learning", roots, win),
    ).toBeNull();
  });

  it("without git, it is only this checkout", () => {
    expect(refusalRoots("/repo", null, "", path.posix)).toEqual(["/repo"]);
  });
});

// Real git, in a throwaway repository with three worktrees.
describe("gitRefusalRoots against a real repository", () => {
  let scratch: string;
  let main: string;
  let one: string;
  let two: string;

  const git = (cwd: string, args: readonly string[]) =>
    execFileSync("git", [...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  beforeAll(() => {
    scratch = realpathSync.native(mkdtempSync(join(tmpdir(), "learn-roots-")));
    main = join(scratch, "main");
    one = join(scratch, "wt-one");
    two = join(scratch, "wt-two");
    mkdirSync(main);
    git(main, ["init", "-q"]);
    git(main, [
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "init",
    ]);
    git(main, ["worktree", "add", "-q", "-b", "one", one]);
    git(main, ["worktree", "add", "-q", "-b", "two", two]);
  });

  afterAll(() => {
    for (const wt of [one, two]) {
      try {
        git(main, ["worktree", "remove", "--force", wt]);
      } catch {
        // the folder is removed below anyway
      }
    }
    rmSync(scratch, { recursive: true, force: true });
  });

  const runIn = (cwd: string) => (args: readonly string[]) => {
    try {
      return git(cwd, args);
    } catch {
      return null;
    }
  };
  const same = (a: string, b: string) =>
    realpathSync.native(a).toLowerCase() ===
    realpathSync.native(b).toLowerCase();

  it("from a linked worktree: knows the main checkout and both worktrees", () => {
    const { mainRoot, roots } = gitRefusalRoots(one, runIn(one));
    expect(same(mainRoot, main)).toBe(true);
    for (const expected of [main, one, two]) {
      expect(roots.some((root) => same(root, expected))).toBe(true);
    }
  });

  it("another worktree is refused as an output place; the folder next to the main checkout is not", () => {
    const { roots } = gitRefusalRoots(one, runIn(one));
    const real = roots.map((root) => realpathSync.native(root));
    expect(
      containingRoot(join(two, "Fixtures", "learning"), real),
    ).not.toBeNull();
    expect(containingRoot(join(main, "out"), real)).not.toBeNull();
    expect(
      containingRoot(join(scratch, "Fixtures", "learning"), real),
    ).toBeNull();
  });

  it("from the main checkout: the same set", () => {
    const { mainRoot, roots } = gitRefusalRoots(main, runIn(main));
    expect(same(mainRoot, main)).toBe(true);
    expect(roots.filter((root) => same(root, two))).toHaveLength(1);
  });

  it("outside any repository (git fails), only the checkout itself", () => {
    const { mainRoot, roots } = gitRefusalRoots(scratch, () => null);
    expect(mainRoot).toBe(scratch);
    expect(roots).toEqual([scratch]);
  });
});

describe("the git ignore file", () => {
  const ignored = (file: string) =>
    spawnSync("git", ["check-ignore", "-q", file], { cwd: REPO }).status === 0;

  it("ignores learn:sort output wherever it lands (a second line of defence)", () => {
    expect(ignored("Fixtures/learning/P001/slate.jpg")).toBe(true);
    expect(ignored("Fixtures/learning/runs/2026-09-30.json")).toBe(true);
    expect(
      ignored(".claude/worktrees/other/Fixtures/learning/P001/G01R/1.jpg"),
    ).toBe(true);
    expect(ignored("somewhere/Fixtures/learning/P001/truth.json")).toBe(true);
  });

  it("does not hide committed test fixtures, whatever the case of the folder name", () => {
    expect(ignored("tests/e2e/fixtures/camera/sheet-full.y4m")).toBe(false);
    expect(ignored("tests/unit/fixtures/anything.json")).toBe(false);
  });
});

describe("buildSorterRunLog", () => {
  const win = path.win32;
  const reports = [] as const;
  const sort = sortReports(reports);
  const common = {
    reports,
    sort,
    paperSize: "a4" as const,
    provenance: { gitSha: null, gitDirty: null },
    now: new Date("2026-09-30T00:00:00Z"),
    api: win,
  };

  it("names the photo folder relative to where the command ran, never absolutely", () => {
    const log = buildSorterRunLog({
      ...common,
      input:
        "C:\\Users\\kirby\\Desktop\\Mouse Shape Project\\Photos\\session-1",
      cwd: "C:\\Users\\kirby\\Desktop\\Mouse Shape Project\\Open_Mouse",
      username: "kirby",
    });
    expect(log.input).toBe("../Photos/session-1");
    const text = JSON.stringify(log);
    expect(text).not.toMatch(/kirby/i);
    expect(text).not.toContain("C:");
    expect(text).not.toContain("\\\\");
  });

  it("keeps only the folder's own name across drives, and hides the account name where it would show", () => {
    expect(
      buildSorterRunLog({
        ...common,
        input: "D:\\DCIM\\Camera",
        cwd: "C:\\repo",
        username: "kirby",
      }).input,
    ).toBe("Camera");
    const home = buildSorterRunLog({
      ...common,
      input: "C:\\Users\\kirby",
      cwd: "E:\\repo",
      username: "kirby",
    });
    expect(home.input).toBe("~");
    expect(JSON.stringify(home)).not.toMatch(/kirby/i);
  });
});
