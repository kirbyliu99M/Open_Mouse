/**
 * M2 evaluator: how accurate and repeatable is a hand-measurement model,
 * judged only from the v2 run logs that `npm run learn:sort` wrote and the
 * `truth.json` files of the participants. It never opens a photo.
 *
 *   npm run m2:evaluate -- \
 *     --log ../Fixtures/learning/runs \
 *     --truth ../Fixtures/learning \
 *     --out ../Fixtures/evaluations/baseline.json
 *
 * --log <file|folder>     a run log, or a folder of them (*.json); repeat freely
 * --truth <file|folder>   a truth.json, or a folder holding <participant>/truth.json
 * --path markers|paper-edge|both     which calibration plane to judge (default both)
 * --gesture G01[,G02...]  poses to judge (default G01, the pose the M2 gate is defined on)
 * --participants P001,P002   only these participants (a fold, or the held-out set)
 * --thresholds <file>     JSON limits, e.g. {"accuracyMm":{"handLengthMm":2}}; default: the candidates
 * --out <file>            write the JSON report here (never overwritten; never inside the repo
 *                         or any worktree). The Markdown summary always goes to stdout.
 *
 * The command line is checked strictly (src/lib/m2/cli.ts): an unknown or
 * misspelt flag, a flag without a value, a single-value flag given twice or a
 * malformed list is an error and exits 1. Nothing falls back to a default.
 *
 * NEVER runs in CI: run logs hold hand landmarks of real people. The report
 * holds totals, anonymous participant codes and photo ids like "P007/G01R/3",
 * and no path, account name, EXIF or landmark. Neither does anything printed:
 * every failure, including a file system error, goes through the same
 * redaction as `learn:sort` (message only, never a stack; the paths given on
 * the command line shown relative; the account name as "~"), and the file name
 * given to --out is not repeated.
 *
 * The held-out participants are evaluated ONCE, by Claude, on the frozen
 * model: not from a workflow, and not again after looking at the result
 * (docs/learning/README.md, "Evaluation").
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { outputInsideRepo } from "../src/lib/learning/paths";
import { parseM2Args } from "../src/lib/m2/cli";
import {
  ALL_PATHS,
  evaluateJson,
  type EvalPath,
  type EvaluateOptions,
} from "../src/lib/m2/evaluate";
import { EvaluationInputError } from "../src/lib/m2/inputs";
import { nothingEvaluatedReason, renderMarkdown } from "../src/lib/m2/markdown";
import { m2Terminal } from "../src/lib/m2/terminal";
import { parseThresholds } from "../src/lib/m2/thresholds";

if (process.env.CI) {
  console.error(
    "m2-evaluate reads hand landmarks of real people and must never run in CI.",
  );
  process.exit(1);
}

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function git(args: readonly string[]): string | null {
  try {
    return execFileSync("git", [...args], {
      cwd: scriptRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

const USAGE =
  "Usage: npm run m2:evaluate -- --log <run log or folder> --truth <truth.json or folder> [--path markers|paper-edge|both] [--gesture G01] [--participants P001,P002] [--thresholds <file>] [--out <report.json>]";

let username: string | null = null;
try {
  username = userInfo().username;
} catch {
  // no account name to hide
}
const cwd = process.cwd();

/**
 * What a terminal may show: the paths given on the command line as the
 * relative paths the run log uses, this checkout and the working folder as
 * ".", the account name as "~". Widened once the arguments are known.
 */
let terminal = m2Terminal({ cwd, scriptRoot, username });

function fail(message: string): never {
  terminal.warn(message);
  process.exit(1);
}

function readJson(file: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    // The path is left out of the message on purpose: it can hold an account name.
    fail(`${label} could not be read as JSON.`);
  }
}

/** Run logs: a file, or every *.json directly in a folder. */
function logFiles(target: string): string[] {
  if (!existsSync(target)) fail("A --log path does not exist.");
  if (!statSync(target).isDirectory()) return [target];
  return readdirSync(target)
    .filter((n) => n.toLowerCase().endsWith(".json"))
    .sort()
    .map((n) => join(target, n));
}

/** Truth files: a file, or <folder>/<participant>/truth.json one level down. */
function truthFiles(target: string): string[] {
  if (!existsSync(target)) fail("A --truth path does not exist.");
  if (!statSync(target).isDirectory()) return [target];
  return readdirSync(target)
    .sort()
    .map((n) => join(target, n, "truth.json"))
    .filter((f) => existsSync(f));
}

// Everything below, file system calls included, runs inside one try, so that
// no error can reach the terminal as a raw stack.
try {
  const parsed = parseM2Args(process.argv.slice(2));
  if (!parsed.ok) fail(`${parsed.message}\n${USAGE}`);
  const args = parsed.args;

  const out = args.out ? resolve(args.out) : null;
  const named = [
    ...args.logs,
    ...args.truths,
    ...(args.thresholds ? [args.thresholds] : []),
  ].map((p) => resolve(p));
  // A file the sorter wrote sits below its folder; the folder is enough to
  // show any path inside it relative.
  const shownPaths = [...named, ...(out ? [out, dirname(out)] : [])];
  terminal = m2Terminal({ cwd, scriptRoot, username, named: shownPaths });

  const logs = args.logs.flatMap((t) => logFiles(resolve(t)));
  const truths = args.truths.flatMap((t) => truthFiles(resolve(t)));
  if (logs.length === 0) fail("No run log (*.json) was found under --log.");
  if (truths.length === 0) fail("No truth.json was found under --truth.");

  const paths: EvalPath[] = args.path === "both" ? [...ALL_PATHS] : [args.path];

  if (out) {
    if (outputInsideRepo(out, scriptRoot, git)) {
      fail(
        "--out must be outside the repo and every git worktree: an evaluation report is derived from real people's photos.",
      );
    }
    if (existsSync(out)) {
      fail("--out already exists and is never overwritten. Choose a new file.");
    }
  }

  const options: EvaluateOptions = {
    paths,
    gestures: args.gestures,
    participants: args.participants,
    thresholds: args.thresholds
      ? parseThresholds(
          readJson(resolve(args.thresholds), "The thresholds file"),
        )
      : undefined,
  };
  const report = evaluateJson(
    logs.map((f, i) => readJson(f, `Run log ${i + 1}`)),
    truths.map((f, i) => readJson(f, `Truth file ${i + 1}`)),
    options,
  );
  process.stdout.write(renderMarkdown(report) + "\n");
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(report, null, 2) + "\n", {
      flag: "wx",
    });
    // Not the file name: it is the user's own and can say who or when.
    terminal.warn("JSON report written.");
  }
  if (args.participants) {
    const unseen = args.participants.filter(
      (p) => !report.inputs.participants.includes(p),
    );
    if (unseen.length > 0) {
      terminal.warn(
        `Nothing was evaluated for ${unseen.join(", ")}: no measured photo in the logs.`,
      );
    }
  }
  if (report.counts.measured === 0) {
    terminal.warn(nothingEvaluatedReason(report));
    process.exit(2);
  }
} catch (err) {
  if (err instanceof EvaluationInputError) fail(err.message);
  // Anything else (a file system error, say): the message only, never the
  // stack, which is a list of absolute paths.
  terminal.failure(err);
  process.exit(1);
}
