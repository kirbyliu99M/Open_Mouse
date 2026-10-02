/**
 * One entry point for both protocols: parse what came off disk, decide the
 * protocol (and refuse to mix), then evaluate. Labels name inputs by position
 * ("run log 2"), never by path.
 *
 *  - format-2 run logs + truth files: candidate-v1, `evaluate` (evaluate.ts).
 *  - format-3 run logs + participant records (+ session records): agreed-v2,
 *    `evaluateKitV2` (kitv2.ts). No truth.
 */
import {
  evaluate,
  type EvaluateOptions,
  type EvaluationReport,
} from "./evaluate";
import {
  EvaluationInputError,
  parseKitV2RunLog,
  parseParticipantRecord,
  parseRunLog,
  parseSessionRecord,
  parseTruth,
  runLogFormatOf,
} from "./inputs";
import { evaluateKitV2, type KitV2Report } from "./kitv2";
import {
  PROTOCOL_AGREED_V2,
  assertNoTruthUnderAgreedV2,
  protocolOfLogFormat,
  resolveProtocol,
} from "./protocol";

export type AnyEvaluationReport = EvaluationReport | KitV2Report;

export interface RunJson {
  readonly logs: readonly unknown[];
  readonly truths?: readonly unknown[];
  readonly records?: readonly unknown[];
  readonly sessions?: readonly unknown[];
}

/** The format as it may be shown in a message: a short plain token, or nothing. */
function shownFormat(format: string | null): string {
  return format !== null && /^[A-Za-z0-9._/-]{1,40}$/.test(format)
    ? ` (format ${JSON.stringify(format)})`
    : "";
}

/** The protocol the given run logs (as parsed JSON) are of, after the checks that keep the two apart. */
export function protocolOfRun(
  logs: readonly unknown[],
  requested?: EvaluateOptions["protocol"],
) {
  if (logs.length === 0) {
    throw new EvaluationInputError("Give at least one run log.");
  }
  const formats = logs.map(runLogFormatOf);
  formats.forEach((format, i) => {
    if (protocolOfLogFormat(format) === null) {
      throw new EvaluationInputError(
        `run log ${i + 1} is not a run log of format 2 (candidate-v1) or format 3 (agreed-v2)${shownFormat(format)}.`,
      );
    }
  });
  return resolveProtocol({ logFormats: formats, requested });
}

/** Parse the JSON of the inputs, decide the protocol, evaluate. */
export function evaluateRunJson(
  run: RunJson,
  options: EvaluateOptions = {},
): AnyEvaluationReport {
  const protocol = protocolOfRun(run.logs, options.protocol);
  const truthsJson = run.truths ?? [];
  const recordsJson = run.records ?? [];
  const sessionsJson = run.sessions ?? [];
  const opts: EvaluateOptions = { ...options, protocol };

  if (protocol === PROTOCOL_AGREED_V2) {
    const truths = truthsJson.map((j, i) =>
      parseTruth(j, `truth file ${i + 1}`),
    );
    assertNoTruthUnderAgreedV2(truths);
    return evaluateKitV2(
      {
        logs: run.logs.map((j, i) => parseKitV2RunLog(j, `run log ${i + 1}`)),
        truths,
        records: recordsJson.map((j, i) =>
          parseParticipantRecord(j, `participant record ${i + 1}`),
        ),
        sessions: sessionsJson.map((j, i) =>
          parseSessionRecord(j, `session record ${i + 1}`),
        ),
      },
      opts,
    );
  }

  if (recordsJson.length > 0 || sessionsJson.length > 0) {
    throw new EvaluationInputError(
      "Participant and session records belong to agreed-v2 (format-3 run logs); candidate-v1 reads truth files.",
    );
  }
  return evaluate(
    {
      logs: run.logs.map((j, i) => parseRunLog(j, `run log ${i + 1}`)),
      truths: truthsJson.map((j, i) => parseTruth(j, `truth file ${i + 1}`)),
    },
    opts,
  );
}
