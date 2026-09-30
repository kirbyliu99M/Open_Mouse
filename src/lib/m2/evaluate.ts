/**
 * The M2 evaluator: how good is a measurement model, judged only from v2 run
 * logs and `truth.json` files. Pure. It never looks at a photo.
 *
 * What it does, in order:
 *  1. Pairs every report with its place in the session (participant, pose,
 *     hand, shot) through the log's own `sort`.
 *  2. Works the millimetre values out again with `recomputePlane`, from the
 *     recorded landmarks, homography and parallax settings.
 *  3. Asks the recorded `productGates` whether the product would have taken
 *     the photo, and reports two groups: the photos it accepts, and all.
 *  4. Compares each measurement with the ruler value of the SAME hand of the
 *     SAME participant (left and right are never mixed).
 *  5. Computes accuracy and repeatability (src/lib/m2/stats.ts) per path.
 *
 * A photo that cannot be measured or compared is listed with a reason code in
 * `excluded`; nothing is ever counted as zero. The report holds totals, an
 * anonymous participant code (P007) and photo ids of the form
 * "P007/G01R/3", and no path, account name, EXIF or landmark.
 *
 * Everything the M2 gate might be judged by is reported and none is chosen:
 * the limits are candidates (src/lib/m2/thresholds.ts).
 */
import {
  MEASUREMENT_MODEL_VERSION,
  type HandMeasurements,
} from "../contracts/measurement";
import { recomputePlane } from "../learning/plane";
import type { LearningPhotoReport } from "../learning/report";
import type { LearningRunLog } from "../learning/runlog";
import { emptyTruth, type Truth } from "../learning/truth";
import { EvaluationInputError, parseRunLog, parseTruth } from "./inputs";
import {
  accuracyStats,
  repeatabilityRow,
  summariseRepeatability,
  type AccuracyStats,
  type RepeatabilityRow,
  type RepeatabilitySummary,
} from "./stats";
import {
  CANDIDATE_THRESHOLDS,
  accuracyReadings,
  repeatabilityReadings,
  type Reading,
  type Thresholds,
} from "./thresholds";

export const EVALUATION_FORMAT = "open-mouse-m2-evaluation/1" as const;

/** The calibration planes a measurement can come from. */
export type EvalPath = "markers" | "paper-edge";
export const ALL_PATHS: readonly EvalPath[] = ["markers", "paper-edge"];

/** "accepted": photos the product's own gates take. "all": every photo that was measured. */
export type EvalGroup = "accepted" | "all";

type Hand = "left" | "right";

/**
 * A correction applied to the recomputed measurements. The baseline,
 * `landmark-raw-v1`, changes nothing. The frozen `calibrated-v1` plugs in
 * here later, so the same evaluator judges both.
 */
export interface Calibration {
  readonly name: string;
  readonly apply: (
    measurements: HandMeasurements,
    context: { readonly path: EvalPath; readonly hand: Hand },
  ) => HandMeasurements;
}

export const RAW_CALIBRATION: Calibration = {
  name: MEASUREMENT_MODEL_VERSION,
  apply: (measurements) => measurements,
};

export interface EvaluateOptions {
  /** Which planes to evaluate. Default: both. */
  readonly paths?: readonly EvalPath[];
  /** Poses to evaluate, "G01" style. Default: G01, the pose the M2 gate is defined on. */
  readonly gestures?: readonly string[];
  /** Only these participants (for cross-validation folds or a held-out set); default all. */
  readonly participants?: readonly string[] | null;
  readonly thresholds?: Thresholds;
  readonly calibration?: Calibration;
  readonly now?: Date;
}

export interface EvaluationInput {
  readonly logs: readonly LearningRunLog[];
  readonly truths: readonly Truth[];
}

export interface ExclusionRow {
  /** "P007/G01R/3": participant, pose and hand as printed on the page, shot number. Not a file name. */
  readonly id: string;
  /**
   *  - measurement: the photo could not be measured on this path (or at all).
   *  - truth: it was measured but has no ruler value to be compared with.
   *  - product: it was measured, and the product's gates would refuse it, so
   *    it is out of the "accepted" group but stays in "all".
   *  - kit: it was measured, and the kit's own checker said to retake it
   *    (`KIT_RETAKE:<check id>`), so it is out of "accepted" and stays in "all".
   */
  readonly stage: "measurement" | "truth" | "product" | "kit";
  readonly path: EvalPath | null;
  readonly field: string | null;
  readonly reasons: readonly string[];
}

export interface RepeatabilityRowOut extends RepeatabilityRow {
  readonly participant: string;
  readonly hand: Hand;
  readonly gesture: string;
}

export interface FieldResult {
  readonly accuracy: {
    readonly stats: AccuracyStats | null;
    readonly readings: readonly Reading[];
  };
  readonly repeatability: {
    /** One row per participant, hand and pose with at least two photos. */
    readonly rows: readonly RepeatabilityRowOut[];
    readonly summary: RepeatabilitySummary | null;
    readonly readings: readonly Reading[];
  };
}

export interface PathResult {
  /** Photos measured on this path in this group. */
  readonly photos: number;
  readonly fields: Readonly<Record<string, FieldResult>>;
}

export interface EvaluationReport {
  readonly format: typeof EVALUATION_FORMAT;
  /** The measurement model judged (`landmark-raw-v1` for the baseline). */
  readonly model: string;
  readonly createdAt: string;
  readonly thresholds: Thresholds;
  readonly options: {
    readonly paths: readonly EvalPath[];
    readonly gestures: readonly string[];
    /** `null` = everyone in the logs. */
    readonly participants: readonly string[] | null;
  };
  readonly inputs: {
    readonly runLogs: readonly {
      readonly kitVersion: number;
      readonly gitSha: string | null;
      readonly gitDirty: boolean | null;
      readonly paperSize: string;
      readonly reports: number;
    }[];
    readonly truthFiles: number;
    /** Anonymous codes of the participants that had at least one photo evaluated. */
    readonly participants: readonly string[];
  };
  readonly counts: {
    readonly reports: number;
    /** Participant cards: not hand photos, so neither measured nor excluded. */
    readonly cards: number;
    /** Filed photos of other poses or other participants than selected. */
    readonly outOfScope: number;
    /** In scope, but measured on no selected path. */
    readonly notMeasured: number;
    /** Measured on at least one selected path. */
    readonly measured: number;
  };
  readonly groups: Readonly<
    Record<EvalGroup, Readonly<Partial<Record<EvalPath, PathResult>>>>
  >;
  readonly excluded: readonly ExclusionRow[];
}

/** The measurements a truth file can hold, from the truth format itself. */
const FIELDS: readonly string[] = Object.keys(emptyTruth("P000").right);

const handLetter = (hand: Hand) => (hand === "right" ? "R" : "L");

interface Observation {
  readonly id: string;
  readonly participant: string;
  readonly gesture: string;
  readonly hand: Hand;
  readonly accepted: boolean;
  readonly measured: Partial<
    Record<EvalPath, Readonly<Record<string, number>>>
  >;
}

/** Why the product's gates refuse a photo, as codes; empty when it accepts. */
function gateReasons(report: LearningPhotoReport): string[] {
  const gates = report.productGates;
  if (!gates) return ["NO_PRODUCT_GATES"];
  if (gates.accepted) return [];
  const reasons = [
    ...gates.paper.errorCodes.map((c) => `paper:${c}`),
    ...(gates.hand
      ? gates.hand.errorCodes.map((c) => `hand:${c}`)
      : ["hand:NOT_REACHED"]),
  ];
  return reasons.length > 0 ? reasons : ["NOT_ACCEPTED"];
}

/**
 * A photo the checker said to retake, when its record still says which page it
 * was and who it belongs to: the sort files nothing for it (its QR code is
 * dropped), so the page's code comes from the report. `null` when it cannot be
 * placed (no readable code, a code of another kit version, no participant card
 * before it), which leaves it `NOT_FILED`.
 */
function retakeOf(
  report: LearningPhotoReport,
  sorted: { readonly status: string; readonly participant: string | null },
  kitVersion: number,
): { gesture: string; hand: Hand; reasons: string[] } | null {
  if (report.verdict !== "retake" || sorted.status !== "no-code") return null;
  if (sorted.participant === null) return null;
  const code = report.code;
  if (!code || code.kind !== "gesture" || code.version !== kitVersion) {
    return null;
  }
  const bad = [
    ...new Set(report.checks.filter((c) => c.tone === "bad").map((c) => c.id)),
  ];
  return {
    gesture: code.gesture,
    hand: code.hand,
    reasons: (bad.length > 0 ? bad : ["unspecified"]).map(
      (id) => `KIT_RETAKE:${id}`,
    ),
  };
}

/** Recompute one path's measurements from the record alone. */
function measure(
  report: LearningPhotoReport,
  path: EvalPath,
  hand: Hand,
  calibration: Calibration,
): { values: Record<string, number> } | { reason: string } {
  const plane = path === "markers" ? report.markerPlane : report.paperPlane;
  if (!plane || plane.method !== path) return { reason: "NO_PLANE" };
  if (!report.hand) return { reason: "NO_HAND" };
  let recomputed;
  try {
    recomputed = recomputePlane(report.hand.landmarksPx, plane);
  } catch {
    return { reason: "RECOMPUTE_FAILED" };
  }
  if (!recomputed.measurements) return { reason: "NO_MEASUREMENT" };
  const finiteFields = (m: unknown): Record<string, number> | null => {
    if (m === null || typeof m !== "object") return null;
    const values: Record<string, number> = {};
    for (const field of FIELDS) {
      const v = (m as Record<string, unknown>)[field];
      if (typeof v !== "number" || !Number.isFinite(v)) return null;
      values[field] = v;
    }
    return values;
  };
  // The recomputed values themselves must be usable before a correction is
  // applied to them; a photo is never measured "partly".
  if (finiteFields(recomputed.measurements) === null) {
    return { reason: "NO_MEASUREMENT" };
  }
  let calibrated: unknown;
  try {
    calibrated = calibration.apply(recomputed.measurements, { path, hand });
  } catch {
    return { reason: "CALIBRATION_INVALID" };
  }
  // A correction that returns a missing or non-finite value for any
  // measurement invalidates the photo; it is not quietly left out of a field.
  const values = finiteFields(calibrated);
  return values === null ? { reason: "CALIBRATION_INVALID" } : { values };
}

export function evaluate(
  input: EvaluationInput,
  options: EvaluateOptions = {},
): EvaluationReport {
  const paths = options.paths ?? ALL_PATHS;
  const gestures = options.gestures ?? ["G01"];
  const subset = options.participants ? new Set(options.participants) : null;
  const thresholds = options.thresholds ?? CANDIDATE_THRESHOLDS;
  const calibration = options.calibration ?? RAW_CALIBRATION;
  if (paths.length === 0) {
    throw new EvaluationInputError("Choose at least one path to evaluate.");
  }

  const truths = new Map<string, Truth>();
  for (const t of input.truths) {
    if (truths.has(t.participant)) {
      throw new EvaluationInputError(
        `Two truth files are for participant ${t.participant}.`,
      );
    }
    truths.set(t.participant, t);
  }

  const excluded: ExclusionRow[] = [];
  const observations: Observation[] = [];
  const filedTo = new Set<string>();
  let reportCount = 0;
  let cards = 0;
  let outOfScope = 0;
  let notMeasured = 0;

  input.logs.forEach((log, logIndex) => {
    const byFile = new Map<string, (typeof log.sort.photos)[number][]>();
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
      const sorted = matches[0]!;
      if (sorted.status === "slate") {
        cards++;
        return;
      }
      // `hand-mismatch` is a filed photo: the sheet is the ground truth of
      // what was asked, so the page's hand (`sorted.hand`) is used, never the
      // detector's.
      const filed = sorted.status === "ok" || sorted.status === "hand-mismatch";
      // A photo the kit's checker said to retake is not filed by `learn:sort`
      // (the sort sees no code), but its record still holds the page's code and
      // the planes. It is measured and kept in "all", never in "accepted".
      const retake = filed ? null : retakeOf(report, sorted, log.kitVersion);
      const gesture = retake ? retake.gesture : sorted.gesture;
      const participant = sorted.participant;
      const hand = retake ? retake.hand : sorted.hand;

      // Scope: poses and participants that were asked for.
      if (gesture !== null && !gestures.includes(gesture)) {
        outOfScope++;
        return;
      }
      if (subset && participant !== null && !subset.has(participant)) {
        outOfScope++;
        return;
      }
      if (
        (!filed && !retake) ||
        participant === null ||
        gesture === null ||
        hand === null
      ) {
        notMeasured++;
        excluded.push({
          id: anonymous,
          stage: "measurement",
          path: null,
          field: null,
          reasons: [`NOT_FILED:${sorted.status}`],
        });
        return;
      }

      const place = `${participant}/${gesture}${handLetter(hand)}`;
      const id = retake
        ? `${place}/retake@${anonymous}`
        : `${place}/${sorted.shot}`;
      const destination = `${place}/${sorted.shot}`;
      if (!retake && filedTo.has(destination)) {
        // `learn:sort` never overwrites a filed copy, so the first one is the one on disk.
        notMeasured++;
        excluded.push({
          id: `${id}@run${logIndex + 1}`,
          stage: "measurement",
          path: null,
          field: null,
          reasons: ["DUPLICATE_DESTINATION"],
        });
        return;
      }
      if (!retake) filedTo.add(destination);

      const measured: Partial<
        Record<EvalPath, Readonly<Record<string, number>>>
      > = {};
      for (const path of paths) {
        const result = measure(report, path, hand, calibration);
        if ("values" in result) measured[path] = result.values;
        else {
          excluded.push({
            id,
            stage: "measurement",
            path,
            field: null,
            reasons: [result.reason],
          });
        }
      }
      if (Object.keys(measured).length === 0) {
        notMeasured++;
        return;
      }

      if (retake) {
        excluded.push({
          id,
          stage: "kit",
          path: null,
          field: null,
          reasons: retake.reasons,
        });
      }
      const reasons = gateReasons(report);
      if (reasons.length > 0) {
        excluded.push({
          id,
          stage: "product",
          path: null,
          field: null,
          reasons,
        });
      }
      observations.push({
        id,
        participant,
        gesture,
        hand,
        // A retake photo is never in the accepted group, whatever the
        // product's gates say: the kit's own checker refused it.
        accepted: reasons.length === 0 && !retake,
        measured,
      });
    });
  });

  // Truth pairing: the page's hand, with that participant's value for that hand.
  const truthOf = (o: Observation, field: string): number | null => {
    const t = truths.get(o.participant);
    return t
      ? ((t[o.hand] as Record<string, number | null>)[field] ?? null)
      : null;
  };
  for (const o of observations) {
    const t = truths.get(o.participant);
    if (!t) {
      excluded.push({
        id: o.id,
        stage: "truth",
        path: null,
        field: null,
        reasons: ["NO_TRUTH_FILE"],
      });
      continue;
    }
    for (const field of FIELDS) {
      if (truthOf(o, field) === null) {
        excluded.push({
          id: o.id,
          stage: "truth",
          path: null,
          field,
          reasons: [`NO_TRUTH_VALUE:${o.hand}`],
        });
      }
    }
  }

  const groups: Record<EvalGroup, Partial<Record<EvalPath, PathResult>>> = {
    accepted: {},
    all: {},
  };
  for (const group of ["accepted", "all"] as const) {
    const members = observations.filter((o) => group === "all" || o.accepted);
    for (const path of paths) {
      const measuredHere = members.filter((o) => o.measured[path]);
      const fields: Record<string, FieldResult> = {};
      for (const field of FIELDS) {
        const values = measuredHere
          .map((o) => ({ o, value: o.measured[path]?.[field] }))
          .filter(
            (x): x is { o: Observation; value: number } =>
              typeof x.value === "number",
          );

        const errors: number[] = [];
        for (const { o, value } of values) {
          const truth = truthOf(o, field);
          if (truth !== null) errors.push(value - truth);
        }
        const stats = accuracyStats(errors);
        const accuracyLimit = thresholds.accuracyMm[field];

        const byGroup = new Map<
          string,
          {
            row: Omit<RepeatabilityRowOut, keyof RepeatabilityRow>;
            values: number[];
          }
        >();
        for (const { o, value } of values) {
          const key = `${o.participant}|${o.hand}|${o.gesture}`;
          const entry = byGroup.get(key) ?? {
            row: {
              participant: o.participant,
              hand: o.hand,
              gesture: o.gesture,
            },
            values: [],
          };
          entry.values.push(value);
          byGroup.set(key, entry);
        }
        const rows: RepeatabilityRowOut[] = [];
        for (const { row, values: vs } of byGroup.values()) {
          const r = repeatabilityRow(vs);
          if (r) rows.push({ ...row, ...r });
        }
        rows.sort(
          (a, b) =>
            a.participant.localeCompare(b.participant) ||
            a.hand.localeCompare(b.hand) ||
            a.gesture.localeCompare(b.gesture),
        );
        const summary = summariseRepeatability(rows);
        const repeatLimit = thresholds.repeatabilityMm[field];

        fields[field] = {
          accuracy: {
            stats,
            readings:
              stats && accuracyLimit !== undefined
                ? accuracyReadings(stats, accuracyLimit)
                : [],
          },
          repeatability: {
            rows,
            summary,
            readings:
              summary && repeatLimit !== undefined
                ? repeatabilityReadings(summary, repeatLimit)
                : [],
          },
        };
      }
      groups[group][path] = { photos: measuredHere.length, fields };
    }
  }

  excluded.sort(
    (a, b) =>
      a.id.localeCompare(b.id) ||
      a.stage.localeCompare(b.stage) ||
      (a.path ?? "").localeCompare(b.path ?? "") ||
      (a.field ?? "").localeCompare(b.field ?? ""),
  );

  return {
    format: EVALUATION_FORMAT,
    model: calibration.name,
    createdAt: (options.now ?? new Date()).toISOString(),
    thresholds,
    options: {
      paths: [...paths],
      gestures: [...gestures],
      participants: options.participants ? [...options.participants] : null,
    },
    inputs: {
      runLogs: input.logs.map((log) => ({
        kitVersion: log.kitVersion,
        gitSha: log.gitSha,
        gitDirty: log.gitDirty,
        paperSize: log.paperSize,
        reports: log.reports.length,
      })),
      truthFiles: input.truths.length,
      participants: [...new Set(observations.map((o) => o.participant))].sort(),
    },
    counts: {
      reports: reportCount,
      cards,
      outOfScope,
      notMeasured,
      measured: observations.length,
    },
    groups,
    excluded,
  };
}

/** Parse the JSON of run logs and truth files, then evaluate. Labels name inputs by position. */
export function evaluateJson(
  logsJson: readonly unknown[],
  truthsJson: readonly unknown[],
  options: EvaluateOptions = {},
): EvaluationReport {
  if (logsJson.length === 0) {
    throw new EvaluationInputError("Give at least one run log.");
  }
  return evaluate(
    {
      logs: logsJson.map((j, i) => parseRunLog(j, `run log ${i + 1}`)),
      truths: truthsJson.map((j, i) => parseTruth(j, `truth file ${i + 1}`)),
    },
    options,
  );
}
