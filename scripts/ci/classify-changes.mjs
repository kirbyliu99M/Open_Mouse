// Decides how much of the CI gate a run needs. Called by the first step of
// .github/workflows/ci.yml, BEFORE setup-node and `npm ci`, so it is plain Node
// with no dependencies: the node that is preinstalled on the runner runs it, and
// a docs-only PR never installs anything for it.
//
// Outputs (written to $GITHUB_OUTPUT):
//   heavy         "true" -> run the gate (install, typecheck, lint, tests, build)
//   e2e           "true" -> also run Playwright
//   changed_file  NUL-separated list of changed paths (pull_request only)
//
// The decision itself is the pure function `classify`; tests/unit/ci-classify.test.ts
// pins it, and the CLI around it, so a change here cannot quietly skip the gate.
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
//
// "Docs only" is deliberately narrow. Only these paths count:
//   - docs/**/*.md and docs/**/*.png
//   - *.md in the repository root (README.md, SECURITY.md, ...)
// Every other path is heavy: src/**/x.md, docs/x.ts, .github/**, package.json...

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

function git(args, cwd) {
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
 * `-z` reads NUL-separated names, so spaces, non-ASCII names and quoting cannot
 * corrupt the list; `core.quotePath=false` is belt and braces. `--no-renames`
 * lists a rename as a delete plus an add, so a file moved OUT of docs/ still
 * shows its new, non-docs path.
 *
 * @param {string | undefined} base
 * @param {string} [cwd]
 * @returns {{ paths: string[] } | { paths: null, problem: string }}
 */
export function readChangedPaths(base, cwd = process.cwd()) {
  if (!base) {
    return { paths: null, problem: "no base commit to compare against" };
  }
  if (ALL_ZERO_PATTERN.test(base)) {
    return { paths: null, problem: "base is the all-zero SHA" };
  }
  if (!SHA_PATTERN.test(base)) {
    return { paths: null, problem: `base is not a commit SHA: ${base}` };
  }
  try {
    // Shallow checkout: fetch only the base commit. A PR checkout is the merge
    // commit, so base..HEAD is exactly what the PR changes.
    git(["fetch", "--no-tags", "--depth=1", "origin", base], cwd);
  } catch {
    return { paths: null, problem: `could not fetch base ${base}` };
  }
  try {
    const out = git(
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
    return { paths: out.split("\0").filter((path) => path !== "") };
  } catch {
    return { paths: null, problem: `could not diff against ${base}` };
  }
}

/**
 * CLI body: read the environment, classify, publish the outputs.
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [cwd]
 */
export function main(env = process.env, cwd = process.cwd()) {
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

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) main();
