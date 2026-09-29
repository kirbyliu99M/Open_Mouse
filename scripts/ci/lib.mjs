// Logic behind the two CI helper scripts, kept in one module so the tests can
// import it. The scripts themselves (classify-changes.mjs, prettier-changed-docs.mjs)
// are three-line entry points that ALWAYS call `main`: there is deliberately no
// "am I the main module?" check, because a check that guesses wrong (a symlink or
// junction in the path did exactly that) makes a script exit 0 having done
// nothing, and a classifier that writes no outputs turns every gated step off.
//
// Everything here is plain Node with no dependencies. It runs on the node that is
// preinstalled on the runner, before `setup-node` and `npm ci`, so a docs-only PR
// never installs anything.
//
// ---------------------------------------------------------------------------
// classify-changes.mjs: how much of the CI gate does this run need?
//
// Outputs (written to $GITHUB_OUTPUT):
//   heavy         "true" -> run the gate (install, typecheck, lint, tests, build)
//   e2e           "true" -> also run Playwright (and everything it needs)
//   changed_file  NUL-separated list of changed paths (pull_request only)
//
// The decision itself is the pure function `classify`; tests/unit/ci-classify.test.ts
// pins it, the CLI around it, and the shape of ci.yml, so a change here cannot
// quietly skip the gate.
//
// Rules:
//   - push (main)          always heavy, never e2e. Never looks at the diff: a
//                          push run can be cancelled by the next push (the
//                          workflow uses cancel-in-progress), and a `before..HEAD`
//                          diff would then only see the last commit, so a
//                          docs-only commit could turn a code commit green.
//   - workflow_dispatch    always heavy, with e2e.
//   - pull_request         docs-only PRs skip the gate; anything else is heavy
//                          with e2e.
//   - anything we cannot classify (no base, bad SHA, fetch or diff failure,
//     empty diff, unknown event) runs the full gate.
//   - no way to publish the result (GITHUB_OUTPUT unset inside Actions, or not
//     writable) is an error: the script exits non-zero, it never exits 0 silently.
//
// "Docs only" is deliberately narrow. Only these paths count:
//   - docs/**/*.md and docs/**/*.png
//   - *.md in the repository root (README.md, SECURITY.md, ...)
// Every other path is heavy: src/**/x.md, docs/x.ts, .github/**, package.json...
//
// ---------------------------------------------------------------------------
// prettier-changed-docs.mjs: the only check a docs-only PR gets.
//
// Prettier also checks Markdown, so skipping it entirely would let a badly
// formatted .md merge and then fail `format:check` on the next code PR. This runs
// Prettier alone (no `npm ci`), at the version pinned in package.json, on just the
// changed files that still exist.

import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const SHA_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i;
const ALL_ZERO_PATTERN = /^0+$/;
const ROOT_MARKDOWN = /^[^/]+\.md$/;
const DOCS_MARKDOWN_OR_PNG = /^docs\/.+\.(?:md|png)$/;

/** True when a repo-relative path (forward slashes) is documentation only. */
export function isDocsOnlyPath(path) {
  return ROOT_MARKDOWN.test(path) || DOCS_MARKDOWN_OR_PNG.test(path);
}

/**
 * Pure decision.
 *
 * @param {{ event: string, paths: readonly string[] | null, problem?: string }} input
 *   `paths` is the changed-path list, or null when it could not be obtained
 *   (`problem` then says why). Only `pull_request` looks at it.
 * @returns {{ heavy: boolean, e2e: boolean, reason: string }}
 */
export function classify({ event, paths, problem }) {
  if (event === "push") {
    return {
      heavy: true,
      e2e: false,
      reason: "push: always the full light gate (the diff is never consulted)",
    };
  }
  if (event === "workflow_dispatch") {
    return { heavy: true, e2e: true, reason: "manual run: full gate with e2e" };
  }
  if (event !== "pull_request") {
    return {
      heavy: true,
      e2e: true,
      reason: `unrecognised event "${event}": full gate`,
    };
  }
  if (paths === null || paths === undefined) {
    return {
      heavy: true,
      e2e: true,
      reason: problem ?? "could not determine the changed paths",
    };
  }
  if (paths.length === 0) {
    return { heavy: true, e2e: true, reason: "empty diff" };
  }
  const other = paths.find((path) => !isDocsOnlyPath(path));
  if (other !== undefined) {
    return { heavy: true, e2e: true, reason: `non-docs change: ${other}` };
  }
  return {
    heavy: false,
    e2e: false,
    reason: "only docs/**/*.md, docs/**/*.png and root *.md changed",
  };
}

/** Runs `git <args>` in `cwd` and returns stdout; throws when git fails. */
function runGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Changed paths between `base` and HEAD, or `{ paths: null, problem }` when that
 * cannot be established. Never throws.
 *
 * A `base` that is not a well-formed commit SHA is never handed to git (it could
 * be read as an option), and its `problem` says so, which differs from a fetch
 * failure: the tests use that to prove git was not called.
 *
 * `-z` reads NUL-separated names, so spaces, non-ASCII names and quoting cannot
 * corrupt the list; `core.quotePath=false` is belt and braces. `--no-renames`
 * lists a rename as a delete plus an add, so a file moved OUT of docs/ still
 * shows its new, non-docs path.
 *
 * @param {string | undefined} base
 * @param {string} [cwd]
 * @param {(args: string[], cwd: string) => string} [run] injectable for tests
 * @returns {{ paths: string[] } | { paths: null, problem: string }}
 */
export function readChangedPaths(base, cwd = process.cwd(), run = runGit) {
  if (!base) {
    return { paths: null, problem: "no base commit to compare against" };
  }
  if (ALL_ZERO_PATTERN.test(base)) {
    return { paths: null, problem: "base is the all-zero SHA" };
  }
  if (!SHA_PATTERN.test(base)) {
    return {
      paths: null,
      problem: `base is not a commit SHA, so git was not called: ${JSON.stringify(base)}`,
    };
  }
  try {
    // Shallow checkout: fetch only the base commit. A PR checkout is the merge
    // commit, so base..HEAD is exactly what the PR changes.
    run(["fetch", "--no-tags", "--depth=1", "origin", base], cwd);
  } catch {
    return { paths: null, problem: `could not fetch base ${base}` };
  }
  try {
    const out = run(
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
      cwd,
    );
    return { paths: parseNulList(out) };
  } catch {
    return { paths: null, problem: `could not diff against ${base}` };
  }
}

/** Splits a NUL-separated list; empty items (the trailing NUL) are dropped. */
export function parseNulList(text) {
  return text.split("\0").filter((item) => item !== "");
}

/**
 * classify-changes.mjs body: read the environment, classify, publish the
 * outputs. Throws (so the process exits non-zero) when the result cannot be
 * published.
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [cwd]
 */
export function classifyMain(env = process.env, cwd = process.cwd()) {
  if (env.GITHUB_ACTIONS === "true" && !env.GITHUB_OUTPUT) {
    // No outputs means every gated step is skipped and the job goes green.
    throw new Error("GITHUB_OUTPUT is not set inside GitHub Actions");
  }
  const event = env.EVENT_NAME ?? "";
  let paths = null;
  let problem;
  if (event === "pull_request") {
    ({ paths, problem } = readChangedPaths(env.PR_BASE_SHA, cwd));
  }
  const result = classify({ event, paths, problem });

  const dir = env.RUNNER_TEMP || tmpdir();
  mkdirSync(dir, { recursive: true });
  const changedFile = join(dir, "changed-files.txt");
  writeFileSync(changedFile, (paths ?? []).map((p) => `${p}\0`).join(""));

  if (env.GITHUB_OUTPUT) {
    appendFileSync(
      env.GITHUB_OUTPUT,
      `heavy=${result.heavy}\ne2e=${result.e2e}\nchanged_file=${changedFile}\n`,
    );
  }
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      [
        "### Changed paths",
        `- event: \`${event}\``,
        `- full gate: **${result.heavy}** (${result.reason})`,
        `- e2e: **${result.e2e}**`,
        `- files: ${paths === null ? "n/a" : paths.length}`,
        "",
      ].join("\n"),
    );
  }
  console.log(`heavy=${result.heavy} e2e=${result.e2e} (${result.reason})`);
  return result;
}

// ---------------------------------------------------------------------------
// prettier-changed-docs.mjs

/** The listed paths that still exist as files (deleted ones are skipped). */
export function existingFiles(paths, cwd = process.cwd()) {
  return paths.filter((path) => {
    try {
      return statSync(join(cwd, path)).isFile();
    } catch {
      return false;
    }
  });
}

/** `devDependencies.prettier` from the text of a package.json; throws if absent. */
export function prettierVersion(packageJsonText) {
  const version = JSON.parse(packageJsonText)?.devDependencies?.prettier;
  if (typeof version !== "string" || version === "") {
    throw new Error("package.json has no devDependencies.prettier");
  }
  return version;
}

/**
 * The command that checks `files` with the pinned Prettier. An argument array,
 * never a shell string, so spaces, non-ASCII names and quotes are safe. A name
 * starting with "-" gets "./" so Prettier cannot read it as an option.
 *
 * On Windows `npx` is a .cmd shim that cannot be spawned without a shell, so
 * npm's own npx-cli.js (next to node.exe) is run by node instead. CI uses the
 * Linux branch.
 *
 * @param {{ version: string, files: string[], platform?: string, execPath?: string, exists?: (p: string) => boolean }} input
 * @returns {{ command: string, args: string[] }}
 */
export function prettierInvocation({
  version,
  files,
  platform = process.platform,
  execPath = process.execPath,
  exists = existsSync,
}) {
  const args = [
    "--yes",
    `prettier@${version}`,
    "--check",
    "--ignore-unknown",
    ...files.map((file) => (file.startsWith("-") ? `./${file}` : file)),
  ];
  if (platform === "win32") {
    const cli = join(
      dirname(execPath),
      "node_modules",
      "npm",
      "bin",
      "npx-cli.js",
    );
    if (exists(cli)) return { command: execPath, args: [cli, ...args] };
  }
  return { command: "npx", args };
}

/** Runs the command with inherited stdio; returns its exit code (1 on failure to start). */
function runInherit({ command, args }, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) {
    console.error(`could not run ${command}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

/**
 * prettier-changed-docs.mjs body. Returns the exit code.
 *
 * Fails closed: an unreadable list, an unreadable package.json or a Prettier
 * that cannot start is exit 1, never a silent pass. Nothing to check (no listed
 * paths, or only deletions) is exit 0.
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [cwd]
 * @param {(invocation: { command: string, args: string[] }, cwd: string) => number} [run]
 */
export function prettierMain(
  env = process.env,
  cwd = process.cwd(),
  run = runInherit,
) {
  const listFile = env.CHANGED_FILE;
  if (!listFile) {
    console.error("CHANGED_FILE is not set: no list of changed files to check");
    return 1;
  }
  let listed;
  try {
    listed = parseNulList(readFileSync(listFile, "utf8"));
  } catch (error) {
    console.error(`cannot read ${listFile}: ${error.message}`);
    return 1;
  }
  const files = existingFiles(listed, cwd);
  if (files.length === 0) {
    console.log(
      listed.length === 0
        ? "No changed files listed; nothing to format-check."
        : "Only deletions; nothing to format-check.",
    );
    return 0;
  }
  let version;
  try {
    version = prettierVersion(readFileSync(join(cwd, "package.json"), "utf8"));
  } catch (error) {
    console.error(`cannot determine the Prettier version: ${error.message}`);
    return 1;
  }
  return run(prettierInvocation({ version, files }), cwd);
}
