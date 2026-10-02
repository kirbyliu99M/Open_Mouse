/**
 * Reading the evaluator's inputs from JSON that came off disk: a run log
 * (format 2, protocol candidate-v1, or format 3, protocol agreed-v2), a
 * `truth.json` (candidate-v1 only), and for agreed-v2 the `participant.json`,
 * `session.json` and `labels.json` records. Each is checked before anything is computed,
 * and a file that does not fit is an error that says where, never a silent
 * zero. Error messages name the file by the label the caller gives it (its
 * position on the command line), not by its path.
 */
import { z } from "zod";
import { GESTURE_CODES } from "../learning/kit";
import { RUN_LOG_FORMAT, type LearningRunLog } from "../learning/runlog";
import type { LearningPhotoReport } from "../learning/report";
import {
  KIT_V2_SHEETS,
  PROTOCOL_AGREED_V2,
  labelsRecordSchema,
  participantRecordSchema,
  sessionRecordSchema,
  type KitV2PhotoAssignment,
  type KitV2Sheet,
  type LabelsRecord,
  type ParticipantRecord,
  type SessionRecord,
} from "../learning/session";
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

// ── Format 3 (protocol agreed-v2) ───────────────────────────────────────────

/** The run log of the kit v2 sorter. Its protocol is agreed-v2; format 2 is candidate-v1. */
export const RUN_LOG_FORMAT_V3 = "open-mouse-learning-run/3" as const;

const gestureCode = z.enum(GESTURE_CODES);
const hand = z.enum(["left", "right"]);

// What the contract says a v3 `sort.photos[]` entry holds
// (`KitV2PhotoAssignment`). The pose, hand and shot come from here, never from
// a QR code on the photo; any other key an entry has (a `status`, say) is
// allowed through and not read.
const assignment = z.looseObject({
  file: z.string(),
  participant: z.string().nullable(),
  gesture: gestureCode.nullable(),
  hand: hand.nullable(),
  shot: finite.nullable(),
  poseSource: z.literal("order"),
  extraShot: z.boolean(),
  poseCheck: z
    .looseObject({
      predicted: z.enum(["G02", "G04"]).nullable(),
      agrees: z.boolean().nullable(),
    })
    .nullable(),
});

// A v3 report is read for its hand, planes and gates only. Its `code` is not
// read at all (every photo carries the participant's card, which is not a
// pose), so whatever it holds is let through.
const reportV3 = report.extend({ code: z.unknown() });

// `session` is the session's id, or the whole `session.json` record embedded.
const sessionField = z
  .union([
    z.string(),
    z.looseObject({
      session: z.string(),
      phone: z.string().optional(),
      sheet: z.enum(KIT_V2_SHEETS).optional(),
    }),
  ])
  .nullish();

const runLogV3 = z.looseObject({
  format: z.literal(RUN_LOG_FORMAT_V3),
  protocol: z.literal(PROTOCOL_AGREED_V2),
  session: sessionField,
  sheet: z.enum(KIT_V2_SHEETS).nullish(),
  kitVersion: finite,
  gitSha: z.string().nullable(),
  gitDirty: z.boolean().nullable(),
  paperSize: z.string(),
  reports: z.array(reportV3),
  sort: z.looseObject({ photos: z.array(assignment) }),
});

/** A format-3 run log (protocol agreed-v2), reduced to what the evaluator reads. */
export interface KitV2RunLog {
  readonly format: typeof RUN_LOG_FORMAT_V3;
  readonly protocol: typeof PROTOCOL_AGREED_V2;
  /** The session's id (`S001`), when the log names one. */
  readonly sessionId: string | null;
  /** The phone, when the log embeds the whole session record; otherwise it comes from a `session.json`. */
  readonly embeddedPhone: string | null;
  readonly sheet: KitV2Sheet | null;
  readonly kitVersion: number;
  readonly gitSha: string | null;
  readonly gitDirty: boolean | null;
  readonly paperSize: string;
  readonly reports: readonly LearningPhotoReport[];
  readonly sort: { readonly photos: readonly KitV2PhotoAssignment[] };
}

/** A format-3 run log from parsed JSON. `label` names it in errors ("run log 2"). */
export function parseKitV2RunLog(json: unknown, label: string): KitV2RunLog {
  const parsed = runLogV3.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${where(i)}: ${i.message}`)
      .join("; ");
    throw new EvaluationInputError(
      `${label} does not fit the format: ${issues}`,
    );
  }
  const d = parsed.data;
  const embedded = typeof d.session === "object" && d.session !== null;
  return {
    format: d.format,
    protocol: d.protocol,
    sessionId:
      typeof d.session === "string"
        ? d.session
        : embedded
          ? (d.session as { session: string }).session
          : null,
    embeddedPhone: embedded
      ? ((d.session as { phone?: string }).phone ?? null)
      : null,
    sheet:
      d.sheet ??
      (embedded ? ((d.session as { sheet?: KitV2Sheet }).sheet ?? null) : null),
    kitVersion: d.kitVersion,
    gitSha: d.gitSha,
    gitDirty: d.gitDirty,
    paperSize: d.paperSize,
    reports: d.reports as unknown as LearningPhotoReport[],
    sort: { photos: d.sort.photos as unknown as KitV2PhotoAssignment[] },
  };
}

/** The `format` of a run log's JSON, or `null` when it has none (not an object, no such key). */
export function runLogFormatOf(json: unknown): string | null {
  if (json === null || typeof json !== "object" || !("format" in json)) {
    return null;
  }
  const f = (json as { format: unknown }).format;
  return typeof f === "string" ? f : null;
}

/** A `participant.json` from parsed JSON. */
export function parseParticipantRecord(
  json: unknown,
  label: string,
): ParticipantRecord {
  const parsed = participantRecordSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${where(i)}: ${i.message}`)
      .join("; ");
    throw new EvaluationInputError(
      `${label} is not a valid participant record: ${issues}`,
    );
  }
  return parsed.data;
}

/** A `session.json` from parsed JSON. */
export function parseSessionRecord(
  json: unknown,
  label: string,
): SessionRecord {
  const parsed = sessionRecordSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${where(i)}: ${i.message}`)
      .join("; ");
    throw new EvaluationInputError(
      `${label} is not a valid session record: ${issues}`,
    );
  }
  return parsed.data;
}

/** A `labels.json` (Kirby's good/bad calls on one session's photos) from parsed JSON. */
export function parseLabelsRecord(json: unknown, label: string): LabelsRecord {
  const parsed = labelsRecordSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${where(i)}: ${i.message}`)
      .join("; ");
    throw new EvaluationInputError(
      `${label} is not a valid labels record: ${issues}`,
    );
  }
  return parsed.data;
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
