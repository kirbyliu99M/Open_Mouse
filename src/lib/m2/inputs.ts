/**
 * Reading the evaluator's two inputs, a v2 run log and a `truth.json`, from
 * JSON that came off disk. Both are checked before anything is computed, and
 * a file that does not fit is an error that says where, never a silent zero.
 * Error messages name the file by the label the caller gives it (its position
 * on the command line), not by its path.
 */
import { z } from "zod";
import { RUN_LOG_FORMAT, type LearningRunLog } from "../learning/runlog";
import { truthSchema, type Truth } from "../learning/truth";

export class EvaluationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluationInputError";
  }
}

const finite = z.number().finite();
const point = z.looseObject({ x: finite, y: finite });
const matrix3 = z.array(z.array(finite).length(3)).length(3);

// Only what the evaluator reads is checked; the rest of a report is allowed
// through, so a log with a field added later still loads.
const parallax = z.looseObject({
  corrected: z.boolean(),
  focalPx: finite.nullable(),
  principalPoint: z.looseObject({ cx: finite, cy: finite }),
  heightsMm: z.array(finite).length(21),
});
const plane = z.looseObject({
  method: z.enum(["markers", "paper-edge", "strip-markers"]),
  homography: matrix3,
  parallax: parallax.nullable(),
});
const gateRecord = z.looseObject({
  ok: z.boolean(),
  errorCodes: z.array(z.string()),
  warningCodes: z.array(z.string()),
});
const productGates = z.looseObject({
  paper: gateRecord,
  hand: gateRecord.nullable(),
  accepted: z.boolean(),
});
const check = z.looseObject({ id: z.string(), tone: z.string() });
const report = z.looseObject({
  file: z.string(),
  verdict: z.string(),
  checks: z.array(check),
  code: z
    .discriminatedUnion("kind", [
      z.looseObject({
        kind: z.literal("gesture"),
        version: finite,
        gesture: z.string(),
        hand: z.enum(["left", "right"]),
      }),
      z.looseObject({ kind: z.literal("participant") }),
    ])
    .nullable(),
  hand: z.looseObject({ landmarksPx: z.array(point).length(21) }).nullable(),
  markerPlane: plane.nullable(),
  paperPlane: plane.nullable(),
  productGates: productGates.nullable(),
});
const sortPhoto = z.looseObject({
  file: z.string(),
  status: z.string(),
  participant: z.string().nullable(),
  gesture: z.string().nullable(),
  hand: z.enum(["left", "right"]).nullable(),
  shot: finite.nullable(),
});
const runLog = z.looseObject({
  format: z.literal(RUN_LOG_FORMAT),
  kitVersion: finite,
  gitSha: z.string().nullable(),
  gitDirty: z.boolean().nullable(),
  paperSize: z.string(),
  reports: z.array(report),
  sort: z.looseObject({ photos: z.array(sortPhoto) }),
});

function where(issue: z.core.$ZodIssue): string {
  return issue.path.length > 0 ? issue.path.join(".") : "(top level)";
}

/** A v2 run log from parsed JSON. `label` names it in errors ("run log 2"). */
export function parseRunLog(json: unknown, label: string): LearningRunLog {
  if (
    json !== null &&
    typeof json === "object" &&
    "format" in json &&
    (json as { format: unknown }).format !== RUN_LOG_FORMAT
  ) {
    throw new EvaluationInputError(
      `${label} is not a format-2 run log (format is ${JSON.stringify((json as { format: unknown }).format)}, expected ${RUN_LOG_FORMAT}).`,
    );
  }
  const parsed = runLog.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${where(i)}: ${i.message}`)
      .join("; ");
    throw new EvaluationInputError(
      `${label} does not fit the format: ${issues}`,
    );
  }
  return parsed.data as unknown as LearningRunLog;
}

/** A `truth.json` from parsed JSON. */
export function parseTruth(json: unknown, label: string): Truth {
  const parsed = truthSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${where(i)}: ${i.message}`)
      .join("; ");
    throw new EvaluationInputError(
      `${label} is not a valid truth file: ${issues}`,
    );
  }
  return parsed.data;
}
