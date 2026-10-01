import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  classify,
  existingFiles,
  isDocsOnlyPath,
  parseNulList,
  prettierInvocation,
  prettierMain,
  prettierVersion,
  readChangedPaths,
} from "../../scripts/ci/lib.mjs";
import type { Invocation } from "../../scripts/ci/lib.mjs";

/**
 * G1 (CI budget). The first step of .github/workflows/ci.yml decides whether a
 * run skips the gate. A wrong answer there turns a red change green, and the
 * workflow file itself is not otherwise tested, so this file pins:
 *
 *   1. the pure decision (`classify`, `isDocsOnlyPath`) and the git layer with
 *      git injected (`readChangedPaths`),
 *   2. the classify-changes.mjs CLI against a real git repository (NUL-separated
 *      names, renames, deletions, every "cannot tell, so run everything" path,
 *      and fail-closed when the outputs cannot be written),
 *   3. the docs-only Prettier check (prettier-changed-docs.mjs),
 *   4. the shape of ci.yml (job id `checks`, triggers, and an explicit
 *      command -> gate table for every step after the classifier).
 */

/** process.env minus everything the scripts read, so a run inside Actions cannot leak in. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      /^(GITHUB_|RUNNER_|INPUT_)/i.test(key) ||
      /^(EVENT_NAME|PR_BASE_SHA|CHANGED_FILE)$/i.test(key)
    ) {
      delete env[key];
    }
  }
  return env;
}

// ---------------------------------------------------------------------------
// 1. Pure decision
// ---------------------------------------------------------------------------

const DOCS_ONLY: ReadonlyArray<readonly [string, string]> = [
  ["docs markdown", "docs/PLAN.md"],
  ["docs png", "docs/img/flow.png"],
  ["nested docs markdown", "docs/a/b/c/deep.md"],
  ["root README", "README.md"],
  ["root SECURITY", "SECURITY.md"],
  ["root markdown with dots", "CHANGELOG.v2.md"],
  ["Chinese file name", "docs/使用說明.md"],
  ["Chinese root file name", "說明.md"],
  ["file name with spaces", "docs/My Notes.md"],
  ["directory name with spaces", "docs/with space/a.md"],
];

const HEAVY: ReadonlyArray<readonly [string, string]> = [
  ["src file", "src/lib/x.ts"],
  ["src markdown (nested .md is not docs)", "src/notes/x.md"],
  ["deeply nested src markdown", "src/a/b/c/x.md"],
  ["tests README", "tests/README.md"],
  ["scripts README", "scripts/ci/README.md"],
  ["workflow", ".github/workflows/ci.yml"],
  ["dependabot", ".github/dependabot.yml"],
  ["package.json", "package.json"],
  ["lockfile", "package-lock.json"],
  ["docs ts (only .md/.png count)", "docs/x.ts"],
  ["docs json", "docs/data.json"],
  ["docs svg", "docs/diagram.svg"],
  ["docs jpg", "docs/photo.jpg"],
  ["docs mdx", "docs/a.mdx"],
  ["docs double extension", "docs/a.md.ts"],
  ["root non-markdown", "vercel.json"],
  ["root dotfile", ".gitignore"],
  ["root LICENSE", "LICENSE"],
  ["directory that is only named like a file", "a.md/b.ts"],
  ["prefix lookalike", "docs-old/a.md"],
  ["capitalised docs dir", "Docs/a.md"],
  ["upper-case extension is not trusted", "README.MD"],
  ["upper-case png is not trusted", "docs/A.PNG"],
  ["bare .md dotfile", ".md"],
  ["bare docs/.md", "docs/.md"],
  ["Chinese file name outside docs", "src/中文.ts"],
  ["file name with spaces outside docs", "src/my file.ts"],
];

describe("isDocsOnlyPath", () => {
  it.each(DOCS_ONLY)("docs-only: %s (%s)", (_name, path) => {
    expect(isDocsOnlyPath(path)).toBe(true);
  });
  it.each(HEAVY)("heavy: %s (%s)", (_name, path) => {
    expect(isDocsOnlyPath(path)).toBe(false);
  });
});

describe("classify on pull_request", () => {
  const cases: ReadonlyArray<{
    name: string;
    paths: string[];
    heavy: boolean;
  }> = [
    { name: "docs only", paths: ["docs/PLAN.md"], heavy: false },
    {
      name: "docs and root markdown together",
      paths: ["docs/STATUS.md", "README.md", "docs/img/a.png"],
      heavy: false,
    },
    { name: "Chinese .md name", paths: ["docs/使用說明.md"], heavy: false },
    { name: "name with spaces", paths: ["docs/My Notes.md"], heavy: false },
    {
      name: "a deleted docs file is still docs",
      paths: ["docs/old.md"],
      heavy: false,
    },
    {
      name: "mixed docs and src",
      paths: ["docs/PLAN.md", "src/lib/x.ts"],
      heavy: true,
    },
    { name: "src only", paths: ["src/lib/x.ts"], heavy: true },
    {
      name: "one code file among many docs",
      paths: ["docs/a.md", "docs/b.md", "docs/c.md", "src/x.ts", "README.md"],
      heavy: true,
    },
    {
      name: ".github",
      paths: [".github/workflows/ci.yml"],
      heavy: true,
    },
    { name: "package.json", paths: ["package.json"], heavy: true },
    {
      name: "rename docs -> src (git --no-renames lists both sides)",
      paths: ["docs/a.md", "src/a.md"],
      heavy: true,
    },
    {
      name: "rename src -> docs (the deleted src path is listed)",
      paths: ["docs/x.md", "src/x.ts"],
      heavy: true,
    },
    {
      name: "a deleted code file",
      paths: ["src/legacy/old.ts"],
      heavy: true,
    },
    {
      name: "nested .md outside docs",
      paths: ["src/notes/x.md"],
      heavy: true,
    },
    { name: "a .ts file under docs", paths: ["docs/x.ts"], heavy: true },
    { name: "Chinese code file name", paths: ["src/中文.ts"], heavy: true },
    {
      name: "code file name with spaces",
      paths: ["src/my file.ts"],
      heavy: true,
    },
    { name: "empty input", paths: [], heavy: true },
  ];

  it.each(cases)("$name", ({ paths, heavy }) => {
    const result = classify({ event: "pull_request", paths });
    expect(result.heavy).toBe(heavy);
    // On a PR, e2e follows heavy: the whole gate, or nothing.
    expect(result.e2e).toBe(heavy);
    expect(result.reason).not.toBe("");
  });

  it("names the first non-docs path in the reason", () => {
    const result = classify({
      event: "pull_request",
      paths: ["docs/a.md", "src/b.ts", "src/c.ts"],
    });
    expect(result.reason).toContain("src/b.ts");
  });

  it("cannot tell (paths unavailable) -> full gate, with the reason passed through", () => {
    const result = classify({
      event: "pull_request",
      paths: null,
      problem: "could not fetch base abc",
    });
    expect(result).toEqual({
      heavy: true,
      e2e: true,
      reason: "could not fetch base abc",
    });
  });

  it("cannot tell and no reason given -> still the full gate", () => {
    const result = classify({ event: "pull_request", paths: null });
    expect(result.heavy).toBe(true);
    expect(result.e2e).toBe(true);
  });
});

describe("classify on other events", () => {
  const docsOnly = ["docs/PLAN.md", "README.md"];

  // A push run can be cancelled by the next push (cancel-in-progress), and the
  // run that survives only diffs `before..HEAD`. If push ever trusted the diff,
  // a docs-only commit landing right after a code commit would go green over
  // the unchecked code (this happened: 9420fd2 was cancelled, then 2a09b44
  // changed only STATUS). So push is heavy no matter what.
  it.each([
    ["docs-only paths", docsOnly],
    ["a single docs path", ["docs/STATUS.md"]],
    ["empty list", []],
    ["no list at all", null],
  ] as const)("push is always the light gate: %s", (_name, paths) => {
    const result = classify({ event: "push", paths });
    expect(result.heavy).toBe(true);
    expect(result.e2e).toBe(false);
  });

  it.each([
    ["docs-only paths", docsOnly],
    ["code paths", ["src/x.ts"]],
    ["empty list", []],
    ["no list at all", null],
  ] as const)("workflow_dispatch is always full with e2e: %s", (_n, paths) => {
    expect(classify({ event: "workflow_dispatch", paths })).toMatchObject({
      heavy: true,
      e2e: true,
    });
  });

  it.each(["", "schedule", "merge_group", "pull_request_target", "PUSH"])(
    "unrecognised event %j runs everything",
    (event) => {
      expect(classify({ event, paths: docsOnly })).toMatchObject({
        heavy: true,
        e2e: true,
      });
    },
  );
});

describe("readChangedPaths (git is injected)", () => {
  const SHA = "a".repeat(40);

  function recorder(impl: (args: string[]) => string = () => "") {
    const calls: string[][] = [];
    const run = (args: string[]) => {
      calls.push(args);
      return impl(args);
    };
    return { calls, run };
  }

  // The base comes from the event payload. Anything that is not a well-formed
  // commit SHA must never reach git (it could be read as an option), and the
  // problem must say so, so this cannot be confused with a fetch failure.
  it.each([
    ["an option", "--upload-pack=x"],
    ["an option with a SHA-looking tail", `--${SHA}`],
    ["40 characters that start with a dash", `-${"a".repeat(39)}`],
    ["short hex", "abc123"],
    ["39 hex digits", "a".repeat(39)],
    ["41 hex digits", "a".repeat(41)],
    ["a SHA and more", `${SHA} extra`],
    ["a SHA and a newline", `${SHA}\n`],
    ["a ref name", "refs/heads/main"],
    ["non-hex letters", "z".repeat(40)],
  ])("never hands a malformed base to git: %s", (_name, base) => {
    const { calls, run } = recorder();
    const result = readChangedPaths(base, "/nowhere", run);
    expect(calls).toEqual([]);
    expect(result.paths).toBeNull();
    expect("problem" in result && result.problem).toMatch(
      /not a commit SHA, so git was not called/,
    );
  });

  it.each([
    ["undefined", undefined, /no base commit/],
    ["empty", "", /no base commit/],
    ["all zeros", "0".repeat(40), /all-zero SHA/],
  ])("does not call git without a real base: %s", (_name, base, problem) => {
    const { calls, run } = recorder();
    const result = readChangedPaths(base, "/nowhere", run);
    expect(calls).toEqual([]);
    expect(result).toEqual({
      paths: null,
      problem: expect.stringMatching(problem),
    });
  });

  it.each([
    ["40 lower-case hex", SHA],
    ["40 upper-case hex", "ABCDEF0123".repeat(4)],
    ["64 hex (sha256 repository)", "b".repeat(64)],
  ])(
    "a well-formed base (%s) is fetched, then diffed, NUL-separated",
    (_name, base) => {
      const { calls, run } = recorder((args) =>
        args.includes("diff") ? "docs/使用 說明.md\0README.md\0" : "",
      );
      const result = readChangedPaths(base, "/repo", run);
      expect(calls).toEqual([
        ["fetch", "--no-tags", "--depth=1", "origin", base],
        [
          "-c",
          "core.quotePath=false",
          "diff",
          "--name-only",
          "-z",
          "--no-renames",
          base,
          "HEAD",
        ],
      ]);
      expect(result).toEqual({ paths: ["docs/使用 說明.md", "README.md"] });
    },
  );

  it("a fetch failure is reported as such and the diff is not attempted", () => {
    const { calls, run } = recorder(() => {
      throw new Error("boom");
    });
    const result = readChangedPaths(SHA, "/repo", run);
    expect(calls).toHaveLength(1);
    expect(result).toEqual({
      paths: null,
      problem: expect.stringMatching(/^could not fetch base /),
    });
  });

  it("a diff failure is reported as such", () => {
    const { run } = recorder((args) => {
      if (args.includes("diff")) throw new Error("boom");
      return "";
    });
    expect(readChangedPaths(SHA, "/repo", run)).toEqual({
      paths: null,
      problem: expect.stringMatching(/^could not diff against /),
    });
  });

  it("the three failure reasons are distinguishable", () => {
    const bad = readChangedPaths("--x", "/r", () => "");
    const fetch = readChangedPaths(SHA, "/r", () => {
      throw new Error("x");
    });
    const diff = readChangedPaths(SHA, "/r", (args) => {
      if (args.includes("diff")) throw new Error("x");
      return "";
    });
    const problems = [bad, fetch, diff].map((r) =>
      "problem" in r ? r.problem : "",
    );
    expect(new Set(problems).size).toBe(3);
  });
});

describe("parseNulList", () => {
  it("splits on NUL and drops the empty tail", () => {
    expect(parseNulList("a b.md\0docs/使用說明.md\0")).toEqual([
      "a b.md",
      "docs/使用說明.md",
    ]);
    expect(parseNulList("")).toEqual([]);
    expect(parseNulList("\0\0")).toEqual([]);
  });

  it("does not split on newlines (a name may contain one)", () => {
    expect(parseNulList("odd\nname.md\0")).toEqual(["odd\nname.md"]);
  });
});

/**
 * Removes a symlink or junction WITHOUT touching what it points to. A junction
 * to the repository's own scripts/ inside a directory that is later deleted
 * recursively is how a test deletes real files, so a link is always taken down
 * first: `rmdir` on Windows (it refuses to remove a real, non-empty directory,
 * and on a junction removes only the junction), `unlink` elsewhere.
 */
function removeLink(link: string): void {
  if (process.platform === "win32") {
    spawnSync("cmd.exe", ["/d", "/c", "rmdir", link.replace(/\//g, "\\")], {
      stdio: "ignore",
    });
  } else {
    try {
      unlinkSync(link);
    } catch {
      // already gone
    }
  }
}

// ---------------------------------------------------------------------------
// 2. classify-changes.mjs CLI against a real git repository
// ---------------------------------------------------------------------------

const SCRIPT = fileURLToPath(
  new URL("../../scripts/ci/classify-changes.mjs", import.meta.url),
);

type Ops = {
  write?: Record<string, string>;
  remove?: string[];
  move?: ReadonlyArray<readonly [string, string]>;
};

describe(
  "classify-changes.mjs CLI (real git repo)",
  { timeout: 60_000 },
  () => {
    let root: string;
    let repo: string;
    let outDir: string;
    let baseSha: string;
    let runCount = 0;

    function git(...args: string[]): string {
      return execFileSync("git", args, {
        cwd: repo,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    }

    function apply(ops: Ops) {
      for (const [path, body] of Object.entries(ops.write ?? {})) {
        const full = join(repo, path);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, body);
      }
      for (const path of ops.remove ?? []) rmSync(join(repo, path));
      for (const [from, to] of ops.move ?? []) {
        mkdirSync(dirname(join(repo, to)), { recursive: true });
        renameSync(join(repo, from), join(repo, to));
      }
    }

    /** A commit on top of the base commit; checks it out and returns its sha. */
    function commitOnBase(ops: Ops): string {
      git("checkout", "--quiet", "--detach", baseSha);
      apply(ops);
      git("add", "-A");
      git("commit", "--quiet", "--allow-empty", "-m", "change");
      return git("rev-parse", "HEAD");
    }

    function runCli(env: Record<string, string>, script = SCRIPT) {
      const dir = join(outDir, `run-${runCount++}`);
      mkdirSync(dir);
      const outputFile = join(dir, "github-output.txt");
      const summaryFile = join(dir, "summary.md");
      writeFileSync(outputFile, "");
      const result = spawnSync(process.execPath, [script], {
        cwd: repo,
        encoding: "utf8",
        env: {
          ...cleanEnv(),
          // Never touch a real runner's files when this test runs inside Actions.
          GITHUB_OUTPUT: outputFile,
          GITHUB_STEP_SUMMARY: summaryFile,
          RUNNER_TEMP: dir,
          EVENT_NAME: "",
          PR_BASE_SHA: "",
          ...env,
        },
      });
      const outputs = Object.fromEntries(
        readFileSync(outputFile, "utf8")
          .split("\n")
          .filter((line) => line.includes("="))
          .map((line) => [
            line.slice(0, line.indexOf("=")),
            line.slice(line.indexOf("=") + 1),
          ]),
      );
      const changedFile: string | undefined = outputs.changed_file;
      const changed =
        changedFile === undefined
          ? []
          : readFileSync(changedFile, "utf8")
              .split("\0")
              .filter((path) => path !== "");
      return {
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        outputs,
        changed,
        summary: readFileSync(summaryFile, "utf8"),
      };
    }

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "ci-classify-"));
      repo = join(root, "repo");
      outDir = join(root, "out");
      mkdirSync(repo);
      mkdirSync(outDir);
      git("init", "--quiet");
      git("config", "user.email", "ci-test@example.invalid");
      git("config", "user.name", "ci-test");
      git("config", "core.autocrlf", "false");
      git("config", "commit.gpgsign", "false");
      apply({
        write: {
          "README.md": "readme\n",
          "docs/a.md": "a\n",
          "docs/old.md": "old\n",
          "src/app.ts": "export {};\n",
          "src/legacy/old.ts": "export {};\n",
          "package.json": "{}\n",
        },
      });
      git("add", "-A");
      git("commit", "--quiet", "-m", "base");
      baseSha = git("rev-parse", "HEAD");
      // The action fetches the base from `origin`; here origin is the repo itself.
      git("remote", "add", "origin", repo);
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    const prCases: ReadonlyArray<{
      name: string;
      ops: Ops;
      heavy: boolean;
      changed: string[];
    }> = [
      {
        name: "docs only",
        ops: { write: { "docs/a.md": "a2\n", "README.md": "readme2\n" } },
        heavy: false,
        changed: ["README.md", "docs/a.md"],
      },
      {
        name: "docs png and root SECURITY.md added",
        ops: { write: { "docs/img/x.png": "png", "SECURITY.md": "s\n" } },
        heavy: false,
        changed: ["SECURITY.md", "docs/img/x.png"],
      },
      {
        name: "mixed docs and src",
        ops: {
          write: { "docs/a.md": "a2\n", "src/app.ts": "export const x = 1;\n" },
        },
        heavy: true,
        changed: ["docs/a.md", "src/app.ts"],
      },
      {
        name: "rename docs/a.md -> src/a.md",
        ops: { move: [["docs/a.md", "src/a.md"]] },
        heavy: true,
        changed: ["docs/a.md", "src/a.md"],
      },
      {
        name: "rename src/app.ts -> docs/app.md",
        ops: { move: [["src/app.ts", "docs/app.md"]] },
        heavy: true,
        changed: ["docs/app.md", "src/app.ts"],
      },
      {
        name: "delete a docs file only",
        ops: { remove: ["docs/old.md"] },
        heavy: false,
        changed: ["docs/old.md"],
      },
      {
        name: "delete a code file",
        ops: { remove: ["src/legacy/old.ts"] },
        heavy: true,
        changed: ["src/legacy/old.ts"],
      },
      {
        name: "Chinese .md file names (NUL-separated, never git-quoted)",
        ops: { write: { "docs/使用說明.md": "x\n", "說明.md": "y\n" } },
        heavy: false,
        changed: ["docs/使用說明.md", "說明.md"],
      },
      {
        name: "file names with spaces",
        ops: {
          write: { "docs/My Notes.md": "x\n", "docs/with space/a b.md": "y\n" },
        },
        heavy: false,
        changed: ["docs/My Notes.md", "docs/with space/a b.md"],
      },
      {
        name: "code file name with spaces and Chinese",
        ops: { write: { "src/我的 檔案.ts": "export {};\n" } },
        heavy: true,
        changed: ["src/我的 檔案.ts"],
      },
      {
        name: "nested .md outside docs",
        ops: { write: { "src/deep/dir/x.md": "x\n" } },
        heavy: true,
        changed: ["src/deep/dir/x.md"],
      },
      {
        name: "a .ts file under docs",
        ops: { write: { "docs/x.ts": "export {};\n" } },
        heavy: true,
        changed: ["docs/x.ts"],
      },
      {
        name: ".github change",
        ops: { write: { ".github/workflows/ci.yml": "name: CI\n" } },
        heavy: true,
        changed: [".github/workflows/ci.yml"],
      },
      {
        name: "package.json change",
        ops: { write: { "package.json": '{"name":"x"}\n' } },
        heavy: true,
        changed: ["package.json"],
      },
      {
        name: "empty diff (commit with no changes)",
        ops: {},
        heavy: true,
        changed: [],
      },
    ];

    it.each(prCases)("pull_request: $name", ({ ops, heavy, changed }) => {
      commitOnBase(ops);
      const run = runCli({ EVENT_NAME: "pull_request", PR_BASE_SHA: baseSha });
      expect(run.status).toBe(0);
      expect(run.outputs.heavy).toBe(String(heavy));
      expect(run.outputs.e2e).toBe(String(heavy));
      expect([...run.changed].sort()).toEqual([...changed].sort());
      expect(run.stdout).toContain(`heavy=${heavy}`);
      expect(run.summary).toContain(`full gate: **${heavy}**`);
    });

    it.each([
      ["missing", "", /no base commit/],
      ["all zeros", "0000000000000000000000000000000000000000", /all-zero SHA/],
      ["not a sha", "not-a-sha", /not a commit SHA, so git was not called/],
      [
        "looks like a git option",
        "--upload-pack=echo",
        /not a commit SHA, so git was not called/,
      ],
      [
        "well-formed but not in origin",
        "1111111111111111111111111111111111111111",
        /could not fetch base/,
      ],
    ])(
      "pull_request with an unusable base (%s) runs the full gate",
      (_name, base, reason) => {
        // A docs-only change: only the unusable base can make this heavy.
        commitOnBase({ write: { "docs/a.md": "a3\n" } });
        const run = runCli({ EVENT_NAME: "pull_request", PR_BASE_SHA: base });
        expect(run.status).toBe(0);
        expect(run.outputs.heavy).toBe("true");
        expect(run.outputs.e2e).toBe("true");
        // The reason tells a malformed base (never given to git) from a real
        // fetch failure.
        expect(run.stdout).toMatch(reason);
        if (!/could not fetch/.test(String(reason))) {
          expect(run.stdout).not.toMatch(/could not fetch/);
        }
      },
    );

    it("push never consults the diff: docs-only push is still the light gate", () => {
      commitOnBase({ write: { "docs/a.md": "a4\n" } });
      const run = runCli({ EVENT_NAME: "push", PR_BASE_SHA: baseSha });
      expect(run.status).toBe(0);
      expect(run.outputs.heavy).toBe("true");
      expect(run.outputs.e2e).toBe("false");
    });

    it("push does not need git at all", () => {
      // Run outside any repository: a push run must not depend on fetch or diff.
      const lonely = mkdtempSync(join(root, "no-git-"));
      const outputFile = join(lonely, "out.txt");
      writeFileSync(outputFile, "");
      const result = spawnSync(process.execPath, [SCRIPT], {
        cwd: lonely,
        encoding: "utf8",
        env: {
          ...cleanEnv(),
          GITHUB_OUTPUT: outputFile,
          GITHUB_STEP_SUMMARY: "",
          RUNNER_TEMP: lonely,
          EVENT_NAME: "push",
          PR_BASE_SHA: "",
        },
      });
      expect(result.status).toBe(0);
      expect(readFileSync(outputFile, "utf8")).toContain(
        "heavy=true\ne2e=false\n",
      );
    });

    it("workflow_dispatch is the full gate with e2e", () => {
      commitOnBase({ write: { "docs/a.md": "a5\n" } });
      const run = runCli({ EVENT_NAME: "workflow_dispatch" });
      expect(run.status).toBe(0);
      expect(run.outputs.heavy).toBe("true");
      expect(run.outputs.e2e).toBe("true");
    });

    it("an unknown event runs everything", () => {
      const run = runCli({ EVENT_NAME: "" });
      expect(run.status).toBe(0);
      expect(run.outputs.heavy).toBe("true");
      expect(run.outputs.e2e).toBe("true");
    });

    it("works without GITHUB_OUTPUT outside Actions (local run)", () => {
      commitOnBase({ write: { "docs/a.md": "a6\n" } });
      const result = spawnSync(process.execPath, [SCRIPT], {
        cwd: repo,
        encoding: "utf8",
        env: {
          ...cleanEnv(),
          EVENT_NAME: "pull_request",
          PR_BASE_SHA: baseSha,
          RUNNER_TEMP: join(outDir, "local"),
        },
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("heavy=false e2e=false");
    });

    // Fail closed. A classifier that exits 0 without publishing heavy/e2e turns
    // every gated step off and the job goes green over unchecked code.
    it("inside Actions, a missing GITHUB_OUTPUT is an error, not a silent pass", () => {
      const result = spawnSync(process.execPath, [SCRIPT], {
        cwd: repo,
        encoding: "utf8",
        env: {
          ...cleanEnv(),
          GITHUB_ACTIONS: "true",
          EVENT_NAME: "push",
          RUNNER_TEMP: join(outDir, "no-output"),
        },
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/GITHUB_OUTPUT/);
    });

    it("an unwritable GITHUB_OUTPUT is an error, not a silent pass", () => {
      const result = spawnSync(process.execPath, [SCRIPT], {
        cwd: repo,
        encoding: "utf8",
        env: {
          ...cleanEnv(),
          GITHUB_ACTIONS: "true",
          // A directory: appending to it fails.
          GITHUB_OUTPUT: outDir,
          EVENT_NAME: "push",
          RUNNER_TEMP: join(outDir, "unwritable"),
        },
      });
      expect(result.status).not.toBe(0);
    });

    // The old "am I the main module?" check compared argv[1] with the module's
    // real path; through a symlink or junction they differ, and the script did
    // nothing and exited 0.
    it("still publishes its outputs when started through a symlink or junction", () => {
      const link = join(root, "linked-scripts");
      symlinkSync(dirname(SCRIPT), link, "junction");
      try {
        commitOnBase({ write: { "src/app.ts": "export const y = 2;\n" } });
        const run = runCli(
          { EVENT_NAME: "pull_request", PR_BASE_SHA: baseSha },
          join(link, "classify-changes.mjs"),
        );
        expect(run.status).toBe(0);
        expect(run.outputs.heavy).toBe("true");
        expect(run.outputs.e2e).toBe("true");
        expect(run.changed).toEqual(["src/app.ts"]);
      } finally {
        // Before `root` is deleted recursively: see removeLink.
        removeLink(link);
      }
    });
  },
);

// ---------------------------------------------------------------------------
// 3. prettier-changed-docs.mjs: the only check a docs-only PR gets
// ---------------------------------------------------------------------------

const PRETTIER_SCRIPT = fileURLToPath(
  new URL("../../scripts/ci/prettier-changed-docs.mjs", import.meta.url),
);
const LOCAL_PRETTIER = fileURLToPath(
  new URL("../../node_modules/prettier/bin/prettier.cjs", import.meta.url),
);

describe("prettier-changed-docs", { timeout: 60_000 }, () => {
  const GOOD = "# 標題\n\n- 項目\n";
  const BAD = "#  Title\n\n*   item\n";
  let dir: string;
  let listCount = 0;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "ci-prettier-"));
    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ devDependencies: { prettier: "9.9.9" } }),
    );
    const files: Record<string, string> = {
      "README.md": GOOD,
      "docs/使用 說明.md": GOOD,
      "docs/My Notes.md": GOOD,
      "-dash name.md": GOOD,
      "docs/壞 格式.md": BAD,
    };
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(dir, name), body);
    }
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  let logs: string[];
  beforeEach(() => {
    logs = [];
    const keep = (...args: unknown[]) => void logs.push(args.join(" "));
    vi.spyOn(console, "log").mockImplementation(keep);
    vi.spyOn(console, "error").mockImplementation(keep);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A NUL-separated list file, the way classify-changes.mjs writes it. */
  function listFile(...names: string[]): string {
    const path = join(dir, `list-${listCount++}.bin`);
    writeFileSync(path, names.map((name) => `${name}\0`).join(""));
    return path;
  }

  function fakeRun(status = 0) {
    const calls: Invocation[] = [];
    const run = (invocation: Invocation) => {
      calls.push(invocation);
      return status;
    };
    return { calls, run };
  }

  /** The part of the argument list that starts at `--yes` (a Windows launcher may precede it). */
  const npxArgs = (invocation: Invocation) =>
    invocation.args.slice(invocation.args.indexOf("--yes"));

  it("passes names with spaces and Chinese characters as separate arguments", () => {
    const { calls, run } = fakeRun();
    const code = prettierMain(
      {
        CHANGED_FILE: listFile(
          "docs/使用 說明.md",
          "docs/My Notes.md",
          "README.md",
        ),
      },
      dir,
      run,
    );
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(npxArgs(calls[0])).toEqual([
      "--yes",
      "prettier@9.9.9",
      "--check",
      "--ignore-unknown",
      "docs/使用 說明.md",
      "docs/My Notes.md",
      "README.md",
    ]);
  });

  it("checks only the files that still exist", () => {
    const { calls, run } = fakeRun();
    const code = prettierMain(
      {
        CHANGED_FILE: listFile("docs/gone.md", "README.md", "docs/已刪 除.md"),
      },
      dir,
      run,
    );
    expect(code).toBe(0);
    expect(npxArgs(calls[0]).slice(4)).toEqual(["README.md"]);
  });

  it("only deletions: nothing to check, Prettier is not started, exit 0", () => {
    const { calls, run } = fakeRun();
    const code = prettierMain(
      { CHANGED_FILE: listFile("docs/gone.md", "docs/已刪 除.md") },
      dir,
      run,
    );
    expect(code).toBe(0);
    expect(calls).toEqual([]);
    expect(logs.join("\n")).toMatch(/Only deletions/);
  });

  it.each([
    ["a zero-byte list", ""],
    ["a list of bare NULs", "\0\0"],
  ])("%s: nothing to check, Prettier is not started, exit 0", (_name, body) => {
    const path = join(dir, `empty-${listCount++}.bin`);
    writeFileSync(path, body);
    const { calls, run } = fakeRun();
    expect(prettierMain({ CHANGED_FILE: path }, dir, run)).toBe(0);
    expect(calls).toEqual([]);
    expect(logs.join("\n")).toMatch(/No changed files listed/);
  });

  it("a directory in the list is not a file", () => {
    expect(existingFiles(["docs", "README.md", "nope.md"], dir)).toEqual([
      "README.md",
    ]);
  });

  it("names starting with a dash are passed as ./name so they cannot be read as options", () => {
    const { calls, run } = fakeRun();
    prettierMain({ CHANGED_FILE: listFile("-dash name.md") }, dir, run);
    expect(npxArgs(calls[0]).slice(4)).toEqual(["./-dash name.md"]);
  });

  it.each([0, 1, 2])(
    "Prettier's exit status %i is the script's exit status",
    (status) => {
      const { run } = fakeRun(status);
      expect(
        prettierMain({ CHANGED_FILE: listFile("README.md") }, dir, run),
      ).toBe(status);
    },
  );

  describe("fails closed", () => {
    it("when CHANGED_FILE is not set", () => {
      const { calls, run } = fakeRun();
      expect(prettierMain({}, dir, run)).toBe(1);
      expect(prettierMain({ CHANGED_FILE: "" }, dir, run)).toBe(1);
      expect(calls).toEqual([]);
      expect(logs.join("\n")).toMatch(/CHANGED_FILE/);
    });

    it("when the list cannot be read", () => {
      const { calls, run } = fakeRun();
      expect(
        prettierMain(
          { CHANGED_FILE: join(dir, "does-not-exist.bin") },
          dir,
          run,
        ),
      ).toBe(1);
      expect(calls).toEqual([]);
    });

    it("when package.json has no Prettier version", () => {
      const bare = mkdtempSync(join(dir, "bare-"));
      writeFileSync(join(bare, "README.md"), GOOD);
      const { calls, run } = fakeRun();
      const env = { CHANGED_FILE: listFile("README.md") };
      // no package.json at all
      expect(prettierMain(env, bare, run)).toBe(1);
      // package.json without devDependencies.prettier
      writeFileSync(join(bare, "package.json"), "{}");
      expect(prettierMain(env, bare, run)).toBe(1);
      expect(calls).toEqual([]);
    });
  });

  describe("with the real Prettier (this repo's node_modules, no network)", () => {
    let output = "";
    // Same arguments as the workflow, minus the npx launcher.
    const localPrettier = (invocation: Invocation, cwd: string) => {
      const args = invocation.args.slice(invocation.args.indexOf("--check"));
      const result = spawnSync(process.execPath, [LOCAL_PRETTIER, ...args], {
        cwd,
        encoding: "utf8",
      });
      output = `${result.stdout}${result.stderr}`;
      return result.status ?? 1;
    };

    it("well-formatted files (spaces, Chinese, leading dash) pass", () => {
      const code = prettierMain(
        {
          CHANGED_FILE: listFile(
            "README.md",
            "docs/使用 說明.md",
            "docs/My Notes.md",
            "-dash name.md",
            "docs/deleted.md",
          ),
        },
        dir,
        localPrettier,
      );
      expect(output).toMatch(/All matched files use Prettier code style/);
      expect(code).toBe(0);
    });

    it("a badly formatted file makes it exit 1, and Prettier names that file", () => {
      const code = prettierMain(
        { CHANGED_FILE: listFile("README.md", "docs/壞 格式.md") },
        dir,
        localPrettier,
      );
      expect(code).toBe(1);
      expect(output).toContain("壞 格式.md");
    });
  });

  describe("the real script", () => {
    function runScript(env: Record<string, string>) {
      return spawnSync(process.execPath, [PRETTIER_SCRIPT], {
        cwd: dir,
        encoding: "utf8",
        env: { ...cleanEnv(), ...env },
      });
    }

    it("exits 1 without a list (fail closed), naming CHANGED_FILE", () => {
      const result = runScript({});
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/CHANGED_FILE/);
    });

    it("exits 0 when the list has only deletions, without starting Prettier", () => {
      const result = runScript({ CHANGED_FILE: listFile("docs/gone.md") });
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/Only deletions/);
    });

    // classify-changes.mjs has this test; this entry point did not. An "am I
    // the main module?" guard (argv[1] against import.meta.url) compares a link
    // path with the real path, so through a symlink or junction the script
    // would do nothing and exit 0: a docs-only PR would get no Prettier check
    // and go green. So: through a link it must still fail closed without a
    // list, and still read the list when there is one.
    it("still does its job when started through a symlink or junction", () => {
      const link = join(dir, "linked-ci-scripts");
      symlinkSync(dirname(PRETTIER_SCRIPT), link, "junction");
      try {
        const viaLink = join(link, "prettier-changed-docs.mjs");
        const run = (env: Record<string, string>) =>
          spawnSync(process.execPath, [viaLink], {
            cwd: dir,
            encoding: "utf8",
            env: { ...cleanEnv(), ...env },
          });

        const withoutList = run({});
        expect(withoutList.status).toBe(1);
        expect(withoutList.stderr).toMatch(/CHANGED_FILE/);

        const onlyDeletions = run({ CHANGED_FILE: listFile("docs/gone.md") });
        expect(onlyDeletions.status).toBe(0);
        expect(onlyDeletions.stdout).toMatch(/Only deletions/);
      } finally {
        // Before `dir` is deleted recursively: see removeLink.
        removeLink(link);
      }
    });
  });

  // The default runner (`runInherit`, used when prettierMain is called without
  // an injected `run`) was never executed by any test: every other test here
  // hands prettierMain a fake `run`. These start the real script with a fake
  // `npx` in front of everything else, and check what the script does with
  // what the fake does.
  //
  // On Linux (CI) the script runs `npx` from PATH. On Windows it runs
  // `node <dir of node.exe>/node_modules/npm/bin/npx-cli.js`, so the script is
  // started with a copy of node.exe whose directory holds a fake npx-cli.js.
  describe("the default runner, with a fake npx", () => {
    const IS_WINDOWS = process.platform === "win32";
    const FAKE_NPX = [
      'const mode = process.env.FAKE_NPX_MODE || "exit:0";',
      'console.log("FAKE-NPX " + JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }));',
      'if (mode === "signal") process.kill(process.pid, "SIGKILL");',
      'process.exit(Number(mode.split(":")[1] ?? 0));',
      "",
    ].join("\n");

    let project: string;
    let emptyBin: string;
    let fakeBin: string;
    let scriptNode: string;
    let fakeCli: string;
    let list: string;

    beforeAll(() => {
      project = join(dir, "fake-npx-project");
      emptyBin = join(dir, "fake-npx-empty-bin");
      fakeBin = join(dir, "fake-npx-bin");
      for (const path of [project, emptyBin, fakeBin]) mkdirSync(path);
      writeFileSync(
        join(project, "package.json"),
        JSON.stringify({ devDependencies: { prettier: "9.9.9" } }),
      );
      writeFileSync(join(project, "README.md"), GOOD);
      list = join(dir, "fake-npx-list.bin");
      writeFileSync(list, "README.md\0");
      if (IS_WINDOWS) {
        const nodeDir = join(dir, "fake-npx-node");
        fakeCli = join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js");
        mkdirSync(dirname(fakeCli), { recursive: true });
        scriptNode = join(nodeDir, "node.exe");
        copyFileSync(process.execPath, scriptNode);
        writeFileSync(fakeCli, FAKE_NPX);
      } else {
        scriptNode = process.execPath;
        fakeCli = join(fakeBin, "npx");
        writeFileSync(fakeCli, `#!${process.execPath}\n${FAKE_NPX}`);
        chmodSync(fakeCli, 0o755);
      }
    });

    function run(mode: string, { withFake = true } = {}) {
      // One PATH only: on Windows the inherited key is "Path", and two spellings
      // of the same variable make the child's environment ambiguous.
      const env = cleanEnv();
      for (const key of Object.keys(env)) {
        if (/^path$/i.test(key)) delete env[key];
      }
      return spawnSync(scriptNode, [PRETTIER_SCRIPT], {
        cwd: project,
        encoding: "utf8",
        env: {
          ...env,
          // Fake first; the rest of PATH stays so nothing else breaks.
          PATH: withFake
            ? `${fakeBin}${delimiter}${process.env.PATH ?? ""}`
            : emptyBin,
          CHANGED_FILE: list,
          FAKE_NPX_MODE: mode,
        },
      });
    }

    const fakeCall = (stdout: string) =>
      JSON.parse(
        stdout
          .split("\n")
          .find((line) => line.startsWith("FAKE-NPX "))!
          .slice("FAKE-NPX ".length),
      ) as { cwd: string; args: string[] };

    it.each([0, 1, 2])(
      "npx's exit status %i is the script's exit status",
      (status) => {
        const result = run(`exit:${status}`);
        expect(result.status).toBe(status);
      },
    );

    it("passes npx the pinned Prettier, the file, and the project directory, with output inherited", () => {
      const result = run("exit:0");
      // stdout only shows up here if the child's stdio is inherited.
      expect(result.stdout).toContain("FAKE-NPX ");
      const call = fakeCall(result.stdout);
      expect(call.args).toEqual([
        "--yes",
        "prettier@9.9.9",
        "--check",
        "--ignore-unknown",
        "README.md",
      ]);
      expect(realpathSync.native(call.cwd)).toBe(realpathSync.native(project));
    });

    it("cannot start npx: exits 1 and says so, never 0", () => {
      // Windows: without the fake npx-cli.js the script falls back to `npx`,
      // which cannot be found on an empty PATH; elsewhere the fake is not on it.
      if (IS_WINDOWS) unlinkSync(fakeCli);
      try {
        const result = run("exit:0", { withFake: false });
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/could not run npx/);
        expect(result.stdout).not.toContain("FAKE-NPX");
      } finally {
        if (IS_WINDOWS) writeFileSync(fakeCli, FAKE_NPX);
      }
    });

    // A child killed by a signal has status null and no error. Windows has no
    // signals to send (a process that kills itself just exits 1), so this one
    // runs on Linux (CI); the same branch is pinned on every OS in
    // ci-prettier-runner.test.ts with spawnSync stubbed.
    it.skipIf(IS_WINDOWS)("npx killed by a signal: exits 1, never 0", () => {
      const result = run("signal");
      expect(result.status).toBe(1);
    });
  });

  describe("helpers", () => {
    it("prettierVersion reads devDependencies.prettier", () => {
      expect(prettierVersion('{"devDependencies":{"prettier":"3.9.8"}}')).toBe(
        "3.9.8",
      );
      for (const text of [
        "{}",
        '{"devDependencies":{}}',
        '{"dependencies":{"prettier":"3.9.8"}}',
        '{"devDependencies":{"prettier":""}}',
      ]) {
        expect(() => prettierVersion(text)).toThrow(
          /devDependencies\.prettier/,
        );
      }
    });

    it("the Linux invocation is npx with an argument array, no shell string", () => {
      expect(
        prettierInvocation({
          version: "3.9.8",
          files: ["docs/a b.md", "-x.md"],
          platform: "linux",
        }),
      ).toEqual({
        command: "npx",
        args: [
          "--yes",
          "prettier@3.9.8",
          "--check",
          "--ignore-unknown",
          "docs/a b.md",
          "./-x.md",
        ],
      });
    });

    it("on Windows node runs npm's npx-cli.js (npx.cmd cannot be spawned without a shell)", () => {
      const execPath = join("C:", "node", "node.exe");
      const invocation = prettierInvocation({
        version: "3.9.8",
        files: ["a.md"],
        platform: "win32",
        execPath,
        exists: () => true,
      });
      expect(invocation.command).toBe(execPath);
      expect(invocation.args[0]).toMatch(/npx-cli\.js$/);
      expect(invocation.args.slice(1, 3)).toEqual(["--yes", "prettier@3.9.8"]);
      const fallback = prettierInvocation({
        version: "3.9.8",
        files: ["a.md"],
        platform: "win32",
        execPath,
        exists: () => false,
      });
      expect(fallback.command).toBe("npx");
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Shape of .github/workflows/ci.yml
//
// Regex over the raw text on purpose: no yaml package (package.json must not
// change for this), and the file's layout is fixed at 2-space indentation.
// ---------------------------------------------------------------------------

describe(".github/workflows/ci.yml shape", () => {
  const raw = readFileSync(".github/workflows/ci.yml", "utf8");
  const lines = raw.split("\n");
  const code = lines.filter((line) => !/^\s*#/.test(line));

  const isBlank = (line: string) => line.trim() === "" || /^\s*#/.test(line);
  const indentOf = (line: string) => line.length - line.trimStart().length;

  /** Body of a `key:` line at `indent`, up to the next line at or below it. */
  function block(source: string[], key: string, indent: number): string[] {
    const header = new RegExp(`^ {${indent}}${key}:\\s*(#.*)?$`);
    const start = source.findIndex((line) => header.test(line));
    // Missing block -> empty, so the test that cares fails on its own assertion
    // instead of the whole describe dying while it is being collected.
    if (start < 0) return [];
    const body: string[] = [];
    for (const line of source.slice(start + 1)) {
      if (!isBlank(line) && indentOf(line) <= indent) break;
      body.push(line);
    }
    return body;
  }

  const unquote = (value: string) => value.trim().replace(/^["']|["']$/g, "");

  /** A list under `key:` at `indent`; flow (`[a, b]`) or block (`- a`) style. */
  function listOf(section: string[], key: string, indent: number): string[] {
    const header = new RegExp(`^ {${indent}}${key}:\\s*(.*?)\\s*$`);
    const at = section.findIndex((line) => header.test(line));
    if (at < 0) return [];
    const inline = (header.exec(section[at]) as RegExpExecArray)[1].replace(
      /\s+#.*$/,
      "",
    );
    if (inline.startsWith("[")) {
      return inline
        .slice(1, inline.lastIndexOf("]"))
        .split(",")
        .map(unquote)
        .filter(Boolean);
    }
    const items: string[] = [];
    for (const line of section.slice(at + 1)) {
      const item = /^\s*- (.+?)\s*$/.exec(line);
      if (item) items.push(unquote(item[1]));
      else if (!isBlank(line)) break;
    }
    return items;
  }

  const on = block(code, "on", 0);
  const jobsBlock = block(code, "jobs", 0);
  const checks = block(jobsBlock, "checks", 2);

  type Step = { text: string; ifExpr: string | undefined };
  const steps: Step[] = (() => {
    const body = block(checks, "steps", 4);
    const out: string[][] = [];
    for (const line of body) {
      if (/^ {6}- /.test(line)) out.push([line.replace(/^ {6}- /, "        ")]);
      else if (out.length > 0) out[out.length - 1].push(line);
    }
    return out.map((stepLines) => ({
      text: stepLines.join("\n"),
      ifExpr: /^ {8}if:\s*(.+?)\s*$/m.exec(stepLines.join("\n"))?.[1],
    }));
  })();
  const classifyAt = steps.findIndex((step) =>
    /^ {8}id: changes\s*$/m.test(step.text),
  );

  it("the job id is `checks` and it has no `name:` (that is the required-check name)", () => {
    const ids = jobsBlock
      .map((line) => /^ {2}([A-Za-z0-9_-]+):\s*(#.*)?$/.exec(line)?.[1])
      .filter((id): id is string => id !== undefined);
    expect(ids).toContain("checks");
    expect(checks.length).toBeGreaterThan(0);
    // A job-level `name:` would rename the check and break branch protection.
    expect(checks.some((line) => /^ {4}name:/.test(line))).toBe(false);
  });

  it("push triggers on main only", () => {
    const push = block(on, "push", 2);
    expect(listOf(push, "branches", 4)).toEqual(["main"]);
    expect(
      push.some((line) =>
        /^ {4}(tags|paths|paths-ignore|branches-ignore):/.test(line),
      ),
    ).toBe(false);
  });

  it("pull_request includes ready_for_review (draft PRs run once marked ready)", () => {
    const types = listOf(block(on, "pull_request", 2), "types", 4);
    expect(types).toContain("ready_for_review");
    expect(types).toEqual(
      expect.arrayContaining(["opened", "synchronize", "reopened"]),
    );
  });

  it("workflow_dispatch is enabled", () => {
    expect(on.some((line) => /^ {2}workflow_dispatch:/.test(line))).toBe(true);
  });

  it("no workflow-level paths filter (a required check would sit on Pending)", () => {
    expect(on.some((line) => /^ {4}(paths|paths-ignore):/.test(line))).toBe(
      false,
    );
  });

  it("draft PRs skip the job", () => {
    const ifLine = checks.find((line) => /^ {4}if:/.test(line));
    expect(ifLine).toMatch(/github\.event\.pull_request\.draft == false/);
  });

  // The test above only looks for the `draft == false` part. A job `if:` that
  // began `github.event_name == 'pull_request' && ...` would still contain it
  // and would silently stop the job on every push and manual run. So the whole
  // expression is pinned: false only for a draft pull request, true otherwise.
  it("the job's `if:` is exactly the draft rule (push and workflow_dispatch must still run)", () => {
    const ifLines = checks.filter((line) => /^ {4}if:/.test(line));
    expect(ifLines).toEqual([
      "    if: github.event_name != 'pull_request' || github.event.pull_request.draft == false",
    ]);
  });

  // Any step or the job with `continue-on-error: true` turns a red lint,
  // Prettier, test or build green. The file has no need for it, so it must not
  // appear at all (a comment mentioning it would be a reason to look, too).
  it("nothing in the workflow uses continue-on-error", () => {
    expect(raw).not.toMatch(/continue-on-error/i);
  });

  // The drift check is the last line of a three-line script. Dropping it,
  // inverting `test -z`, or pointing it elsewhere keeps every other test here
  // green, so the exact script is pinned.
  it("the migration step runs db:check, db:generate, then fails if drizzle/ changed", () => {
    const step = steps.find((candidate) =>
      /^ {10}npm run db:check\s*$/m.test(candidate.text),
    );
    expect(step).toBeDefined();
    const stepLines = (step as Step).text.split("\n");
    const runAt = stepLines.findIndex((line) => /^ {8}run: \|\s*$/.test(line));
    expect(runAt).toBeGreaterThanOrEqual(0);
    const script = stepLines
      .slice(runAt + 1)
      .filter((line) => line.trim() !== "");
    expect(script).toEqual([
      "          npm run db:check",
      "          npm run db:generate",
      '          test -z "$(git status --porcelain -- drizzle)"',
    ]);
  });

  it("push never diffs: the workflow does not hand the classifier a `before` sha", () => {
    expect(code.join("\n")).not.toMatch(/github\.event\.before/);
    expect(code.join("\n")).not.toMatch(/PUSH_BEFORE/);
  });

  it("the classifier is the step right after checkout and runs the script", () => {
    expect(classifyAt).toBeGreaterThan(0);
    // Nothing but checkout may run before the classifier: anything else would
    // run on every event, docs-only included.
    const before = steps.slice(0, classifyAt);
    expect(before).toHaveLength(1);
    expect(before[0].text).toMatch(/uses: actions\/checkout@/);
    expect(steps[classifyAt].text).toMatch(
      /^ {8}run: node scripts\/ci\/classify-changes\.mjs\s*$/m,
    );
  });

  it("hands the classifier the event name and the PR base sha from the payload", () => {
    const text = steps[classifyAt].text;
    expect(text).toMatch(
      /^ {10}EVENT_NAME: \$\{\{ github\.event_name \}\}\s*$/m,
    );
    expect(text).toMatch(
      /^ {10}PR_BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}\s*$/m,
    );
  });

  // The explicit map from command to gate. Each command is in exactly one step,
  // and its `if:` is exactly this text. A push runs the `heavy` rows only: it
  // must not touch Playwright at all (no version lookup, cache or apt install).
  const HEAVY = "steps.changes.outputs.heavy == 'true'";
  const E2E = "steps.changes.outputs.e2e == 'true'";
  const GATES: ReadonlyArray<{ command: string; match: RegExp; gate: string }> =
    [
      // Light gate: pull_request, workflow_dispatch and push to main.
      {
        command: "actions/setup-node",
        match: /^ {8}uses: actions\/setup-node@/m,
        gate: HEAVY,
      },
      { command: "npm ci", match: /^ {8}run: npm ci\s*$/m, gate: HEAVY },
      {
        command: "npm run typecheck",
        match: /^ {8}run: npm run typecheck\s*$/m,
        gate: HEAVY,
      },
      {
        command: "npm run lint",
        match: /^ {8}run: npm run lint\s*$/m,
        gate: HEAVY,
      },
      {
        command: "npm run format:check",
        match: /^ {8}run: npm run format:check\s*$/m,
        gate: HEAVY,
      },
      {
        command: "npm run test",
        match: /^ {8}run: npm run test\s*$/m,
        gate: HEAVY,
      },
      {
        command: "npm run db:check",
        match: /^ {10}npm run db:check\s*$/m,
        gate: HEAVY,
      },
      {
        command: "npm run db:generate",
        match: /^ {10}npm run db:generate\s*$/m,
        gate: HEAVY,
      },
      {
        command: "npm audit --omit=dev",
        match: /^ {8}run: npm audit --omit=dev\s*$/m,
        gate: HEAVY,
      },
      {
        command: "npm run vercel-build",
        match: /^ {8}run: npm run vercel-build\s*$/m,
        gate: HEAVY,
      },
      // Playwright and everything it needs: pull_request and workflow_dispatch only.
      {
        command: "read the locked Playwright version",
        match: /^ {8}id: playwright\s*$/m,
        gate: E2E,
      },
      {
        command: "actions/cache (Playwright browsers)",
        match: /^ {8}uses: actions\/cache@/m,
        gate: E2E,
      },
      {
        command: "npx playwright install --with-deps",
        match: /^ {8}run: npx playwright install --with-deps\b/m,
        gate: `${E2E} && steps.playwright-cache.outputs.cache-hit != 'true'`,
      },
      {
        command: "npx playwright install-deps",
        match: /^ {8}run: npx playwright install-deps\b/m,
        gate: `${E2E} && steps.playwright-cache.outputs.cache-hit == 'true'`,
      },
      {
        command: "npm run test:e2e",
        match: /^ {8}run: npm run test:e2e\s*$/m,
        gate: E2E,
      },
      {
        command: "actions/upload-artifact",
        match: /^ {8}uses: actions\/upload-artifact@/m,
        gate: `failure() && ${E2E}`,
      },
      // Docs-only pull requests: the one step that runs when heavy is not true.
      {
        command: "node scripts/ci/prettier-changed-docs.mjs",
        match: /^ {8}run: node scripts\/ci\/prettier-changed-docs\.mjs\s*$/m,
        gate: "steps.changes.outputs.heavy != 'true'",
      },
    ];

  it.each(GATES)(
    "$command is in exactly one step, after the classifier",
    ({ match }) => {
      const at = steps
        .map((step, index) => (match.test(step.text) ? index : -1))
        .filter((index) => index >= 0);
      expect(at).toHaveLength(1);
      expect(at[0]).toBeGreaterThan(classifyAt);
    },
  );

  it.each(GATES)("$command runs only when: $gate", ({ match, gate }) => {
    const step = steps.find((candidate) => match.test(candidate.text));
    expect(step).toBeDefined();
    expect(step?.ifExpr).toBe(gate);
  });

  it("every step after the classifier is in the table (a new step needs a row)", () => {
    const uncovered = steps
      .slice(classifyAt + 1)
      .filter((step) => !GATES.some((row) => row.match.test(step.text)))
      .map((step) => step.text);
    expect(uncovered).toEqual([]);
  });

  it("the docs-only Prettier step reads the classifier's changed-file list", () => {
    const step = steps.find((candidate) =>
      /prettier-changed-docs\.mjs/.test(candidate.text),
    );
    expect(step?.text).toMatch(
      /^ {10}CHANGED_FILE: \$\{\{ steps\.changes\.outputs\.changed_file \}\}\s*$/m,
    );
  });

  it("the docs-only Prettier step is the only one that runs when heavy is false", () => {
    const docs = steps.filter((step) =>
      step.ifExpr?.includes("heavy != 'true'"),
    );
    expect(docs).toHaveLength(1);
  });
});
