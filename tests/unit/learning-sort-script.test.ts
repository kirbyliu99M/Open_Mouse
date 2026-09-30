/**
 * `npm run learn:sort` reads real people's hand photos, so its refusals are
 * tested by running the real script: it must stop before it starts a server
 * or opens a browser. Nothing here needs photos, Chromium or a network.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TSX = join(REPO, "node_modules", "tsx", "dist", "cli.mjs");
const SCRIPT = join(REPO, "scripts", "learn-sort.ts");

function sorter(args: readonly string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [TSX, SCRIPT, ...args], {
    cwd: REPO,
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
      join(REPO, "..", basename(REPO), "again"),
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
