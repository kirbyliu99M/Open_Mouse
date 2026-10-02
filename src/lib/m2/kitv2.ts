/**
 * The M2 evaluator for kit v2: protocol `agreed-v2`, format-3 run logs,
 * `participant.json` records, and no ruler truth. Pure. It never looks at a
 * photo.
 *
 * What it does, in order:
 *  1. Takes each photo's participant, pose, hand and shot from the run log's
 *     own assignment (`sort.photos[]`, matched to the report by `file`),
 *     never from a QR code on the photo.
 *  2. Decides which participants this run evaluates, by the held-out rule of
 *     the frozen prereg (src/lib/m2/heldout.ts): by default the calibration
 *     set, with held-out and S0 participants left out and said to be; held-out
 *     alone on request; S0 alone on request.
 *  3. Recomputes the millimetre values from the recorded landmarks, homography
 *     and parallax settings, on both planes (`measureDetailed`).
 *  4. Reports the headline, judgement correctness: how often the product's
 *     accept/retake verdict agrees with Kirby's blind good/bad labels
 *     (src/lib/m2/judgement.ts; target 95 %, a target and not a threshold);
 *     the prereg's per-person statistics (src/lib/m2/people.ts); the
 *     grip-threshold calibration (src/lib/m2/gripcal.ts); and the same
 *     field-by-field tables as candidate-v1, with accuracy absent.
 *
 * There is no ruler under agreed-v2, so the accuracy section is dormant:
 * nothing is computed and nothing errors. Results are worded as agreement
 * with the marker-sheet reference and retake repeatability, never accuracy.
 *
 * A photo that cannot be measured is listed with a reason code in `excluded`;
 * nothing is counted as zero. The report holds totals, anonymous participant
 * codes (P007) and photo ids of the form "P007/G02R/3", and no file name,
 * path, account name, EXIF or landmark.
 */
import type { Point2 } from "../../client/geometry/homography";
import { MEASUREMENT_DEFINITIONS } from "../contracts/measurement";
import {
  AGREED_V2_SEQUENCE,
  PROTOCOL_AGREED_V2,
  type LabelsRecord,
  type ParticipantRecord,
  type SessionRecord,
} from "../learning/session";
import type { Truth } from "../learning/truth";
import {
  ALL_PATHS,
  RAW_CALIBRATION,
  buildGroups,
  gateReasons,
  measureDetailed,
  photoQualityAccepted,
  type EvalGroup,
  type EvalPath,
  type EvaluateOptions,
  type ExclusionRow,
  type ExclusionSummaryRow,
  type Hand,
  type Observation,
  type PathResult,
  type PlaneReading,
  type Selection,
} from "./evaluate";
import {
  calibrateGrip,
  gripFromRatio,
  type GripCalibration,
  type GripClass,
  type GripSample,
} from "./gripcal";
import {
  HELD_OUT_SEED,
  classifyParticipants,
  type ParticipantRole,
} from "./heldout";
import {
  EvaluationInputError,
  cleanSessionText,
  type KitV2LogPhoto,
  type KitV2RunLog,
} from "./inputs";
import {
  buildLabelIndex,
  judge,
  type JudgedPhoto,
  type JudgementSection,
  type KnownPhoto,
} from "./judgement";
import {
  countByLabel,
  curlRatios,
  g02Repeatability,
  histogram,
  pathAgreement,
  poseRates,
  type CountRow,
  type CurlRatios,
  type G02Repeatability,
  type HandLengthBin,
  type PathAgreement,
  type PoseRate,
} from "./people";
import { assertNoTruthUnderAgreedV2, assertProtocolMatches } from "./protocol";
import { mean } from "./stats";
import type { Thresholds } from "./thresholds";

export const KIT_V2_EVALUATION_FORMAT = "open-mouse-m2-evaluation/2" as const;

/** The poses agreed-v2 photographs, from the contract's shooting order. */
export const KIT_V2_POSES: readonly string[] = AGREED_V2_SEQUENCE.map(
  (step) => step.gesture,
);
/** The flat, spread hand: its hand length is the one that is compared. */
export const FLAT_POSE = "G02";
/** The claw: its projected wrist-to-fingertip length gives the curl ratio. */
export const CLAW_POSE = "G04";
/** The pose the field-by-field tables show unless `--gesture` says otherwise (prereg: G02, not G01). */
export const DEFAULT_KIT_V2_GESTURES: readonly string[] = [FLAT_POSE];

export const ACCURACY_DORMANT_REASON = "no ruler truth";

export const HELD_OUT_NOTICE =
  "HELD-OUT EVALUATION: this is meant to be run ONCE, by Claude, after the model is frozen. Not from a workflow, and not again after the result has been seen: a second look turns the held-out set into a tuning set.";

/** What the field tables are held to under agreed-v2: nothing. The criteria live in the per-person section. */
const NO_LIMITS: Thresholds = {
  status:
    "agreed-v2: the criteria are frozen in the prereg of 2026-10-02; see the per-person statistics",
  accuracyMm: {},
  repeatabilityMm: {},
};

const ROLE_OF_SELECTION: Record<Selection, ParticipantRole> = {
  calibration: "calibration",
  "held-out": "held-out",
  s0: "s0",
};

// The landmarks of the two lengths, read from the product's own definitions so
// they cannot drift from it: hand length is `distance(0, 12)`, palm length
// `distance(0, 9)`.
function distanceIndices(
  field: "handLengthMm" | "palmLengthMm",
): readonly [number, number] {
  const m = /^distance\((\d+),\s*(\d+)\)$/.exec(MEASUREMENT_DEFINITIONS[field]);
  if (!m) {
    throw new Error(`${field} is no longer a distance between two landmarks.`);
  }
  return [Number(m[1]), Number(m[2])];
}
export const HAND_LENGTH_LANDMARKS = distanceIndices("handLengthMm");
export const PALM_LENGTH_LANDMARKS = distanceIndices("palmLengthMm");

const between = (
  points: readonly Point2[],
  [a, b]: readonly [number, number],
) => Math.hypot(points[a]!.x - points[b]!.x, points[a]!.y - points[b]!.y);

// ── Types ───────────────────────────────────────────────────────────────────

export interface KitV2Input {
  readonly logs: readonly KitV2RunLog[];
  /** Must be empty: agreed-v2 has no ruler truth. A file given anyway is an error that says why. */
  readonly truths?: readonly Truth[];
  /** `participant.json` records: the grip a person reports and the hand they use. */
  readonly records?: readonly ParticipantRecord[];
  /** `session.json` records, for the phone (a log may embed it instead). */
  readonly sessions?: readonly SessionRecord[];
  /** `labels.json` records: Kirby's blind good/bad call on each photo of a session. */
  readonly labels?: readonly LabelsRecord[];
}

/** One photo of G02 or G04, as the per-person statistics see it. */
export interface KitV2Photo {
  readonly participant: string;
  readonly gesture: string;
  readonly hand: Hand | null;
  readonly phone: string | null;
  /** The session's `light`, as typed (cleaned): coverage by light. */
  readonly light: string | null;
  readonly sheet: string | null;
  readonly extraShot: boolean;
  /** The product's own gates would take it. */
  readonly accepted: boolean;
  readonly handDetected: boolean;
  readonly handLabel: "agrees" | "differs" | null;
  /** Hand length through the marker plane, after the model's correction; `null` when not measured there. */
  readonly markerHandMm: number | null;
  /** Hand length through the paper-edge plane, after the model's correction. */
  readonly paperHandMm: number | null;
  /** Marker plane, no correction: hand and palm length. `null` outside the contract's ranges (a claw can be). */
  readonly rawHandMm: number | null;
  readonly rawPalmMm: number | null;
  /** Marker plane, no correction: wrist to middle fingertip, from the landmarks themselves. Defined for a claw too. */
  readonly projectedMm: number | null;
}

export interface PersonRow {
  readonly participant: string;
  readonly hand: Hand | null;
  readonly g02: {
    readonly photos: number;
    readonly meanHandLengthMm: number | null;
    readonly sdMm: number | null;
  };
  /** Mean of paper-edge minus marker hand length over the person's G02 photos. */
  readonly pathDifference: {
    readonly photos: number;
    readonly meanMm: number | null;
  };
  readonly curl: {
    readonly photos: number;
    readonly meanRatio: number | null;
    readonly sdRatio: number | null;
  };
  /** What the participant record says: palm, claw, fingertip, unsure; `null` when it is blank; `"no-record"` without a record. */
  readonly gripSelf: GripClass | "unsure" | "no-record" | null;
  /** The person's mean palm length / hand length over G02, marker plane. */
  readonly gripRatio: number | null;
  readonly gripPredicted: GripClass | null;
}

export interface KitV2Section {
  /**
   * The headline (frozen prereg version 2): how often the product's
   * accept/retake verdict agrees with Kirby's blind good/bad label. The target
   * is 95 %, shown as a target and never as a pass or fail.
   */
  readonly judgement: JudgementSection;
  readonly poses: readonly string[];
  /** The reference: the marker plane of the same sheet. Not a ruler. */
  readonly reference: "marker plane";
  /** Hand length, marker path, G02: the prereg's activated criterion. */
  readonly repeatability: G02Repeatability;
  /** Paper-edge minus marker hand length, G02. */
  readonly pathAgreement: PathAgreement;
  readonly curl: CurlRatios;
  readonly gate: {
    readonly poses: readonly PoseRate[];
    /** Photos shot beyond the planned count and logged. */
    readonly extraShots: number;
  };
  readonly coverage: {
    readonly people: number;
    readonly photos: number;
    /** People by the 10 mm bin of their mean G02 marker hand length. */
    readonly handLengthBins: readonly HandLengthBin[];
    readonly peopleWithHandLength: number;
    readonly byPhone: readonly CountRow[];
    /** By the session's `light`, as typed. */
    readonly byLight: readonly CountRow[];
    readonly bySheet: readonly CountRow[];
    readonly byMouseHand: readonly CountRow[];
  };
  readonly grip: {
    /** The plane the ratio is taken on. */
    readonly path: "markers";
    /** People in the calibration: a stated grip (palm, claw, fingertip) and a G02 ratio. */
    readonly people: number;
    readonly skipped: {
      readonly unsure: number;
      readonly noAnswer: number;
      readonly noRecord: number;
      readonly noG02: number;
    };
    readonly calibration: GripCalibration | null;
  };
  /** One row per person. Emptied by `--aggregate-only`. */
  readonly people: readonly PersonRow[];
}

export interface SelectionSummary {
  readonly mode: Selection;
  readonly seed: string;
  /** Participants seen in the inputs (in a run log's sort or a participant record). */
  readonly known: number;
  /** All of them, by role under the held-out rule. */
  readonly roles: Readonly<Record<ParticipantRole, number>>;
  /** Participants in the chosen set, before `--participants` narrows it. */
  readonly inSet: number;
  /** Photos left out of this run, by why. The chosen set's own role stays 0. */
  readonly leftOutPhotos: Readonly<
    Record<ParticipantRole | "notRequested", number>
  >;
  /** Participants asked for with `--participants` that are not in the chosen set. Emptied by `--aggregate-only`. */
  readonly requestedOutsideSet: readonly string[];
  readonly requestedOutsideSetCount: number;
}

export interface KitV2Report {
  readonly format: typeof KIT_V2_EVALUATION_FORMAT;
  readonly protocol: typeof PROTOCOL_AGREED_V2;
  /** The measurement model judged (`landmark-raw-v1` for the baseline). */
  readonly model: string;
  readonly createdAt: string;
  /** Things the reader must not miss (a held-out run is meant to happen once). */
  readonly notices: readonly string[];
  /** Always dormant: there is no ruler truth, so no accuracy is computed. */
  readonly accuracy: {
    readonly status: "dormant";
    readonly reason: typeof ACCURACY_DORMANT_REASON;
  };
  readonly options: {
    readonly paths: readonly EvalPath[];
    /** The poses of the field-by-field tables. The per-person statistics always use G02 and G04. */
    readonly gestures: readonly string[];
    readonly participants: readonly string[] | null;
    readonly participantCount: number | null;
    readonly selection: Selection;
  };
  readonly selection: SelectionSummary;
  readonly inputs: {
    readonly runLogs: readonly {
      readonly kitVersion: number;
      readonly gitSha: string | null;
      readonly gitDirty: boolean | null;
      readonly paperSize: string;
      readonly reports: number;
      readonly session: string | null;
      readonly sheet: string | null;
    }[];
    readonly participantRecords: number;
    readonly sessionRecords: number;
    readonly labelsFiles: number;
    /** Codes of the participants with at least one measured photo. Emptied by `--aggregate-only`. */
    readonly participants: readonly string[];
    readonly participantCount: number;
  };
  readonly counts: {
    readonly reports: number;
    /** Always 0: no card is photographed on its own under agreed-v2 (the card sits in each photo). */
    readonly cards: number;
    /** Photos of participants outside this run's set, or of poses outside G02, G04 and `--gesture`. */
    readonly outOfScope: number;
    /** In scope, but no plane gave landmarks for them. */
    readonly notMeasured: number;
    /** In scope, and at least one plane gave landmarks. */
    readonly measured: number;
  };
  /** The same field-by-field tables as candidate-v1, for the poses of `--gesture`; accuracy is absent. */
  readonly groups: Readonly<
    Record<EvalGroup, Readonly<Partial<Record<EvalPath, PathResult>>>>
  >;
  readonly kitV2: KitV2Section;
  readonly excluded: readonly ExclusionRow[];
  readonly aggregateOnly: boolean;
  readonly excludedSummary?: readonly ExclusionSummaryRow[];
}

// ── The per-person section ──────────────────────────────────────────────────

const distinct = <T>(values: readonly (T | null)[]): T[] => [
  ...new Set(values.filter((v): v is T => v !== null)),
];

/** One label for a person from the labels of their photos: the one they all share, "(several)" if they differ, "unknown" if none. */
function labelOf(values: readonly (string | null)[]): string {
  const labels = distinct(values.map((v) => v?.trim() || null));
  if (labels.length === 0) return "unknown";
  return labels.length === 1 ? labels[0]! : "(several)";
}

/**
 * Every statistic of the agreed-v2 section, from the photos of G02 and G04
 * and the participant records. People first: each statistic over people is
 * taken over each person's own mean, never over photos as if independent.
 * A participant with photos of both hands is left out of the person-level
 * statistics (and listed), since their photos are not repeats of one thing.
 */
export function buildKitV2Section(
  photos: readonly KitV2Photo[],
  records: ReadonlyMap<string, ParticipantRecord>,
): { section: Omit<KitV2Section, "judgement">; excluded: ExclusionRow[] } {
  const excluded: ExclusionRow[] = [];
  const byPerson = new Map<string, KitV2Photo[]>();
  for (const p of photos) {
    byPerson.set(p.participant, [...(byPerson.get(p.participant) ?? []), p]);
  }
  const ids = [...byPerson.keys()].sort();

  interface Person {
    readonly id: string;
    readonly photos: readonly KitV2Photo[];
    readonly hand: Hand | null;
    readonly mixed: boolean;
  }
  const people: Person[] = ids.map((id) => {
    const ps = byPerson.get(id)!;
    const hands = distinct(ps.map((p) => p.hand));
    const mixed = hands.length > 1;
    if (mixed) {
      excluded.push({
        id,
        stage: "person",
        path: null,
        field: null,
        reasons: ["MIXED_HANDS"],
      });
    }
    return {
      id,
      photos: ps,
      hand: mixed ? null : (records.get(id)?.mouseHand ?? hands[0] ?? null),
      mixed,
    };
  });
  const stat = people.filter((p) => !p.mixed);

  const numbers = (xs: readonly (number | null)[]): number[] =>
    xs.filter((x): x is number => x !== null);
  const flat = (p: Person) => p.photos.filter((x) => x.gesture === FLAT_POSE);
  const claw = (p: Person) => p.photos.filter((x) => x.gesture === CLAW_POSE);

  const repeatability = g02Repeatability(
    stat.map((p) => ({
      participant: p.id,
      values: numbers(flat(p).map((x) => x.markerHandMm)),
    })),
  );
  const agreement = pathAgreement(
    stat.map((p) => ({
      participant: p.id,
      differences: flat(p).flatMap((x) =>
        x.markerHandMm !== null && x.paperHandMm !== null
          ? [x.paperHandMm - x.markerHandMm]
          : [],
      ),
    })),
  );
  const curl = curlRatios(
    stat.map((p) => ({
      participant: p.id,
      g02LengthsMm: numbers(flat(p).map((x) => x.rawHandMm)),
      g04ProjectedMm: numbers(claw(p).map((x) => x.projectedMm)),
    })),
  );

  // Grip: a stated grip against r = palm length / hand length, the person's
  // mean over G02 on the marker plane.
  const gripRatioOf = (p: Person): number | null => {
    const ratios = flat(p).flatMap((x) =>
      x.rawHandMm !== null && x.rawPalmMm !== null
        ? [x.rawPalmMm / x.rawHandMm]
        : [],
    );
    return ratios.length === 0 ? null : mean(ratios);
  };
  const samples: GripSample[] = [];
  const skipped = { unsure: 0, noAnswer: 0, noRecord: 0, noG02: 0 };
  for (const p of stat) {
    const record = records.get(p.id);
    if (record === undefined) {
      skipped.noRecord++;
      continue;
    }
    if (record.gripSelf === null) {
      skipped.noAnswer++;
      continue;
    }
    if (record.gripSelf === "unsure") {
      skipped.unsure++;
      continue;
    }
    const ratio = gripRatioOf(p);
    if (ratio === null) {
      skipped.noG02++;
      continue;
    }
    samples.push({ participant: p.id, self: record.gripSelf, ratio });
  }
  const calibration = calibrateGrip(samples);
  const predicted = new Map<string, GripClass>();
  if (calibration) {
    // The grip each person gets from the product's CURRENT thresholds.
    for (const s of samples) {
      predicted.set(
        s.participant,
        gripFromRatio(s.ratio, calibration.current.thresholds),
      );
    }
  }

  const rowOf = (p: Person): PersonRow => {
    const lengths = numbers(flat(p).map((x) => x.markerHandMm));
    const record = records.get(p.id);
    const diff = agreement.rows.find((r) => r.participant === p.id);
    const curlRow = curl.rows.find((r) => r.participant === p.id);
    const repeat = repeatability.rows.find((r) => r.participant === p.id);
    const ratio = gripRatioOf(p);
    return {
      participant: p.id,
      hand: p.hand,
      g02: {
        photos: lengths.length,
        meanHandLengthMm: lengths.length === 0 ? null : mean(lengths),
        sdMm: repeat?.sdMm ?? null,
      },
      pathDifference: {
        photos: diff?.photos ?? 0,
        meanMm: diff?.meanDifferenceMm ?? null,
      },
      curl: {
        photos: curlRow?.g04Photos ?? 0,
        meanRatio: curlRow?.meanRatio ?? null,
        sdRatio: curlRow?.sdRatio ?? null,
      },
      gripSelf: record === undefined ? "no-record" : record.gripSelf,
      gripRatio: ratio,
      gripPredicted: predicted.get(p.id) ?? null,
    };
  };

  // Coverage counts everybody who has a photo, mixed hands included.
  const handLabel = (p: Person): string => {
    if (p.mixed) return "(both)";
    return p.hand ?? "unknown";
  };
  const items = (label: (p: Person) => string) =>
    countByLabel(
      people.map((p) => ({ label: label(p), photos: p.photos.length })),
    );
  const meansOfLength = stat.flatMap((p) => {
    const lengths = numbers(flat(p).map((x) => x.markerHandMm));
    return lengths.length === 0 ? [] : [mean(lengths)];
  });

  const section: Omit<KitV2Section, "judgement"> = {
    poses: KIT_V2_POSES,
    reference: "marker plane",
    repeatability,
    pathAgreement: agreement,
    curl,
    gate: {
      poses: poseRates(photos, KIT_V2_POSES),
      extraShots: photos.filter((p) => p.extraShot).length,
    },
    coverage: {
      people: people.length,
      photos: photos.length,
      handLengthBins: histogram(meansOfLength),
      peopleWithHandLength: meansOfLength.length,
      byPhone: items((p) => labelOf(p.photos.map((x) => x.phone))),
      byLight: items((p) => labelOf(p.photos.map((x) => x.light))),
      bySheet: items((p) => labelOf(p.photos.map((x) => x.sheet))),
      byMouseHand: items(handLabel),
    },
    grip: {
      path: "markers",
      people: samples.length,
      skipped,
      calibration,
    },
    people: stat.map(rowOf),
  };
  return { section, excluded };
}

// ── The run ─────────────────────────────────────────────────────────────────

const handLetter = (hand: Hand | null) =>
  hand === "right" ? "R" : hand === "left" ? "L" : "?";

/** Phone and sheet of a session, from the log itself and the session records given. */
function sessionOf(
  log: KitV2RunLog,
  sessions: ReadonlyMap<string, SessionRecord>,
): {
  id: string | null;
  phone: string | null;
  light: string | null;
  sheet: string | null;
} {
  const record =
    log.sessionId === null ? undefined : sessions.get(log.sessionId);
  const phone = cleanSessionText(log.embeddedPhone ?? record?.phone ?? "");
  const light = cleanSessionText(log.embeddedLight ?? record?.light ?? "");
  return {
    id: log.sessionId,
    phone: phone === "" ? null : phone,
    light: light === "" ? null : light,
    sheet: log.sheet ?? record?.sheet ?? null,
  };
}

export function evaluateKitV2(
  input: KitV2Input,
  options: EvaluateOptions = {},
): KitV2Report {
  assertProtocolMatches(PROTOCOL_AGREED_V2, options.protocol);
  assertNoTruthUnderAgreedV2(input.truths ?? []);
  if (options.thresholds !== undefined) {
    throw new EvaluationInputError(
      "Limits cannot be set for agreed-v2: its criteria are frozen in the prereg of 2026-10-02.",
    );
  }
  const paths = options.paths ?? ALL_PATHS;
  if (paths.length === 0) {
    throw new EvaluationInputError("Choose at least one path to evaluate.");
  }
  const gestures = options.gestures ?? DEFAULT_KIT_V2_GESTURES;
  const selection = options.selection ?? "calibration";
  const calibration = options.calibration ?? RAW_CALIBRATION;
  const requested = options.participants ? new Set(options.participants) : null;

  const records = new Map<string, ParticipantRecord>();
  for (const r of input.records ?? []) {
    if (records.has(r.participant)) {
      throw new EvaluationInputError(
        `Two participant records are for participant ${r.participant}.`,
      );
    }
    records.set(r.participant, r);
  }
  const sessions = new Map<string, SessionRecord>();
  for (const s of input.sessions ?? []) {
    if (sessions.has(s.session)) {
      throw new EvaluationInputError(
        `Two session records are for session ${s.session}.`,
      );
    }
    sessions.set(s.session, s);
  }

  // Kirby's labels, by session (a session or a photo labelled twice is an error).
  const labelIndex = buildLabelIndex(input.labels ?? []);

  // Who is in the inputs, and what the held-out rule makes of each.
  const known = new Set<string>(records.keys());
  for (const log of input.logs) {
    for (const p of log.sort.photos) {
      if (p.participant !== null) known.add(p.participant);
    }
  }
  const roles = classifyParticipants(known);
  const roleOf = (id: string): ParticipantRole => roles.get(id) ?? "unnumbered";
  const modeRole = ROLE_OF_SELECTION[selection];
  const inSet = (id: string) => roleOf(id) === modeRole;
  const evaluated = (id: string) =>
    inSet(id) && (requested === null || requested.has(id));

  const poseScope = new Set<string>([...gestures, ...KIT_V2_POSES]);
  const leftOutPhotos: Record<ParticipantRole | "notRequested", number> = {
    "held-out": 0,
    calibration: 0,
    s0: 0,
    pending: 0,
    unnumbered: 0,
    notRequested: 0,
  };

  const excluded: ExclusionRow[] = [];
  const observations: Observation[] = [];
  const photos: KitV2Photo[] = [];
  // For judgement correctness: the photos of the evaluated participants in
  // G02 and G04, and every photo the logs assign (the ones a label may name).
  const judged: JudgedPhoto[] = [];
  const knownPhotos: KnownPhoto[] = [];
  // Photos the sorter did not file (no destination) and participants it put in
  // review, for evaluated participants: counted by its status and reason.
  const notFiledByStatus: Record<string, number> = {};
  const reviewOf = new Map<string, string>();
  const plainWord = (word: string | null) =>
    word !== null && /^[a-z-]{1,40}$/.test(word) ? word : "other";
  const measuredParticipants = new Set<string>();
  const assignedTo = new Set<string>();
  let reportCount = 0;
  let outOfScope = 0;
  let notMeasured = 0;
  let measured = 0;

  input.logs.forEach((log, logIndex) => {
    const session = sessionOf(log, sessions);
    for (const p of log.sort.participants) {
      if (p.status === "needs-review" && evaluated(p.participant)) {
        reviewOf.set(p.participant, plainWord(p.reason));
      }
    }
    const byFile = new Map<string, KitV2LogPhoto[]>();
    for (const p of log.sort.photos) {
      byFile.set(p.file, [...(byFile.get(p.file) ?? []), p]);
    }
    const seenFiles = new Map<string, number>();
    for (const r of log.reports) {
      seenFiles.set(r.file, (seenFiles.get(r.file) ?? 0) + 1);
    }

    log.reports.forEach((report, reportIndex) => {
      reportCount++;
      const anonymous = `run${logIndex + 1}#${reportIndex + 1}`;
      const matches = byFile.get(report.file) ?? [];
      // A file name that appears twice cannot be told apart: refuse to guess.
      if (matches.length !== 1 || seenFiles.get(report.file) !== 1) {
        notMeasured++;
        excluded.push({
          id: anonymous,
          stage: "measurement",
          path: null,
          field: null,
          reasons: [
            matches.length === 0 ? "NOT_IN_SORT" : "AMBIGUOUS_FILE_NAME",
          ],
        });
        return;
      }
      // Participant, pose, hand and shot come from the assignment, never from
      // the photo's QR code (it is the participant's card, not a pose).
      const a = matches[0]!;
      // A label may name this photo (by its `destination`), whoever it belongs to.
      knownPhotos.push({ session: log.sessionId, destination: a.destination });

      // Scope: participants this run evaluates, then poses.
      if (a.participant !== null && !evaluated(a.participant)) {
        if (!inSet(a.participant)) leftOutPhotos[roleOf(a.participant)]++;
        else leftOutPhotos.notRequested++;
        outOfScope++;
        return;
      }
      if (a.participant !== null && a.destination === null) {
        const status = plainWord(a.status);
        notFiledByStatus[status] = (notFiledByStatus[status] ?? 0) + 1;
      }
      if (a.gesture !== null && !poseScope.has(a.gesture)) {
        outOfScope++;
        return;
      }
      if (a.participant === null || a.gesture === null) {
        notMeasured++;
        excluded.push({
          id: anonymous,
          stage: "measurement",
          path: null,
          field: null,
          // The sorter's own status (`needs-review`, `no-code`...) says why, when it is a plain word.
          reasons: [
            /^[a-z-]{1,30}$/.test(a.status)
              ? `NOT_ASSIGNED:${a.status}`
              : "NOT_ASSIGNED",
          ],
        });
        return;
      }
      const participant = a.participant;
      const gesture = a.gesture;
      const hand = a.hand;
      const id = `${participant}/${gesture}${handLetter(hand)}/${a.shot ?? "?"}${a.extraShot ? "+" : ""}`;
      if (a.shot !== null) {
        // The same participant, pose and shot twice (two runs over one folder): the first counts.
        const destination = `${participant}/${gesture}/${a.shot}`;
        if (assignedTo.has(destination)) {
          notMeasured++;
          excluded.push({
            id: `${id}@run${logIndex + 1}`,
            stage: "measurement",
            path: null,
            field: null,
            reasons: ["DUPLICATE_ASSIGNMENT"],
          });
          return;
        }
        assignedTo.add(destination);
      }

      const read = {} as Record<EvalPath, PlaneReading>;
      for (const path of ALL_PATHS) {
        read[path] = measureDetailed(report, path, hand, calibration);
      }
      const gateCodes = gateReasons(report);
      const retake = report.verdict === "retake";

      if (KIT_V2_POSES.includes(gesture)) {
        // Judgement correctness takes the photo-quality gates only: the
        // handedness gate is left out (see `photoQualityAccepted`).
        const quality = photoQualityAccepted(report);
        judged.push({
          session: log.sessionId,
          destination: a.destination,
          gesture,
          accepted: quality.accepted,
          hasGateRecord: quality.hasRecord,
        });
        const detected = report.hand?.handedness ?? null;
        const markerPoints = read.markers.points;
        photos.push({
          participant,
          gesture,
          hand,
          phone: session.phone,
          light: session.light,
          sheet: session.sheet,
          extraShot: a.extraShot,
          accepted: gateCodes.length === 0,
          handDetected: report.hand != null,
          handLabel:
            (detected !== "left" && detected !== "right") || hand === null
              ? null
              : detected === hand
                ? "agrees"
                : "differs",
          markerHandMm: read.markers.values?.handLengthMm ?? null,
          paperHandMm: read["paper-edge"].values?.handLengthMm ?? null,
          rawHandMm: read.markers.raw?.handLengthMm ?? null,
          rawPalmMm: read.markers.raw?.palmLengthMm ?? null,
          projectedMm: markerPoints
            ? between(markerPoints, HAND_LENGTH_LANDMARKS)
            : null,
        });
      }

      // Why a plane gave nothing, for the poses and planes that matter: the
      // field tables' own (poses and paths asked for), everything for the flat
      // pose (it is the reference), and for a claw only the cases where no
      // landmarks came out (its field values are not used).
      for (const path of ALL_PATHS) {
        const r = read[path];
        if (r.reason === null) continue;
        const reportable =
          (gestures.includes(gesture) && paths.includes(path)) ||
          gesture === FLAT_POSE ||
          (gesture === CLAW_POSE && r.points === null);
        if (reportable) {
          excluded.push({
            id,
            stage: "measurement",
            path,
            field: null,
            reasons: [r.reason],
          });
        }
      }

      if (!ALL_PATHS.some((path) => read[path].points !== null)) {
        notMeasured++;
        return;
      }
      measured++;
      measuredParticipants.add(participant);

      if (retake) {
        const bad = [
          ...new Set(
            report.checks.filter((c) => c.tone === "bad").map((c) => c.id),
          ),
        ];
        excluded.push({
          id,
          stage: "kit",
          path: null,
          field: null,
          reasons: (bad.length > 0 ? bad : ["unspecified"]).map(
            (c) => `KIT_RETAKE:${c}`,
          ),
        });
      }
      if (gateCodes.length > 0) {
        excluded.push({
          id,
          stage: "product",
          path: null,
          field: null,
          reasons: gateCodes,
        });
      }

      if (gestures.includes(gesture)) {
        const values: Partial<Record<EvalPath, Record<string, number>>> = {};
        for (const path of paths) {
          const v = read[path].values;
          if (v !== null) values[path] = v;
        }
        if (Object.keys(values).length > 0) {
          observations.push({
            id,
            participant,
            gesture,
            hand,
            // A retake photo is never in the accepted group, whatever the
            // product's gates say: the kit's own checker refused it.
            accepted: gateCodes.length === 0 && !retake,
            measured: values,
          });
        }
      }
    });
  });

  const { section: people, excluded: personRows } = buildKitV2Section(
    photos,
    records,
  );
  const section: KitV2Section = {
    ...people,
    judgement: judge({
      photos: judged,
      known: knownPhotos,
      labels: labelIndex,
      poses: KIT_V2_POSES,
      notFiledByStatus,
      reviewByReason: [...reviewOf.values()].reduce<Record<string, number>>(
        (acc, reason) => ({ ...acc, [reason]: (acc[reason] ?? 0) + 1 }),
        {},
      ),
    }),
  };
  excluded.push(...personRows);
  excluded.sort(
    (a, b) =>
      a.id.localeCompare(b.id) ||
      a.stage.localeCompare(b.stage) ||
      (a.path ?? "").localeCompare(b.path ?? "") ||
      (a.field ?? "").localeCompare(b.field ?? ""),
  );

  const groups = buildGroups({
    observations,
    paths,
    thresholds: NO_LIMITS,
    truthOf: null,
  });

  const roleCounts: Record<ParticipantRole, number> = {
    "held-out": 0,
    calibration: 0,
    s0: 0,
    pending: 0,
    unnumbered: 0,
  };
  for (const id of known) roleCounts[roleOf(id)]++;
  const outside = requested
    ? [...requested].filter((id) => !inSet(id)).sort()
    : [];
  const participants = [...measuredParticipants].sort();

  return {
    format: KIT_V2_EVALUATION_FORMAT,
    protocol: PROTOCOL_AGREED_V2,
    model: calibration.name,
    createdAt: (options.now ?? new Date()).toISOString(),
    notices: selection === "held-out" ? [HELD_OUT_NOTICE] : [],
    accuracy: { status: "dormant", reason: ACCURACY_DORMANT_REASON },
    options: {
      paths: [...paths],
      gestures: [...gestures],
      participants: options.participants ? [...options.participants] : null,
      participantCount: options.participants
        ? options.participants.length
        : null,
      selection,
    },
    selection: {
      mode: selection,
      seed: HELD_OUT_SEED,
      known: known.size,
      roles: roleCounts,
      inSet: roleCounts[modeRole],
      leftOutPhotos,
      requestedOutsideSet: outside,
      requestedOutsideSetCount: outside.length,
    },
    inputs: {
      runLogs: input.logs.map((log) => ({
        kitVersion: log.kitVersion,
        gitSha: log.gitSha,
        gitDirty: log.gitDirty,
        paperSize: log.paperSize,
        reports: log.reports.length,
        session: log.sessionId,
        sheet: log.sheet,
      })),
      participantRecords: records.size,
      sessionRecords: sessions.size,
      labelsFiles: labelIndex.size,
      participants,
      participantCount: participants.length,
    },
    counts: {
      reports: reportCount,
      cards: 0,
      outOfScope,
      notMeasured,
      measured,
    },
    groups,
    kitV2: section,
    excluded,
    aggregateOnly: false,
  };
}
