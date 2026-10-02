/**
 * M2 evaluator: how well does a hand-measurement model agree with its
 * reference and repeat across retakes, judged only from the run logs that
 * `npm run learn:sort` wrote and, depending on the protocol, the `truth.json`
 * files or the `participant.json` records of the participants. It never opens
 * a photo.
 *
 * Two protocols (src/lib/m2/protocol.ts), told apart by the run logs' format
 * and never mixed:
 *
 *  candidate-v1  format-2 run logs and ruler `truth.json` files:
 *    npm run m2:evaluate -- \
 *      --log ../Fixtures/learning/runs \
 *      --truth ../Fixtures/learning \
 *      --out ../Fixtures/evaluations/baseline.json
 *
 *  agreed-v2  format-3 run logs (kit v2), no ruler truth: the marker plane of
 *    the same sheet is the reference, accuracy is dormant, and the report is
 *    agreement with that reference and retake repeatability.
 *    npm run m2:evaluate -- \
 *      --log ../Fixtures/learning-v2/runs \
 *      --records ../Fixtures/learning-v2 \
 *      --out ../Fixtures/evaluations/v2-calibration.json
 *
 * --log <file|folder>       a run log, or a folder of them (*.json); repeat freely
 * --truth <file|folder>     candidate-v1: a truth.json, or a folder holding <participant>/truth.json.
 *                           Required for format-2 logs; refused with format-3 logs (agreed-v2 has no truth)
 * --records <file|folder>   agreed-v2: a participant.json, or a folder holding <participant>/participant.json
 *                           (the grip a person reports and the hand they use); repeat freely
 * --session <file|folder>   agreed-v2: a session.json, or a folder holding session.json or <session>/session.json
 *                           (the phone, when the run log does not embed it); repeat freely
 * --protocol agreed-v2|candidate-v1   the protocol the run logs must be of (default: theirs; a mismatch is an error)
 * --path markers|paper-edge|both     which calibration plane the field tables judge (default both)
 * --gesture G01[,G02...]    poses of the field tables (default G01 for candidate-v1, G02 for agreed-v2).
 *                           The agreed-v2 per-person statistics always use G02 and G04
 * --participants P001,P002  only these participants (a fold)
 * --held-out                agreed-v2: ONLY the held-out participants of the prereg's rule. Meant to be run
 *                           once, by Claude, after the model is frozen: not from a workflow, not again after
 *                           looking at the result
 * --s0                      agreed-v2: ONLY the S0 pilot participants
 * --aggregate-only          drop every per-person and per-photo row from the JSON and the Markdown (for text
 *                           pasted into a pull request)
 * --thresholds <file>       candidate-v1: JSON limits, e.g. {"accuracyMm":{"handLengthMm":2}}; default: the candidates
 * --out <file>              write the JSON report here (never overwritten; never inside the repo
 *                           or any worktree). The Markdown summary always goes to stdout.
 *
 * Without --held-out or --s0, an agreed-v2 run evaluates the calibration set:
 * held-out and S0 participants, and participants in a block of four that is
 * not complete yet, are left out, and the summary says so.
 *
 * The command line is checked strictly (src/lib/m2/cli.ts): an unknown or
 * misspelt flag, a flag without a value, a single-value flag given twice or a
 * malformed list is an error and exits 1. Nothing falls back to a default.
 *
 * NEVER runs in CI: run logs hold hand landmarks of real people. The report
 * holds totals, anonymous participant codes and photo ids like
 * "P007/G02R/3", and no path, account name, EXIF or landmark. Neither does
 * anything printed: every failure, including a file system error, goes
 * through the same redaction as `learn:sort` (message only, never a stack;
 * the paths given on the command line shown relative; the account name as
 * "~"), and the file name given to --out is not repeated.
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
import { toAggregateOnly } from "../src/lib/m2/aggregate";
import { parseM2Args } from "../src/lib/m2/cli";
import {
  ALL_PATHS,
  type EvalPath,
  type EvaluateOptions,
} from "../src/lib/m2/evaluate";
import { EvaluationInputError } from "../src/lib/m2/inputs";
import { HELD_OUT_NOTICE } from "../src/lib/m2/kitv2";
import { nothingEvaluatedReason, renderMarkdown } from "../src/lib/m2/markdown";
import { PROTOCOL_AGREED_V2 } from "../src/lib/m2/protocol";
import { evaluateRunJson, protocolOfRun } from "../src/lib/m2/run";
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
  "Usage: npm run m2:evaluate -- --log <run log or folder> [--truth <truth.json or folder>] [--records <participant.json or folder>] [--session <session.json or folder>] [--protocol agreed-v2|candidate-v1] [--path markers|paper-edge|both] [--gesture G01] [--participants P001,P002] [--held-out | --s0] [--aggregate-only] [--thresholds <file>] [--out <report.json>]";

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

/**
 * Per-participant (or per-session) records: a file, or a folder holding
 * `<name>` directly and/or `<participant>/<name>` one level down.
 */
function recordFiles(target: string, name: string, flag: string): string[] {
  if (!existsSync(target)) fail(`A ${flag} path does not exist.`);
  if (!statSync(target).isDirectory()) return [target];
  const direct = join(target, name);
  return [
    ...(existsSync(direct) ? [direct] : []),
    ...readdirSync(target)
      .sort()
      .map((n) => join(target, n, name))
      .filter((f) => existsSync(f)),
  ];
}

// Everything below, file system calls included, runs inside one try, so that
// no error can reach the terminal as a raw stack.
try {
  // The protocol is the logs' and the logs are not open yet, so whether
  // --truth is needed is checked below, once they are.
  const parsed = parseM2Args(process.argv.slice(2), process.platform, {
    truthOptional: true,
  });
  if (!parsed.ok) fail(`${parsed.message}\n${USAGE}`);
  const args = parsed.args;

  const out = args.out ? resolve(args.out) : null;
  const named = [
    ...args.logs,
    ...args.truths,
    ...(args.records ?? []),
    ...(args.sessions ?? []),
    ...(args.thresholds ? [args.thresholds] : []),
  ].map((p) => resolve(p));
  // A file the sorter wrote sits below its folder; the folder is enough to
  // show any path inside it relative.
  const shownPaths = [...named, ...(out ? [out, dirname(out)] : [])];
  terminal = m2Terminal({ cwd, scriptRoot, username, named: shownPaths });

  const logs = args.logs.flatMap((t) => logFiles(resolve(t)));
  if (logs.length === 0) fail("No run log (*.json) was found under --log.");
  const logsJson = logs.map((f, i) => readJson(f, `Run log ${i + 1}`));

  // Which protocol the logs are of (and a refusal to mix), before anything
  // else is read: the two protocols want different inputs.
  const protocol = protocolOfRun(logsJson, args.protocol);
  const agreed = protocol === PROTOCOL_AGREED_V2;

  const truths = args.truths.flatMap((t) => {
    if (!existsSync(resolve(t))) fail("A --truth path does not exist.");
    const target = resolve(t);
    if (!statSync(target).isDirectory()) return [target];
    return readdirSync(target)
      .sort()
      .map((n) => join(target, n, "truth.json"))
      .filter((f) => existsSync(f));
  });
  if (!agreed && args.truths.length === 0) {
    // The parser's own check, which does not know the protocol until the logs are read.
    fail(`--truth is required for format-2 run logs (candidate-v1).\n${USAGE}`);
  }
  if (!agreed && truths.length === 0) {
    fail("No truth.json was found under --truth.");
  }
  const recordPaths = (args.records ?? []).flatMap((t) =>
    recordFiles(resolve(t), "participant.json", "--records"),
  );
  const sessionPaths = (args.sessions ?? []).flatMap((t) =>
    recordFiles(resolve(t), "session.json", "--session"),
  );

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

  if (args.heldOut && agreed) {
    // Loud, and first: before anything is computed.
    terminal.warn(`*** ${HELD_OUT_NOTICE} ***`);
  }

  const options: EvaluateOptions = {
    paths,
    // agreed-v2: the field tables default to G02 (the prereg), not G01.
    gestures: agreed && args.gesturesGiven !== true ? undefined : args.gestures,
    participants: args.participants,
    thresholds: args.thresholds
      ? parseThresholds(
          readJson(resolve(args.thresholds), "The thresholds file"),
        )
      : undefined,
    protocol,
    selection: args.heldOut ? "held-out" : args.s0 ? "s0" : undefined,
  };
  const full = evaluateRunJson(
    {
      logs: logsJson,
      truths: truths.map((f, i) => readJson(f, `Truth file ${i + 1}`)),
      records: recordPaths.map((f, i) =>
        readJson(f, `Participant record ${i + 1}`),
      ),
      sessions: sessionPaths.map((f, i) =>
        readJson(f, `Session record ${i + 1}`),
      ),
    },
    options,
  );
  const report = args.aggregateOnly ? toAggregateOnly(full) : full;
  process.stdout.write(renderMarkdown(report) + "\n");
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(report, null, 2) + "\n", {
      flag: "wx",
    });
    // Not the file name: it is the user's own and can say who or when.
    terminal.warn("JSON report written.");
  }
  if (full.protocol === PROTOCOL_AGREED_V2) {
    const s = full.selection;
    if (s.mode === "calibration") {
      terminal.warn(
        `agreed-v2: the calibration set. Left out: ${s.roles["held-out"]} held-out, ${s.roles.s0} S0 and ${s.roles.pending} pending (block not complete) participants.`,
      );
    }
    if (s.requestedOutsideSetCount > 0) {
      terminal.warn(
        args.aggregateOnly
          ? `${s.requestedOutsideSetCount} participants named with --participants are not in this run's set (${s.mode}) and were not evaluated.`
          : `Not in this run's set (${s.mode}), so not evaluated: ${s.requestedOutsideSet.join(", ")}.`,
      );
    }
  } else if (full.options.participants) {
    const unseen = full.options.participants.filter(
      (p) => !full.inputs.participants.includes(p),
    );
    if (unseen.length > 0) {
      terminal.warn(
        args.aggregateOnly
          ? `Nothing was evaluated for ${unseen.length} of the participants named: no measured photo in the logs.`
          : `Nothing was evaluated for ${unseen.join(", ")}: no measured photo in the logs.`,
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
