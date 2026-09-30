/**
 * `realpathLoose`: where a path really lands, also when part of it (or all of
 * it) does not exist yet, and when it goes through a link. Tested on real
 * folders, with a Windows junction and, on POSIX, a real symlink.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { realpathLoose } from "../../src/lib/learning/paths";

const WINDOWS = process.platform === "win32";

/** Removes a link or junction itself, never what it points to. */
function removeLink(link: string) {
  if (WINDOWS) spawnSync("cmd.exe", ["/d", "/c", "rmdir", link]);
  else unlinkSync(link);
}

describe("realpathLoose", () => {
  let scratch: string;
  let real: string;
  const links: string[] = [];

  /** A directory link (a junction on Windows, a symlink elsewhere). */
  function link(target: string, at: string) {
    symlinkSync(target, at, "junction");
    links.push(at);
    return at;
  }

  beforeAll(() => {
    scratch = realpathSync.native(mkdtempSync(join(tmpdir(), "realpath-")));
    real = join(scratch, "real");
    mkdirSync(real);
  });
  afterAll(() => {
    // Links first: a recursive delete must never follow one.
    for (const l of links) if (isLink(l)) removeLink(l);
    rmSync(scratch, { recursive: true, force: true });
  });

  /** Is there a link at `p`, also one that points at nothing (where `existsSync` says false)? */
  function isLink(p: string): boolean {
    try {
      return lstatSync(p).isSymbolicLink();
    } catch {
      return false;
    }
  }

  it("is the real path of something that exists", () => {
    expect(realpathLoose(real)).toBe(realpathSync.native(real));
    const door = link(real, join(scratch, "door"));
    expect(realpathLoose(door)).toBe(realpathSync.native(real));
  });

  it("resolves the nearest existing parent and keeps the rest as it was written", () => {
    expect(realpathLoose(join(real, "a", "b", "r.json"))).toBe(
      join(realpathSync.native(real), "a", "b", "r.json"),
    );
    const door = link(real, join(scratch, "door-2"));
    expect(realpathLoose(join(door, "new", "r.json"))).toBe(
      join(realpathSync.native(real), "new", "r.json"),
    );
  });

  it("resolves a relative path against the working folder", () => {
    const name = `realpath-${process.pid}-missing`;
    expect(realpathLoose(name)).toBe(
      join(realpathSync.native(process.cwd()), name),
    );
  });

  it("folds dot-dot segments before looking", () => {
    expect(realpathLoose(join(real, "x", "..", "y"))).toBe(
      join(realpathSync.native(real), "y"),
    );
  });

  // A link to nothing: `existsSync` is false for it, yet a write through it
  // lands where it points.
  describe("a link that points at nothing", () => {
    it("is followed to where it points (a junction to a folder that is gone; on POSIX a symlink)", () => {
      const target = join(real, "gone");
      mkdirSync(target);
      const dangling = link(target, join(scratch, "dangling"));
      rmdirSync(target);
      expect(existsSync(dangling)).toBe(false);
      expect(realpathLoose(dangling)).toBe(
        join(realpathSync.native(real), "gone"),
      );
      // Below it, too.
      expect(realpathLoose(join(dangling, "deeper", "r.json"))).toBe(
        join(realpathSync.native(real), "gone", "deeper", "r.json"),
      );
    });

    it("also when what it points at is under another link", () => {
      const door = link(real, join(scratch, "door-3"));
      const target = join(door, "gone-2");
      mkdirSync(target);
      const dangling = link(target, join(scratch, "dangling-2"));
      rmdirSync(target);
      expect(realpathLoose(dangling)).toBe(
        join(realpathSync.native(real), "gone-2"),
      );
    });

    it("a chain of links to nothing is followed to the end; a loop gives up with the plain path", () => {
      const target = join(real, "gone-3");
      mkdirSync(target);
      const first = link(target, join(scratch, "chain-1"));
      const second = link(first, join(scratch, "chain-2"));
      rmdirSync(target);
      expect(realpathLoose(second)).toBe(
        join(realpathSync.native(real), "gone-3"),
      );
      if (!WINDOWS) {
        const a = join(scratch, "loop-a");
        const b = join(scratch, "loop-b");
        symlinkSync(b, a);
        symlinkSync(a, b);
        links.push(a, b);
        expect(realpathLoose(a)).toBe(path.resolve(a));
      }
    });

    it.skipIf(WINDOWS)(
      "a symlink with a RELATIVE target is read from the link's own folder, not the working folder (POSIX)",
      () => {
        const folder = join(real, "rel");
        mkdirSync(folder);
        const at = join(folder, "r.json");
        symlinkSync(join("..", "elsewhere", "r.json"), at, "file");
        links.push(at);
        expect(realpathLoose(at)).toBe(
          join(realpathSync.native(real), "elsewhere", "r.json"),
        );
      },
    );

    it.skipIf(WINDOWS)(
      "a symlink to a FILE that is not there yet (POSIX)",
      () => {
        const at = join(scratch, "file-link.json");
        symlinkSync(join(real, "not-yet.json"), at, "file");
        links.push(at);
        expect(realpathLoose(at)).toBe(
          join(realpathSync.native(real), "not-yet.json"),
        );
        // And once the file exists it is simply its real path.
        writeFileSync(join(real, "not-yet.json"), "x");
        expect(realpathLoose(at)).toBe(
          realpathSync.native(join(real, "not-yet.json")),
        );
      },
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
