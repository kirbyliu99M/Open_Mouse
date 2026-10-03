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
import {
  RUN_LOG_FORMAT,
  RUN_LOG_FORMAT_V2,
  type LearningRunLog,
} from "../learning/runlog";
import type { LearningPhotoReport } from "../learning/report";
import {
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

/**
 * The two run-log formats the evaluator reads, from the sorter's own constants
 * (`src/lib/learning/runlog.ts`): `RUN_LOG_FORMAT` is the format it writes now,
 * format 3, and `RUN_LOG_FORMAT_V2` the one kit v1 runs were written in before.
 * Format 3 carries kit v1 runs too (`protocol` null), so what a log is
 * evaluated as is decided by its `format` and its `protocol`:
 *  - format 2: candidate-v1 (kit v1 run, ruler truth);
 *  - format 3, `protocol` null or absent: candidate-v1, a kit v1 run written by the newer sorter;
 *  - format 3, `protocol` "agreed-v2": agreed-v2 (kit v2 run, no ruler truth).
 */
export { RUN_LOG_FORMAT_V2 };
export const RUN_LOG_FORMAT_V3 = RUN_LOG_FORMAT;

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
  format: z.enum([RUN_LOG_FORMAT_V2, RUN_LOG_FORMAT_V3]),
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

/**
 * A candidate-v1 run log from parsed JSON: format 2, or format 3 with no
 * protocol (a kit v1 run written by the newer sorter). `label` names it in
 * errors ("run log 2").
 */
export function parseRunLog(json: unknown, label: string): LearningRunLog {
  if (
    json !== null &&
    typeof json === "object" &&
    "format" in json &&
    (json as { format: unknown }).format !== RUN_LOG_FORMAT_V2 &&
    (json as { format: unknown }).format !== RUN_LOG_FORMAT_V3
  ) {
    throw new EvaluationInputError(
      `${label} is not a format-2 run log (format is ${JSON.stringify((json as { format: unknown }).format)}, expected ${RUN_LOG_FORMAT_V2}).`,
    );
  }
  if (
    json !== null &&
    typeof json === "object" &&
    (json as { format?: unknown }).format === RUN_LOG_FORMAT_V3 &&
    (json as { protocol?: unknown }).protocol != null
  ) {
    throw new EvaluationInputError(
      `${label} is a kit v2 run log (it names a protocol): it is evaluated under agreed-v2, not candidate-v1.`,
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

const gestureCode = z.enum(GESTURE_CODES);
const hand = z.enum(["left", "right"]);

// What the contract says a v3 `sort.photos[]` entry holds
// (`KitV2PhotoAssignment`), `status` and `destination` included. The pose, hand
// and shot come from here, never from a QR code on the photo; any other key an
// entry has is allowed through and not read.
const assignment = z.looseObject({
  file: z.string(),
  /** The sorter's status for the photo, and the relative path of its filed copy (`null` if not filed): the name a label carries. */
  status: z.string(),
  destination: z.string().nullable(),
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

// `session` is the whole `session.json` record the sorter was given (the
// contract's pinned form), or `null` (a download from the checker page). A bare
// session id is accepted as well, though no producer writes one.
// The record is checked by the contract's own schema (see `checkSessionRecord`,
// which names the field), so a session on sheet B or on Letter paper is
// refused here as it is by the sorter.
const sessionField = z
  .union([z.string(), z.record(z.string(), z.unknown())])
  .nullish();

/** A word that is safe to show back: plain letters, digits and hyphens, not long. */
const plainWord = (value: unknown): string | null =>
  typeof value === "string" && /^[A-Za-z0-9-]{1,20}$/.test(value)
    ? value
    : null;

/**
 * The embedded session record, checked against the contract's schema, with an
 * error that says which field is wrong and why: "session.sheet: sheet B is
 * not used (sheet A only)". Values are shown only when they are plain words.
 */
function checkSessionRecord(record: unknown, label: string): void {
  const parsed = sessionRecordSchema.safeParse(record);
  if (parsed.success) return;
  const given = record as Record<string, unknown>;
  const issues = parsed.error.issues.slice(0, 3).flatMap((issue) => {
    if (issue.code === "unrecognized_keys") {
      return issue.keys.map((key) =>
        plainWord(key)
          ? `session.${key}: not a field of a session record`
          : "session: a field that is not part of a session record",
      );
    }
    const field = issue.path.join(".");
    if (field === "sheet") {
      const sheet = plainWord(given.sheet);
      return [
        `session.sheet: ${sheet ? `sheet ${sheet}` : "this sheet"} is not used (sheet A only)`,
      ];
    }
    if (field === "paperSize") {
      const size = plainWord(given.paperSize);
      return [
        `session.paperSize: ${size ? `paper size ${size}` : "this paper size"} is not used (A4 only)`,
      ];
    }
    return [`session${field ? `.${field}` : ""}: ${issue.message}`];
  });
  throw new EvaluationInputError(
    `${label} does not fit the format: ${issues.join("; ")}`,
  );
}

/** What a free-text session field is shown as when it is not plain words. */
export const SESSION_TEXT_OTHER = "(other)";

// Plain Latin words, digits and a little punctuation, short.
const PLAIN_SESSION_TEXT = /^[A-Za-z0-9 ,.()+\-/×]{1,60}$/;

/**
 * A free-text session field (phone, light) as it may appear in a count: only
 * plain words are shown. The text is typed by a person, so it can hold
 * anything: a participant code, a path, a table separator, a name. Control
 * characters and runs of white space are folded first. Anything that is not
 * short plain Latin words, or that looks like a participant code or a path,
 * is shown as "(other)"; nothing typed is copied into the report otherwise.
 * An empty field stays empty (the caller calls that "unknown").
 */
export function cleanSessionText(text: string): string {
  const folded = Array.from(text, (ch) => {
    const code = ch.charCodeAt(0);
    return code < 32 || code === 127 ? " " : ch;
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (folded === "") return "";
  if (!PLAIN_SESSION_TEXT.test(folded)) return SESSION_TEXT_OTHER;
  // A participant code, a path (a leading or doubled slash, "..", or two
  // or more slashes) or anything shaped like one is not a description.
  if (/P\d{3}/i.test(folded)) return SESSION_TEXT_OTHER;
  if (/^\/|\/\/|\.\./.test(folded) || (folded.match(/\//g) ?? []).length > 1) {
    return SESSION_TEXT_OTHER;
  }
  return folded;
}

// The sorter's per-participant rows: only a participant in review matters here.
const sortParticipant = z.looseObject({
  participant: z.string(),
  status: z.string(),
  reason: z.string().nullable().optional(),
});

const runLogV3 = z.looseObject({
  format: z.literal(RUN_LOG_FORMAT_V3),
  protocol: z.literal(PROTOCOL_AGREED_V2),
  session: sessionField,
  sheet: sessionRecordSchema.shape.sheet.nullish(),
  kitVersion: finite,
  gitSha: z.string().nullable(),
  gitDirty: z.boolean().nullable(),
  paperSize: z.string(),
  reports: z.array(reportV3),
  sort: z.looseObject({
    photos: z.array(assignment),
    participants: z.array(sortParticipant).optional(),
  }),
});

/** A `sort.photos[]` entry, as the contract defines it. */
export type KitV2LogPhoto = KitV2PhotoAssignment;

/** A format-3 run log (protocol agreed-v2), reduced to what the evaluator reads. */
export interface KitV2RunLog {
  readonly format: typeof RUN_LOG_FORMAT_V3;
  readonly protocol: typeof PROTOCOL_AGREED_V2;
  /** The session's id (`S001`), when the log names one. */
  readonly sessionId: string | null;
  /** The phone, when the log embeds the whole session record; otherwise it comes from a `session.json`. */
  readonly embeddedPhone: string | null;
  /** The light, from the embedded session record; otherwise from a `session.json`. */
  readonly embeddedLight: string | null;
  readonly sheet: KitV2Sheet | null;
  readonly kitVersion: number;
  readonly gitSha: string | null;
  readonly gitDirty: boolean | null;
  readonly paperSize: string;
  readonly reports: readonly LearningPhotoReport[];
  readonly sort: {
    readonly photos: readonly KitV2LogPhoto[];
    /** One row per participant the sorter saw: `needs-review` has a `reason`. */
    readonly participants: readonly {
      readonly participant: string;
      readonly status: string;
      readonly reason: string | null;
    }[];
  };
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
  if (embedded) checkSessionRecord(d.session, label);
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
    embeddedLight: embedded
      ? ((d.session as { light?: string }).light ?? null)
      : null,
    sheet:
      d.sheet ??
      (embedded ? ((d.session as { sheet?: KitV2Sheet }).sheet ?? null) : null),
    kitVersion: d.kitVersion,
    gitSha: d.gitSha,
    gitDirty: d.gitDirty,
    paperSize: d.paperSize,
    reports: d.reports as unknown as LearningPhotoReport[],
    sort: {
      photos: d.sort.photos as unknown as KitV2LogPhoto[],
      participants: (d.sort.participants ?? []).map((p) => ({
        participant: p.participant,
        status: p.status,
        reason: p.reason ?? null,
      })),
    },
  };
}

/**
 * The protocol a run log's JSON belongs to, from its `format` and `protocol`:
 * format 2 and format 3 with no protocol are candidate-v1; format 3 with
 * protocol "agreed-v2" is agreed-v2. `null` for anything else (another
 * format, or a protocol name that is neither).
 */
export function runLogProtocolOf(
  json: unknown,
): "candidate-v1" | typeof PROTOCOL_AGREED_V2 | null {
  const format = runLogFormatOf(json);
  if (format === RUN_LOG_FORMAT_V2) return "candidate-v1";
  if (format !== RUN_LOG_FORMAT_V3) return null;
  const protocol = (json as { protocol?: unknown }).protocol;
  if (protocol === undefined || protocol === null) return "candidate-v1";
  return protocol === PROTOCOL_AGREED_V2 ? PROTOCOL_AGREED_V2 : null;
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
