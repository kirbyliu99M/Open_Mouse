import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  classify,
  isDocsOnlyPath,
} from "../../scripts/ci/classify-changes.mjs";

/**
 * G1 (CI budget). The first step of .github/workflows/ci.yml decides whether a
 * run skips the gate. A wrong answer there turns a red change green, and the
 * workflow file itself is not otherwise tested, so this file pins:
 *
 *   1. the pure decision (`classify`, `isDocsOnlyPath`),
 *   2. the CLI against a real git repository (NUL-separated names, renames,
 *      deletions, and every "cannot tell, so run everything" path),
 *   3. the shape of ci.yml (job id `checks`, triggers, and that every step
 *      after the classifier is gated on its outputs).
 */

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

// ---------------------------------------------------------------------------
// 2. CLI against a real git repository
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

    function runCli(env: Record<string, string>) {
      const dir = join(outDir, `run-${runCount++}`);
      mkdirSync(dir);
      const outputFile = join(dir, "github-output.txt");
      const summaryFile = join(dir, "summary.md");
      writeFileSync(outputFile, "");
      const result = spawnSync(process.execPath, [SCRIPT], {
        cwd: repo,
        encoding: "utf8",
        env: {
          ...process.env,
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
      ["missing", ""],
      ["all zeros", "0000000000000000000000000000000000000000"],
      ["not a sha", "not-a-sha"],
      ["looks like a git option", "--upload-pack=echo"],
      [
        "well-formed but not in origin",
        "1111111111111111111111111111111111111111",
      ],
    ])(
      "pull_request with an unusable base (%s) runs the full gate",
      (_name, base) => {
        // A docs-only change: only the unusable base can make this heavy.
        commitOnBase({ write: { "docs/a.md": "a3\n" } });
        const run = runCli({ EVENT_NAME: "pull_request", PR_BASE_SHA: base });
        expect(run.status).toBe(0);
        expect(run.outputs.heavy).toBe("true");
        expect(run.outputs.e2e).toBe("true");
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
          ...process.env,
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

    it("works without GITHUB_OUTPUT (local run)", () => {
      commitOnBase({ write: { "docs/a.md": "a6\n" } });
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        EVENT_NAME: "pull_request",
        PR_BASE_SHA: baseSha,
        RUNNER_TEMP: join(outDir, "local"),
      };
      delete env.GITHUB_OUTPUT;
      delete env.GITHUB_STEP_SUMMARY;
      const result = spawnSync(process.execPath, [SCRIPT], {
        cwd: repo,
        encoding: "utf8",
        env,
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("heavy=false e2e=false");
    });
  },
);

// ---------------------------------------------------------------------------
// 3. Shape of .github/workflows/ci.yml
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
    expect(steps[classifyAt].text).toMatch(
      /EVENT_NAME: \$\{\{ github\.event_name \}\}/,
    );
  });

  it("every step after the classifier is gated on steps.changes.outputs", () => {
    const after = steps.slice(classifyAt + 1);
    expect(after.length).toBeGreaterThan(5);
    for (const step of after) {
      expect(step.ifExpr, `step without an if:\n${step.text}`).toBeDefined();
      expect(step.ifExpr).toMatch(/steps\.changes\.outputs\.(heavy|e2e)/);
    }
  });

  it("the heavy commands require heavy == 'true' and e2e requires e2e == 'true'", () => {
    const after = steps.slice(classifyAt + 1);
    const heavyCommand =
      /\b(npm ci|npm run|npm audit|npx playwright|actions\/setup-node@|actions\/cache@)/;
    const heavySteps = after.filter((step) => heavyCommand.test(step.text));
    expect(heavySteps.length).toBeGreaterThan(8);
    for (const step of heavySteps) {
      expect(step.ifExpr, step.text).toMatch(
        /steps\.changes\.outputs\.(heavy|e2e) == 'true'/,
      );
      expect(step.ifExpr, step.text).not.toMatch(
        /steps\.changes\.outputs\.\w+ != /,
      );
    }
    const e2e = after.filter((step) => /npm run test:e2e/.test(step.text));
    expect(e2e).toHaveLength(1);
    expect(e2e[0].ifExpr).toMatch(/steps\.changes\.outputs\.e2e == 'true'/);
  });

  it("only the docs-only Prettier step runs when heavy is false", () => {
    const after = steps.slice(classifyAt + 1);
    const docsSteps = after.filter((step) =>
      step.ifExpr?.includes("heavy != 'true'"),
    );
    expect(docsSteps).toHaveLength(1);
    expect(docsSteps[0].text).toMatch(/prettier/);
  });
});
