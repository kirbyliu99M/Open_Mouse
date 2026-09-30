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

  it("does not take a URL or a relative path for an absolute one", () => {
    for (const text of [
      "Starting dev server on http://127.0.0.1:3401 …",
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

// Whatever stands before a POSIX path, and whatever its first folder is.
const PREFIXES: [string, string][] = [
  ["the start of the text", ""],
  ["a colon", "path:"],
  ["a colon and a space", "cwd: "],
  ["a bracket", "["],
  ["a brace", "{"],
  ["a comma", "a,"],
  ["a semicolon", "a;"],
  ["a backtick", "`"],
  ["an angle bracket", "<"],
  ["a single quote", "'"],
  ["a double quote", '"'],
  ["a parenthesis", "("],
  ["an equals sign", "root="],
  ["white space", "see "],
];
const ROOTS_UNDER_TEST = ["/home/bob", "/data", "/workspace", "/Applications"];

describe("hasAnyAbsolutePath: prefixes and roots", () => {
  it.each(PREFIXES)("finds a POSIX path after %s", (_label, prefix) => {
    for (const root of ROOTS_UNDER_TEST) {
      expect(hasAnyAbsolutePath(`${prefix}${root}/x/y.mjs`)).toBe(true);
    }
  });

  it("finds file URLs, UNC paths and drive paths", () => {
    for (const text of [
      "file:///home/bob/x/y.mjs",
      "at file:///C:/Users/bob/x.mjs:3:1",
      "\\\\srv\\share\\photos\\a.jpg",
      "'\\\\NAS\\My Share\\a.jpg'",
      "open C:\\Users\\bob\\a.txt",
      "open d:/photos",
      "\\\\?\\C:\\Users\\bob",
    ]) {
      expect(hasAnyAbsolutePath(text), text).toBe(true);
    }
  });

  it("finds a system root on its own, and nothing that only looks like one", () => {
    expect(hasAnyAbsolutePath("in /tmp now")).toBe(true);
    expect(hasAnyAbsolutePath("the /tmpfile idea")).toBe(false);
  });

  it("does not take URLs, fractions, dates or relative paths for absolute paths", () => {
    for (const text of [
      "http://127.0.0.1:3401/learn/check",
      "https://open-mouse.vercel.app/l/v1/G03R",
      "3/4 and 10/12",
      "2026/09/30",
      "../../home/bob/x",
      "./data/x/y",
      "~/data/x",
      "<path>/x/y",
      "P001/G01R/3",
      "a / b",
    ]) {
      expect(hasAnyAbsolutePath(text), text).toBe(false);
    }
  });

  // The helper is written on its own, so it can catch what the redactor
  // misses: everything it calls a leak, the redactor must hide.
  it.each(PREFIXES)(
    "and the terminal redaction hides every one of them: %s",
    (_label, prefix) => {
      for (const root of ROOTS_UNDER_TEST) {
        const text = `${prefix}${root}/x/y.mjs`;
        expect(hasAnyAbsolutePath(text)).toBe(true);
        expect(hasAnyAbsolutePath(show(text))).toBe(false);
      }
    },
  );

  it("... and file URLs and UNC paths as well", () => {
    for (const text of [
      "at file:///home/bob/x/y.mjs:3:1",
      "cannot open \\\\srv\\share\\photos\\a.jpg",
    ]) {
      expect(hasAnyAbsolutePath(show(text)), text).toBe(false);
    }
  });
});
