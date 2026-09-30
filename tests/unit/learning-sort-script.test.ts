/**
 * `npm run learn:sort` reads real people's hand photos, so its refusals are
 * tested by running the real script: it must stop before it starts a server
 * or opens a browser. Nothing here needs photos, Chromium or a network.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import {
  createServer as createNetServer,
  type AddressInfo,
  type Server as NetServer,
} from "node:net";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { basename, dirname, join, parse, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseWorktreeList } from "../../src/lib/learning/paths";
import { expectNoLeak } from "./helpers/no-absolute-paths";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TSX = join(REPO, "node_modules", "tsx", "dist", "cli.mjs");
const SCRIPT = join(REPO, "scripts", "learn-sort.ts");

function sorter(
  args: readonly string[],
  env: Record<string, string> = {},
  cwd: string = REPO,
) {
  const result = spawnSync(process.execPath, [TSX, SCRIPT, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, CI: "", ...env },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** The same, asynchronously: for tests that run a server in this process, which `spawnSync` would freeze. */
function sorterAsync(
  args: readonly string[],
  env: Record<string, string> = {},
  cwd: string = REPO,
) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>(
    (done) => {
      const child = spawn(process.execPath, [TSX, SCRIPT, ...args], {
        cwd,
        env: { ...process.env, CI: "", ...env },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("close", (status) => done({ status, stdout, stderr }));
    },
  );
}

/** Removes a symlink or Windows junction itself, never what it points to. */
function removeLink(link: string) {
  if (process.platform === "win32") {
    spawnSync("cmd.exe", ["/d", "/c", "rmdir", link.replace(/\//g, "\\")]);
  } else {
    unlinkSync(link);
  }
}

describe("learn-sort refuses to run where it must not", () => {
  let scratch: string;
  let emptyInput: string;
  let outside: string;
  let link: string;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), "learn-sort-test-"));
    emptyInput = join(scratch, "photos");
    outside = join(scratch, "out");
    link = join(scratch, "link-into-repo");
    mkdirSync(emptyInput);
  });
  afterAll(() => {
    // Never delete recursively while the link (which points at the repo)
    // still exists: leave the scratch folder behind instead.
    if (existsSync(link)) return;
    rmSync(scratch, { recursive: true, force: true });
  });

  const REFUSED = /--out must be outside the repo/;

  it.each([
    ["a folder inside the repo", join(REPO, "fixtures-out")],
    [
      "a folder that does not exist yet, several levels down",
      join(REPO, "a", "b", "c"),
    ],
    ["the repo root itself", REPO],
    ["a relative path that lands inside the repo", "./learning-out"],
    [
      "a dot-dot path that leaves and comes back",
      // Joined as text: `path.join` would fold the `..` away before the
      // script ever saw it.
      `${REPO}/../${basename(REPO)}/again`,
    ],
  ])(
    "--out as %s",
    (_label, out) => {
      const result = sorter(["--in", emptyInput, "--out", out]);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(REFUSED);
      // It stopped at the check: no server, no browser.
      expect(result.stdout).not.toMatch(/Starting dev server/);
    },
    60_000,
  );

  // Needs a second worktree of this repository, which a developer's machine
  // usually has and a CI checkout does not; the rule itself is tested against a
  // real throwaway repository in learning-sorter-paths.test.ts.
  const otherWorktree = (() => {
    try {
      const listed = execFileSync("git", ["worktree", "list", "--porcelain"], {
        cwd: REPO,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      // Not the main checkout (listed first) and not this one: the rule that
      // covers those two alone would pass without asking git about the rest.
      return parseWorktreeList(listed)
        .slice(1)
        .find((root) => resolve(root).toLowerCase() !== REPO.toLowerCase());
    } catch {
      return undefined;
    }
  })();
  it.skipIf(!otherWorktree)(
    "--out inside another git worktree of this repository",
    () => {
      const result = sorter([
        "--in",
        emptyInput,
        "--out",
        join(otherWorktree!, "Fixtures", "learning"),
      ]);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(REFUSED);
    },
    60_000,
  );

  it("--out reached through a symlink or junction that points into the repo", () => {
    symlinkSync(REPO, link, "junction");
    try {
      const result = sorter([
        "--in",
        emptyInput,
        "--out",
        join(link, "photos"),
      ]);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(REFUSED);
    } finally {
      removeLink(link);
    }
  }, 60_000);

  it("accepts a folder outside the repo (it then stops on the empty photo folder, before any browser)", () => {
    const result = sorter(["--in", emptyInput, "--out", outside]);
    expect(result.status).toBe(1);
    expect(result.stderr).not.toMatch(REFUSED);
    expect(result.stderr).toMatch(/No \.jpg or \.png photos/);
    expect(result.stdout).not.toMatch(/Starting dev server/);
  }, 60_000);

  // Anything listening in the way is refused, whatever it would say over HTTP:
  // a live page, a 404, or nothing at all (a server that accepts and hangs).
  const inTheWay: [string, () => Server | NetServer][] = [
    ["answers 200", () => createServer((_req, res) => res.end("ok"))],
    [
      "answers 404",
      () =>
        createServer((_req, res) => {
          res.statusCode = 404;
          res.end("no");
        }),
    ],
    ["accepts connections and never answers", () => createNetServer(() => {})],
  ];
  it.each(inTheWay)(
    "does not reuse a server that already listens on its port and %s (it could be another branch's)",
    async (_label, make) => {
      const photos = join(scratch, "one-photo");
      mkdirSync(photos, { recursive: true });
      writeFileSync(join(photos, "IMG_0001.jpg"), "not really a jpeg");
      const stale = make();
      await new Promise<void>((ready) => stale.listen(0, "127.0.0.1", ready));
      const { port } = stale.address() as AddressInfo;
      try {
        const result = await sorterAsync([
          "--in",
          photos,
          "--out",
          outside,
          "--port",
          String(port),
        ]);
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/Something already answers/);
        // Not said before the check, and nothing was started or run.
        expect(result.stdout).not.toMatch(/Starting dev server/);
        expect(result.stdout).not.toMatch(/Checking/);
      } finally {
        await new Promise((closed) => stale.close(closed));
      }
    },
    60_000,
  );

  it("never runs in CI", () => {
    const result = sorter(["--in", emptyInput, "--out", outside], { CI: "1" });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/must never run in CI/);
    expect(result.stderr).not.toMatch(/No \.jpg/);
  }, 60_000);

  it("needs --in, and checks --paper", () => {
    expect(sorter([]).stderr).toMatch(/Usage/);
    const bad = sorter(["--in", emptyInput, "--out", outside, "--paper", "a5"]);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/--paper must be one of a4, letter/);
    const proto = sorter([
      "--in",
      emptyInput,
      "--out",
      outside,
      "--paper",
      "toString",
    ]);
    expect(proto.status).toBe(1);
    expect(proto.stderr).toMatch(/--paper must be one of/);
    const ok = sorter([
      "--in",
      emptyInput,
      "--out",
      outside,
      "--paper",
      "letter",
    ]);
    expect(ok.stderr).toMatch(/No \.jpg or \.png photos/);
  }, 60_000);
});

// What the terminal shows. A run that fails prints the message, not the stack,
// and no absolute path or account name (a session's output gets pasted into
// issues and chats). The account is the real one of whoever runs the tests, so
// these checks skip themselves for a name too short to tell from other text.
describe("learn-sort output carries no absolute path, stack or account name", () => {
  const username = userInfo().username;
  const nameable = username.length >= 3;
  let scratch: string;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), "learn-sort-output-"));
  });
  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  /**
   * Nothing in `text` may name the repo, the scratch folder, the temp or home
   * folder as an ABSOLUTE path, or any other absolute path, or the account. (A
   * relative path such as ../../tmp/x is fine although it holds "/tmp/x": on
   * Linux the scratch folder is under /tmp.)
   */
  function expectClean(text: string) {
    expectNoLeak(text, {
      folders: [REPO, scratch, tmpdir(), homedir()],
      username: nameable ? username : null,
    });
  }

  // A folder that exists and is a folder but cannot be listed. Windows: an ACL
  // entry that denies listing; elsewhere: mode 000 (which root ignores).
  function withUnlistable<T>(dir: string, run: () => T): T | "unsupported" {
    if (process.platform === "win32") {
      try {
        execFileSync("icacls", [dir, "/deny", `${username}:(RD)`], {
          stdio: "ignore",
        });
      } catch {
        return "unsupported";
      }
      try {
        return run();
      } finally {
        execFileSync("icacls", [dir, "/remove:d", username], {
          stdio: "ignore",
        });
      }
    }
    if (process.getuid?.() === 0) return "unsupported";
    chmodSync(dir, 0o000);
    try {
      return run();
    } finally {
      chmodSync(dir, 0o755);
    }
  }

  it("a photo folder that cannot be listed: a redacted message, not a raw stack (EPERM/EACCES)", () => {
    const locked = join(scratch, nameable ? `${username}-locked` : "locked");
    mkdirSync(locked, { recursive: true });
    const result = withUnlistable(locked, () =>
      sorter(["--in", locked, "--out", join(scratch, "out")]),
    );
    if (result === "unsupported") return;
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/EPERM|EACCES/);
    expect(result.stderr).toMatch(/scandir|readdir|permission/i);
    expectClean(result.stderr);
    expectClean(result.stdout);
    // Nothing was started.
    expect(result.stdout).not.toMatch(/Starting dev server/);
  }, 60_000);

  // "/c/Users/me" is how Git Bash spells C:\Users\me. Node on Windows reads it
  // as the folder \c\Users\me and makes it: a stray C:\c tree.
  it.skipIf(process.platform !== "win32")(
    "a Git Bash style path is refused on Windows, and no folder is made",
    () => {
      const unique = `learn-sort-msys-${process.pid}-${Date.now()}`;
      const strayRoot = join(parse(scratch).root, "c");
      for (const flag of ["--in", "--out"]) {
        const args =
          flag === "--in"
            ? ["--in", `/c/${unique}/photos`]
            : ["--in", scratch, "--out", `/c/${unique}/out`];
        const result = sorter(args);
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(
          new RegExp(`${flag} looks like a Git Bash path`),
        );
        expect(result.stderr).not.toContain(unique);
        expect(result.stdout).toBe("");
      }
      expect(existsSync(join(strayRoot, unique))).toBe(false);
    },
    60_000,
  );

  it("elsewhere, and for a Windows path, the same words are an ordinary path (no Git Bash refusal)", () => {
    const result = sorter(["--in", scratch, "--out", join(scratch, "o")]);
    expect(result.stderr).not.toMatch(/Git Bash/);
  }, 60_000);

  it("the --out refusal names the folder relative to where the command ran", () => {
    const input = join(scratch, "photos");
    mkdirSync(input, { recursive: true });
    const result = sorter([
      "--in",
      input,
      "--out",
      join(REPO, "fixtures-out", "deeper"),
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--out must be outside the repo/);
    expect(result.stderr).toContain("(hard rule 1): fixtures-out/deeper");
    expectClean(result.stderr);
  }, 60_000);

  it("a complaint about the photo folder shows it relative, with the account name masked", () => {
    // A folder named after the account, the way `Kirby Photos` is.
    const input = join(scratch, `${nameable ? username : "me"}-photos`);
    mkdirSync(input, { recursive: true });
    const empty = sorter(["--in", input, "--out", join(scratch, "out")]);
    expect(empty.status).toBe(1);
    expect(empty.stderr).toMatch(/No \.jpg or \.png photos in \S+\/~?\S*\./);
    expectClean(empty.stderr);
    const missing = sorter(["--in", join(input, "nope"), "--out", scratch]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/Not a folder: /);
    expectClean(missing.stderr);
    if (nameable) {
      expect(empty.stderr).toContain("/~.");
      expect(missing.stderr).toContain("/~/nope");
    }
  }, 60_000);

  it("a dev server that dies at start-up: its last words with '.' for the checkout, no stack, no path", async () => {
    const photos = join(scratch, "one-photo");
    mkdirSync(photos, { recursive: true });
    writeFileSync(join(photos, "IMG_0001.jpg"), "not really a jpeg");
    const probe = createNetServer();
    await new Promise<void>((ready) => probe.listen(0, "127.0.0.1", ready));
    const { port } = probe.address() as AddressInfo;
    await new Promise((closed) => probe.close(closed));
    // `next` (and only `next`) dies at once, quoting absolute paths.
    const preload = join(REPO, "tests", "unit", "helpers", "die-if-next.mjs");
    const result = await sorterAsync(
      [
        "--in",
        photos,
        "--out",
        join(scratch, "out"),
        "--port",
        String(port),
        "--dry-run",
      ],
      {
        NODE_OPTIONS: `--import ${pathToFileURL(preload).href}`,
        // The command runs from the scratch folder, NOT the checkout, and the
        // server also quotes that folder: both must come out as ".".
        DIE_IF_NEXT_QUOTES: scratch,
      },
      scratch,
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(
      /The dev server exited before it was ready \(code 1\)/,
    );
    expect(result.stderr).toMatch(
      /Cannot find module '\.[\\/]node_modules[\\/]next[\\/]dist[\\/]server[\\/]next\.js'/,
    );
    // The working folder (the scratch folder) is "." ...
    expect(result.stderr).toMatch(/started from '\.[\\/]session\.txt'/);
    // ...and so is the checkout, though it is a different folder.
    expect(result.stderr).toMatch(/Cannot find module '\.[\\/]node_modules/);
    // A path nobody told the sorter about is <path>, whoever printed it.
    expect(result.stderr).toMatch(/settings are in '<path>'/);
    expect(result.stderr).toMatch(/Executable doesn't exist at <path>/);
    // Stack frames are not shown.
    expect(result.stderr).toMatch(/\(stack frames omitted\)/);
    expect(result.stderr).not.toMatch(
      /Module\._resolveFilename|Object\.<anonymous>/,
    );
    expect(result.stderr).not.toMatch(/devserver\.ts|learn-sort\.ts|tsx/);
    expectClean(result.stderr);
    expectClean(result.stdout);
  }, 120_000);
});
