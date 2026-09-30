/**
 * The shared "no leak" assertions, checked against what a Linux CI runner
 * prints: scratch folders under /tmp and a checkout under /home/runner/work,
 * where a correctly redacted RELATIVE path still contains the scratch folder's
 * text. Simulated with `path.posix`, so it runs on any machine.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { redactText, terminalRedaction } from "../../src/lib/learning/paths";
import {
  expectNoLeak,
  hasAnyAbsolutePath,
  namesAbsolutePath,
} from "./helpers/no-absolute-paths";

const CHECKOUT = "/home/runner/work/Open_Mouse/Open_Mouse";
const SCRATCH = "/tmp/m2-evaluate-test-AbC123";
const folders = [CHECKOUT, SCRATCH, "/tmp", "/home/runner"];

/** What the scripts print on Linux for a path in the scratch folder. */
const show = (text: string, over: { input?: string; outDir?: string } = {}) =>
  redactText(
    text,
    terminalRedaction({
      cwd: CHECKOUT,
      scriptRoot: CHECKOUT,
      username: "runner",
      api: path.posix,
      ...over,
    }),
  );

describe("expectNoLeak on Linux-shaped output", () => {
  it("a correctly redacted relative path, which still holds the scratch folder's text, is not a leak", () => {
    const printed = show(
      `ENOENT: no such file or directory, open '${SCRATCH}/out/r.json'`,
      {
        outDir: `${SCRATCH}/out`,
      },
    );
    // The relative path from the checkout to /tmp/... has five "..".
    expect(printed).toContain(
      "../../../../../tmp/m2-evaluate-test-AbC123/out/r.json",
    );
    // A plain substring check would call this a leak; it is not one.
    expect(printed).toContain(SCRATCH);
    expect(() =>
      expectNoLeak(printed, { folders, username: "runner" }),
    ).not.toThrow();
  });

  it("the checkout as '.' and a path nobody told the script about as <path> are clean too", () => {
    const printed = show(
      `Cannot find '${CHECKOUT}/node_modules/next/dist/bin/next'\nExecutable doesn't exist at /home/runner/.cache/ms-playwright/chromium/chrome`,
    );
    expect(printed).toBe(
      "Cannot find './node_modules/next/dist/bin/next'\nExecutable doesn't exist at <path>",
    );
    expect(() =>
      expectNoLeak(printed, { folders, username: "runner" }),
    ).not.toThrow();
  });

  it.each([
    ["the scratch folder, quoted", `open '${SCRATCH}/out/r.json' failed`],
    [
      "the scratch folder at the start of the text",
      `${SCRATCH}/out: not a folder`,
    ],
    ["the checkout after a space", `error in ${CHECKOUT}/scripts/x.ts`],
    ["the checkout in parentheses", `(${CHECKOUT}/scripts/x.ts:1:1)`],
    ["the checkout after =", `path=${CHECKOUT}`],
    ["an unknown path under /home", "reading /home/someone/else/notes.txt"],
    ["an unknown path under /var", "open '/var/log/x'"],
    [
      "a Windows path",
      "Executable doesn't exist at C:\\Users\\me\\AppData\\chrome.exe",
    ],
    ["a Windows path with forward slashes", "in D:/photos/x.jpg"],
    ["a stack frame", "Error: x\n    at f (file.js:1:1)"],
    ["the account name", "hello runner"],
  ])("still catches a leak: %s", (_label, text) => {
    expect(() => expectNoLeak(text, { folders, username: "runner" })).toThrow();
  });

  it("does not take a URL, a page route or a relative path for an absolute one", () => {
    for (const text of [
      "Starting dev server on http://127.0.0.1:3401 …",
      "open /learn/check in the browser",
      "../../../../../tmp/x/y",
      "./node_modules/next",
    ]) {
      expect(hasAnyAbsolutePath(text)).toBe(false);
    }
  });

  it("namesAbsolutePath: slash style and letter case do not matter, position does", () => {
    expect(namesAbsolutePath("open 'C:\\Work\\Repo\\x'", "c:/work/repo")).toBe(
      true,
    );
    expect(namesAbsolutePath("open '..\\..\\Work\\Repo\\x'", "C:\\Work")).toBe(
      false,
    );
    expect(namesAbsolutePath("../../tmp/x", "/tmp/x")).toBe(false);
    expect(namesAbsolutePath("x /tmp/x", "/tmp/x")).toBe(true);
  });
});
