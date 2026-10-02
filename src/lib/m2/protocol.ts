/**
 * Which protocol a run is evaluated under, and the refusal to mix them.
 *
 * Two protocols exist and their numbers never meet:
 *  - `candidate-v1`: run-log format 2, ruler `truth.json` files (accuracy and
 *    repeatability against a ruler).
 *  - `agreed-v2`: run-log format 3 (protocol written into the log), no ruler
 *    truth at all, the marker plane of the same sheet as the reference. The
 *    frozen prereg of 2026-10-02 defines its criteria.
 *
 * The protocol is read from the run logs' format. It can also be asked for;
 * asking for the other one is an error, as is giving the evaluator both kinds
 * of log, and giving an agreed-v2 run a truth file.
 */
import { PROTOCOL_AGREED_V2 } from "../learning/session";
import { TRUTH_PROTOCOL } from "../learning/truth";
import { RUN_LOG_FORMAT } from "../learning/runlog";
import { EvaluationInputError, RUN_LOG_FORMAT_V3 } from "./inputs";

export const PROTOCOL_CANDIDATE_V1 = TRUTH_PROTOCOL;
export { PROTOCOL_AGREED_V2 };

export const PROTOCOLS = [PROTOCOL_AGREED_V2, PROTOCOL_CANDIDATE_V1] as const;
export type Protocol = (typeof PROTOCOLS)[number];

export function isProtocol(value: string): value is Protocol {
  return (PROTOCOLS as readonly string[]).includes(value);
}

/** The protocol a run log's `format` belongs to; `null` for any other format. */
export function protocolOfLogFormat(format: string | null): Protocol | null {
  if (format === RUN_LOG_FORMAT) return PROTOCOL_CANDIDATE_V1;
  if (format === RUN_LOG_FORMAT_V3) return PROTOCOL_AGREED_V2;
  return null;
}

const FORMAT_NUMBER: Record<Protocol, string> = {
  "candidate-v1": "2",
  "agreed-v2": "3",
};

const never = "candidate-v1 values are never mixed with agreed-v2.";

/**
 * The protocol of a set of run logs, given their formats, after the checks
 * that keep the two apart. Throws `EvaluationInputError` (a message that
 * names the protocols, never a path) when:
 *  - the logs are of both formats;
 *  - `requested` is the other protocol than the logs'.
 */
export function resolveProtocol(args: {
  readonly logFormats: readonly (string | null)[];
  readonly requested?: Protocol | null;
}): Protocol {
  const found = new Set<Protocol>();
  for (const format of args.logFormats) {
    const p = protocolOfLogFormat(format);
    if (p === null) {
      throw new EvaluationInputError(
        `A run log is not format 2 (candidate-v1) or format 3 (agreed-v2).`,
      );
    }
    found.add(p);
  }
  if (found.size === 0) {
    throw new EvaluationInputError("Give at least one run log.");
  }
  if (found.size > 1) {
    throw new EvaluationInputError(
      `Run logs of format 2 (candidate-v1) and format 3 (agreed-v2) cannot be evaluated together: ${never} Run them separately.`,
    );
  }
  const logs = [...found][0]!;
  assertProtocolMatches(logs, args.requested ?? null);
  return logs;
}

/**
 * The refusal itself, for a caller that already knows what the logs are: the
 * logs are of protocol `logs`, and `requested` (when given) must be the same.
 */
export function assertProtocolMatches(
  logs: Protocol,
  requested: Protocol | null | undefined,
): void {
  if (requested === null || requested === undefined || requested === logs) {
    return;
  }
  throw new EvaluationInputError(
    `The run logs are format ${FORMAT_NUMBER[logs]} (${logs}) but the protocol asked for is ${requested}: ${never}`,
  );
}

/**
 * agreed-v2 has no ruler truth. A truth file given with it is refused, with
 * the reason that fits: a candidate-v1 file is the mix the rule forbids; any
 * other protocol name is simply not something agreed-v2 reads.
 */
export function assertNoTruthUnderAgreedV2(
  truths: readonly { readonly protocol: string }[],
): void {
  const first = truths[0];
  if (first === undefined) return;
  if (first.protocol === PROTOCOL_CANDIDATE_V1) {
    throw new EvaluationInputError(
      `Truth file 1 is a candidate-v1 file but the run logs are agreed-v2: ${never} Leave --truth out: agreed-v2 has no ruler truth.`,
    );
  }
  throw new EvaluationInputError(
    `Truth file 1 cannot be used with agreed-v2 run logs: agreed-v2 has no ruler truth, and its accuracy criterion stays dormant. Leave --truth out.`,
  );
}
