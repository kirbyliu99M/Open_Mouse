/**
 * Kit v2 contract (protocol `agreed-v2`, 2026-10-02): the records that
 * replace `truth.json`, and what the evaluator may read from a v2 run log.
 *
 * Source: docs/design/learning-kit-v2-proposal-2026-10-02/ (prereg frozen
 * 2026-10-02). One A4 sheet, Kirby the only photographer, about 30 seconds
 * per participant, only the hand the participant uses a mouse with. There is
 * no ruler truth: the marker plane on the same sheet is the reference, so
 * results are agreement and repeatability, never accuracy against real hands.
 *
 * Owned by Claude (contracts). The sorter (`learn:sort`) writes these
 * records; the evaluator (`m2:evaluate`) reads them. Pure; no Node imports.
 */
import { z } from "zod";
import { PAPER_SIZES_MM, type PaperSize } from "../contracts/measurement";
import type { GestureCode, HandSide } from "./kit";

export const PROTOCOL_AGREED_V2 = "agreed-v2" as const;
export const SESSION_FORMAT = "open-mouse-learning-session/1" as const;
export const PARTICIPANT_FORMAT = "open-mouse-learning-participant/1" as const;

/**
 * The shooting order for each participant (prereg §1). The pose of a photo
 * comes from this order, not from a QR code on the sheet. If the S0 stopwatch
 * forces a change (G02 ×2, G04 ×2), that is a new dated prereg and a new
 * protocol name, never an edit here.
 */
export const AGREED_V2_SEQUENCE: readonly {
  readonly gesture: GestureCode;
  readonly shots: number;
}[] = [
  { gesture: "G02", shots: 3 },
  { gesture: "G04", shots: 2 },
];

/** Extra shots allowed per participant: one, only for a hand off the sheet or a covered corner, and logged. */
export const AGREED_V2_MAX_EXTRA_SHOTS = 1;

/** S0 pilot ids. They settle the protocol only: never calibration, never held-out. */
export const S0_PARTICIPANTS = { first: 901, last: 912 } as const;

export function isS0Participant(participant: string): boolean {
  const m = /^P(\d{3})$/.exec(participant);
  if (!m) return false;
  const n = Number(m[1]);
  return n >= S0_PARTICIPANTS.first && n <= S0_PARTICIPANTS.last;
}

/** The two reference sheets built for S0 (proposal `sheet-designs/`). S0 picks one; B needs a new prereg. */
export const KIT_V2_SHEETS = ["A", "B"] as const;
export type KitV2Sheet = (typeof KIT_V2_SHEETS)[number];

export const GRIP_SELF_REPORTS = [
  "palm",
  "claw",
  "fingertip",
  "unsure",
] as const;
export type GripSelfReport = (typeof GRIP_SELF_REPORTS)[number];

export const AGE_BANDS = [
  "under-20",
  "20-29",
  "30-39",
  "40-49",
  "50-59",
  "60-plus",
] as const;

export const TIME_BLOCKS = ["morning", "afternoon", "evening"] as const;

const participantId = z.string().regex(/^P\d{3}$/);
const sessionId = z.string().regex(/^S\d{3}$/);

/**
 * `participant.json`, one per participant, filled in from the consent flow
 * (not from the measuring sheet). No name, no contact details: the consent
 * form that links a name to `P###` stays on paper with Kirby.
 */
export const participantRecordSchema = z.strictObject({
  format: z.literal(PARTICIPANT_FORMAT),
  participant: participantId,
  protocol: z.literal(PROTOCOL_AGREED_V2),
  session: sessionId,
  /** The hand photographed: the one they use a mouse with. */
  mouseHand: z.enum(["right", "left"]).nullable(),
  gripSelf: z.enum(GRIP_SELF_REPORTS).nullable(),
  /** Optional on the consent form. */
  ageBand: z.enum(AGE_BANDS).nullable(),
  /**
   * How many photos of each pose were actually taken, in shooting order (all
   * G02 first, then all G04). Kirby fills it in only when the count is not the
   * planned 3 + 2: an extra shot, or a missing one. `null` means "as planned".
   * The sorter never guesses: with any other photo count and no entry here,
   * the participant goes to review. Added 2026-10-02 after the #104 review.
   */
  shotCounts: z
    .strictObject({
      G02: z.number().int().min(0),
      G04: z.number().int().min(0),
    })
    .nullable(),
  note: z.string(),
});
export type ParticipantRecord = z.infer<typeof participantRecordSchema>;

/**
 * The pose of each photo, in shooting order, for one participant, or `null`
 * when it cannot be known and the participant must be reviewed. The pose
 * check never takes part: it only flags.
 */
export function planShots(
  photoCount: number,
  shotCounts: ParticipantRecord["shotCounts"],
): readonly GestureCode[] | null {
  const planned = AGREED_V2_SEQUENCE.reduce((sum, s) => sum + s.shots, 0);
  let counts: readonly { gesture: GestureCode; shots: number }[];
  if (shotCounts === null) {
    if (photoCount !== planned) return null;
    counts = AGREED_V2_SEQUENCE;
  } else {
    counts = AGREED_V2_SEQUENCE.map((s) => ({
      gesture: s.gesture,
      shots: shotCounts[s.gesture as "G02" | "G04"],
    }));
    const total = counts.reduce((sum, s) => sum + s.shots, 0);
    if (total !== photoCount || total > planned + AGREED_V2_MAX_EXTRA_SHOTS) {
      return null;
    }
  }
  return counts.flatMap((s) =>
    Array.from({ length: s.shots }, () => s.gesture),
  );
}

/**
 * `session.json`, one per session. The phone is typed in by hand because the
 * EXIF whitelist deliberately drops make and model.
 */
export const sessionRecordSchema = z.strictObject({
  format: z.literal(SESSION_FORMAT),
  session: sessionId,
  protocol: z.literal(PROTOCOL_AGREED_V2),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeBlock: z.enum(TIME_BLOCKS),
  venue: z.string(),
  light: z.string(),
  phone: z.string(),
  holding: z.string(),
  sheet: z.enum(KIT_V2_SHEETS),
  paperSize: z.enum(Object.keys(PAPER_SIZES_MM) as [PaperSize, ...PaperSize[]]),
  /** The printed 100 mm (A) or 180 mm marker-to-marker (B) check, in mm as measured; `null` if not done. */
  printCheckMm: z.number().positive().nullable(),
  note: z.string(),
});
export type SessionRecord = z.infer<typeof sessionRecordSchema>;

/** Templates the sorter writes for a person to fill in. */
export function emptyParticipantRecord(
  participant: string,
  session: string,
): ParticipantRecord {
  return {
    format: PARTICIPANT_FORMAT,
    participant,
    protocol: PROTOCOL_AGREED_V2,
    session,
    mouseHand: null,
    gripSelf: null,
    ageBand: null,
    shotCounts: null,
    note: "Copy from the consent flow: the mouse hand, the self-reported grip and (optional) age band. No name. Fill shotCounts only if the photos were not 3 G02 then 2 G04.",
  };
}

/**
 * The result of the automatic pose check: a pure classifier on the photo's
 * landmarks that says whether it looks like G02 (flat, spread) or G04 (claw).
 * It only flags; it never moves a photo to another pose.
 */
export interface PoseCheck {
  readonly predicted: "G02" | "G04" | null;
  /** `null` when no hand was found or the classifier abstained. */
  readonly agrees: boolean | null;
}

/**
 * What the evaluator reads, per photo, from a kit v2 run log's
 * `sort.photos[]` (matched to a report by `file`). For kit v2 the pose, hand
 * and shot come from here, never from a QR code on the photo.
 *
 * Pinned 2026-10-02, after both builder branches existed:
 * - A v3 run log's top-level `session` is the whole `SessionRecord` that the
 *   sorter was given (never just its id).
 * - `labels.json` names each photo by this `destination`, verbatim.
 */
export interface KitV2PhotoAssignment {
  readonly file: string;
  /** The sorter's status for this photo (for example "ok", "needs-review", "no-code"). */
  readonly status: string;
  /** Relative path the photo was filed to, `/`-separated; `null` if not filed. Labels use it. */
  readonly destination: string | null;
  readonly participant: string | null;
  readonly gesture: GestureCode | null;
  /** From `participant.json`'s `mouseHand`; MediaPipe's label is only a check. */
  readonly hand: HandSide | null;
  readonly shot: number | null;
  readonly poseSource: "order";
  readonly extraShot: boolean;
  readonly poseCheck: PoseCheck | null;
}

// ── Kirby's photo labels (2026-10-02) ───────────────────────────────────────

export const LABELS_FORMAT = "open-mouse-learning-labels/1" as const;

/**
 * Why a photo is unusable, in Kirby's judgement. "other" needs a note.
 * These describe the photo, never the person: no health or injury reason.
 */
export const PHOTO_LABEL_REASONS = [
  "hand-off-sheet",
  "corner-hidden",
  "blur",
  "wrong-pose",
  "fingers-not-per-protocol",
  "lighting",
  "other",
] as const;

const photoLabelSchema = z
  .strictObject({
    file: z.string().min(1),
    /** Would Kirby keep this photo for measuring? `null` until labelled. */
    label: z.enum(["good", "bad"]).nullable(),
    reasons: z.array(z.enum(PHOTO_LABEL_REASONS)),
    note: z.string(),
  })
  .refine((l) => l.label === "bad" || l.reasons.length === 0, {
    message: "only a bad photo has reasons",
  })
  .refine((l) => !l.reasons.includes("other") || l.note.trim() !== "", {
    message: "reason 'other' needs a note",
  });

/**
 * `labels.json`, one per session: Kirby's own good/bad call on every photo.
 * The precision target (Kirby, 2026-10-02: no pass/fail threshold, aim for
 * 95 %) is how often the product's accept/retake verdict agrees with these
 * labels. So the labels must be made **blind**: without seeing the product's
 * verdict, the checker page or any mm value for that photo. `blind` records
 * that this was so; a labels file with `blind: false` is reported apart.
 */
export const labelsRecordSchema = z.strictObject({
  format: z.literal(LABELS_FORMAT),
  session: sessionId,
  protocol: z.literal(PROTOCOL_AGREED_V2),
  blind: z.boolean(),
  labels: z.array(photoLabelSchema),
});
export type LabelsRecord = z.infer<typeof labelsRecordSchema>;

/** The template the sorter writes: every filed photo, unlabelled, and no product verdict in sight. */
export function emptyLabelsRecord(
  session: string,
  files: readonly string[],
): LabelsRecord {
  return {
    format: LABELS_FORMAT,
    session,
    protocol: PROTOCOL_AGREED_V2,
    blind: true,
    labels: files.map((file) => ({ file, label: null, reasons: [], note: "" })),
  };
}
