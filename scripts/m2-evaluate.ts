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
 * NEVER runs in CI: run logs hold hand landmarks of real people. The report
 * holds totals, anonymous participant codes and photo ids like "P007/G01R/3",
 * and no path, account name, EXIF or landmark.
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
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { outputInsideRepo } from "../src/lib/learning/paths";
import {
  ALL_PATHS,
  evaluateJson,
  type EvalPath,
  type EvaluateOptions,
} from "../src/lib/m2/evaluate";
import { EvaluationInputError } from "../src/lib/m2/inputs";
import { renderMarkdown } from "../src/lib/m2/markdown";
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

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Every value of a repeatable flag: `--log a --log b`. */
function all(flag: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === flag && process.argv[i + 1] !== undefined) {
      out.push(process.argv[i + 1]!);
    }
  });
  return out;
}
const one = (flag: string) => all(flag).at(-1);

const USAGE =
  "Usage: npm run m2:evaluate -- --log <run log or folder> --truth <truth.json or folder> [--path markers|paper-edge|both] [--gesture G01] [--participants P001,P002] [--thresholds <file>] [--out <report.json>]";

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

const logs = all("--log").flatMap((t) => logFiles(resolve(t)));
const truths = all("--truth").flatMap((t) => truthFiles(resolve(t)));
if (logs.length === 0 || all("--truth").length === 0) fail(USAGE);
if (truths.length === 0) fail("No truth.json was found under --truth.");

const pathArg = one("--path") ?? "both";
if (!["markers", "paper-edge", "both"].includes(pathArg)) {
  fail(`--path must be markers, paper-edge or both, not "${pathArg}".`);
}
const paths: EvalPath[] =
  pathArg === "both" ? [...ALL_PATHS] : [pathArg as EvalPath];
const gestures = (one("--gesture") ?? "G01")
  .split(",")
  .map((g) => g.trim())
  .filter(Boolean);
const participantsArg = one("--participants");
const participants = participantsArg
  ? participantsArg
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
  : null;

const outArg = one("--out");
const out = outArg ? resolve(outArg) : null;
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

const thresholdsArg = one("--thresholds");

try {
  const options: EvaluateOptions = {
    paths,
    gestures,
    participants,
    thresholds: thresholdsArg
      ? parseThresholds(readJson(resolve(thresholdsArg), "The thresholds file"))
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
    console.error(`JSON report written to ${basename(out)}.`);
  }
  if (report.counts.measured === 0) {
    console.error(
      "No photo could be evaluated. The excluded list above says why.",
    );
    process.exit(2);
  }
} catch (err) {
  if (err instanceof EvaluationInputError) fail(err.message);
  throw err;
}
