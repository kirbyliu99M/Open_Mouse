/**
 * One entry point for both protocols: parse what came off disk, decide the
 * protocol (and refuse to mix), then evaluate. Labels name inputs by position
 * ("run log 2"), never by path.
 *
 *  - kit v1 run logs (format 2, or format 3 with no protocol) + truth files:
 *    candidate-v1, `evaluate` (evaluate.ts).
 *  - kit v2 run logs (format 3 with protocol agreed-v2) + participant records
 *    (+ session and labels records): agreed-v2, `evaluateKitV2` (kitv2.ts).
 *    No truth.
 */
import {
  evaluate,
  type EvaluateOptions,
  type EvaluationReport,
} from "./evaluate";
import {
  EvaluationInputError,
  parseKitV2RunLog,
  parseLabelsRecord,
  parseParticipantRecord,
  parseRunLog,
  parseSessionRecord,
  parseTruth,
  runLogFormatOf,
  runLogProtocolOf,
} from "./inputs";
import { evaluateKitV2, type KitV2Report } from "./kitv2";
import {
  PROTOCOL_AGREED_V2,
  assertNoTruthUnderAgreedV2,
  resolveProtocol,
} from "./protocol";

export type AnyEvaluationReport = EvaluationReport | KitV2Report;

export interface RunJson {
  readonly logs: readonly unknown[];
  readonly truths?: readonly unknown[];
  readonly records?: readonly unknown[];
  readonly sessions?: readonly unknown[];
  /** labels.json files (agreed-v2): the blind good/bad calls. */
  readonly labels?: readonly unknown[];
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
  // A log with no `format` at all is handed to the candidate-v1 reader, which
  // says exactly what is wrong with it (as it always has); a log that names
  // some other format or protocol is refused here.
  const protocols = logs.map((json, i) => {
    const format = runLogFormatOf(json);
    if (format === null) return "candidate-v1" as const;
    const protocol = runLogProtocolOf(json);
    if (protocol === null) {
      throw new EvaluationInputError(
        `run log ${i + 1} is not a kit v1 run log (format 2, or format 3 with no protocol) or a kit v2 run log (format 3 with protocol agreed-v2)${shownFormat(format)}.`,
      );
    }
    return protocol;
  });
  return resolveProtocol({ protocols, requested });
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
  const labelsJson = run.labels ?? [];
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
        labels: labelsJson.map((j, i) =>
          parseLabelsRecord(j, `labels record ${i + 1}`),
        ),
      },
      opts,
    );
  }

  if (
    recordsJson.length > 0 ||
    sessionsJson.length > 0 ||
    labelsJson.length > 0
  ) {
    throw new EvaluationInputError(
      "Participant, session and labels records belong to agreed-v2 (format-3 run logs); candidate-v1 reads truth files.",
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
