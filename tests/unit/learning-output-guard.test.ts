/**
 * `outputInsideRepo` and `realpathLoose`: the rule that keeps photos, truth
 * files and evaluation reports out of anywhere they could be committed. Tested
 * on real folders (a "main checkout" and two worktrees in a throwaway folder)
 * with git stubbed to say so, including a Windows junction and, on POSIX, a
 * real symlink.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { outputInsideRepo, realpathLoose } from "../../src/lib/learning/paths";

const WINDOWS = process.platform === "win32";

/** Removes a link or junction itself, never what it points to. */
function removeLink(link: string) {
  if (WINDOWS) spawnSync("cmd.exe", ["/d", "/c", "rmdir", link]);
  else unlinkSync(link);
}

describe("outputInsideRepo and realpathLoose", () => {
  let scratch: string;
  let main: string;
  let wtA: string;
  let wtB: string;
  let outside: string;
  const links: string[] = [];

  /** git as it would answer in `wtA`, a worktree of `main`, next to `wtB`. */
  const git = (args: readonly string[]): string | null => {
    if (args[0] === "rev-parse") return `${join(main, ".git")}\n`;
    if (args[0] === "worktree") {
      return [main, wtA, wtB].map((root) => `worktree ${root}\n\n`).join("");
    }
    return null;
  };
  const noGit = () => null;

  /** A directory link (a junction on Windows, a symlink elsewhere) from `link` to `target`. */
  function link(target: string, at: string) {
    symlinkSync(target, at, "junction");
    links.push(at);
    return at;
  }

  beforeAll(() => {
    scratch = realpathSync.native(mkdtempSync(join(tmpdir(), "output-guard-")));
    main = join(scratch, "main");
    wtA = join(scratch, "wt-a");
    wtB = join(scratch, "wt-b");
    outside = join(scratch, "outside");
    for (const dir of [join(main, ".git"), wtA, wtB, outside]) {
      mkdirSync(dir, { recursive: true });
    }
  });
  afterAll(() => {
    // Links first: a recursive delete must never follow one into the repo.
    for (const l of links) if (existsSync(l)) removeLink(l);
    if (links.every((l) => !existsSync(l)))
      rmSync(scratch, { recursive: true, force: true });
  });

  describe("outputInsideRepo", () => {
    it.each([
      ["this worktree", () => wtA],
      ["the main checkout", () => main],
      ["another worktree", () => wtB],
    ])("names %s when the output is inside it", (_label, root) => {
      const r = root();
      expect(outputInsideRepo(join(r, "report.json"), wtA, git)).not.toBeNull();
      // A folder that does not exist yet, several levels down.
      expect(
        outputInsideRepo(join(r, "a", "b", "report.json"), wtA, git),
      ).not.toBeNull();
      // The root itself.
      expect(outputInsideRepo(r, wtA, git)).not.toBeNull();
    });

    it("returns the checkout it found", () => {
      expect(outputInsideRepo(join(wtB, "x", "r.json"), wtA, git)).toBe(wtB);
    });

    it("is null outside all of them, also for a name that only starts like one", () => {
      expect(outputInsideRepo(join(outside, "r.json"), wtA, git)).toBeNull();
      expect(
        outputInsideRepo(join(scratch, "main-data", "r.json"), wtA, git),
      ).toBeNull();
      expect(
        outputInsideRepo(join(scratch, "wt-a2", "x", "r.json"), wtA, git),
      ).toBeNull();
    });

    it("sees through a dot-dot path that leaves and comes back", () => {
      const sneaky = `${outside}${path.sep}..${path.sep}wt-b${path.sep}r.json`;
      expect(outputInsideRepo(sneaky, wtA, git)).not.toBeNull();
      const leaves = `${wtA}${path.sep}..${path.sep}outside${path.sep}r.json`;
      expect(outputInsideRepo(leaves, wtA, git)).toBeNull();
    });

    it("with no answer from git it still refuses this checkout, and only that", () => {
      expect(outputInsideRepo(join(wtA, "r.json"), wtA, noGit)).toBe(wtA);
      expect(outputInsideRepo(join(outside, "r.json"), wtA, noGit)).toBeNull();
      // Without git, other worktrees are not known.
      expect(outputInsideRepo(join(wtB, "r.json"), wtA, noGit)).toBeNull();
    });

    it("a junction (or link) from outside into a checkout does not hide it", () => {
      const door = link(main, join(outside, "door-to-main"));
      expect(outputInsideRepo(join(door, "r.json"), wtA, git)).not.toBeNull();
      // ...also for a folder below the link that does not exist yet.
      expect(
        outputInsideRepo(join(door, "new", "deep", "r.json"), wtA, git),
      ).not.toBeNull();
      // And a link to another worktree.
      const toB = link(wtB, join(outside, "door-to-wt-b"));
      expect(outputInsideRepo(join(toB, "r.json"), wtA, git)).toBe(wtB);
    });

    it("a checkout that git lists through a link is still that checkout when the output is given by its real path", () => {
      const viaLink = link(wtB, join(outside, "wt-b-as-git-lists-it"));
      const linked = (args: readonly string[]): string | null =>
        args[0] === "worktree"
          ? `worktree ${main}\n\nworktree ${wtA}\n\nworktree ${viaLink}\n`
          : git(args);
      expect(outputInsideRepo(join(wtB, "r.json"), wtA, linked)).not.toBeNull();
      expect(
        outputInsideRepo(join(wtB, "new", "r.json"), wtA, linked),
      ).not.toBeNull();
    });

    it("a link inside a checkout that really leads outside is judged by where it leads", () => {
      const window = link(outside, join(wtB, "window"));
      expect(outputInsideRepo(join(window, "r.json"), wtA, git)).toBeNull();
    });

    it.skipIf(WINDOWS)(
      "a symlink to a FILE inside a checkout does not hide it (POSIX symlink)",
      () => {
        const target = join(main, "existing.json");
        writeFileSync(target, "x");
        const at = join(outside, "file-link.json");
        symlinkSync(target, at, "file");
        links.push(at);
        expect(outputInsideRepo(at, wtA, git)).not.toBeNull();
        // A symlink to a file that is not there yet: still judged by its target's place.
        const dangling = join(outside, "dangling.json");
        symlinkSync(join(wtB, "not-yet.json"), dangling, "file");
        links.push(dangling);
        expect(outputInsideRepo(dangling, wtA, git)).not.toBeNull();
      },
    );
  });

  describe("realpathLoose", () => {
    it("is the real path of something that exists", () => {
      expect(realpathLoose(outside)).toBe(realpathSync.native(outside));
      const door = link(outside, join(scratch, "door-to-outside"));
      expect(realpathLoose(door)).toBe(realpathSync.native(outside));
    });

    it("resolves the nearest existing parent and keeps the rest as it was written", () => {
      expect(realpathLoose(join(outside, "a", "b", "r.json"))).toBe(
        join(realpathSync.native(outside), "a", "b", "r.json"),
      );
      const door = link(outside, join(scratch, "door-to-outside-2"));
      expect(realpathLoose(join(door, "new", "r.json"))).toBe(
        join(realpathSync.native(outside), "new", "r.json"),
      );
    });

    it("resolves a relative path against the working folder", () => {
      const name = `output-guard-${process.pid}-missing`;
      expect(realpathLoose(name)).toBe(
        join(realpathSync.native(process.cwd()), name),
      );
    });

    it("folds dot-dot segments before looking", () => {
      expect(realpathLoose(join(outside, "x", "..", "y"))).toBe(
        join(realpathSync.native(outside), "y"),
      );
    });

    // Only Windows has roots that can be missing: a drive letter nothing uses.
    it.skipIf(!WINDOWS)(
      "returns the plain resolved path when not even the root exists (an unused drive)",
      () => {
        const free = "ZYXWVUTSRQPONMLKJIHGFED"
          .split("")
          .find((letter) => !existsSync(`${letter}:${path.sep}`));
        if (!free) return;
        const target = `${free}:${path.sep}nothing${path.sep}here.json`;
        expect(realpathLoose(target)).toBe(path.resolve(target));
      },
    );
  });
});
