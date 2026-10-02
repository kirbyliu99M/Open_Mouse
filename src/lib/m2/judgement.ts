/**
 * Judgement correctness: how often the product's accept/retake verdict on a
 * photo agrees with Kirby's own blind good/bad label of that photo. Pure.
 *
 * It is the headline of agreed-v2 (frozen prereg version 2, 2026-10-02,
 * section 2). The target is 95 % and it is a target, never a pass/fail
 * threshold: nothing here says "met" or "not met".
 *
 * Definitions:
 *  - The product's verdict is its own gates on the photo
 *    (`productGates.accepted`, the same record "accepted" is judged by
 *    everywhere in the evaluator). A photo with no gate record is counted as
 *    not accepted, and how many there were is reported.
 *  - Kirby's label is "good" (he would keep the photo for measuring) or "bad".
 *    A bad photo may carry reasons that describe the photo, never the person.
 *  - Agreement: accepted and good, or retake and bad.
 *  - False accept: the product accepted a photo Kirby called bad.
 *  - False reject: the product asked for a retake of a photo Kirby called good.
 *    Both are counted, and shown as a share of all labelled photos (so that
 *    agreement, false accepts and false rejects add up to 100 %) and as a
 *    share of the photos Kirby called bad, or good.
 *  - Only blind labels make the headline. A labels file with `blind: false`
 *    is reported apart.
 *  - A photo with no label (no labels file for its session, a label file that
 *    does not mention it, a label still `null`, or a label that two photos
 *    claim) is left out and counted; nothing is counted as good or bad by
 *    default.
 *
 * A label names its photo by `file`. The contract does not say whether that is
 * the file's own name (what the run log holds) or the filed copy's relative
 * path (`P901/G02/1.jpg`), so both are tried: the file's own name, then the
 * filed copy's path with and without the hand letter. Names are compared
 * case-insensitively with `/` as the separator.
 */
import { PHOTO_LABEL_REASONS, type LabelsRecord } from "../learning/session";
import { EvaluationInputError } from "./inputs";

/** Kirby, 2026-10-02: aim for 95 %; not a pass/fail threshold. */
export const JUDGEMENT_TARGET = 0.95 as const;

export type PhotoLabelReason = (typeof PHOTO_LABEL_REASONS)[number];
export type LabelValue = "good" | "bad";

/** `"none-given"` stands for a bad photo with no reason ticked. */
export type ReasonKey = PhotoLabelReason | "none-given";
export const REASON_KEYS: readonly ReasonKey[] = [
  ...PHOTO_LABEL_REASONS,
  "none-given",
];

/** A file name as labels and run logs may spell it, made comparable. */
export function normaliseLabelFile(file: string): string {
  return file
    .trim()
    .replaceAll("\\", "/")
    .replace(/^(\.\/)+/, "")
    .replace(/\/{2,}/g, "/")
    .toLowerCase();
}

/**
 * The names a label may use for a photo, in the order they are tried: the
 * file's own name; the filed copy's path (`P901/G02/1.jpg`); the same with the
 * hand letter (`P901/G02R/1.jpg`).
 */
export function labelKeysOf(photo: {
  readonly file: string;
  readonly participant: string | null;
  readonly gesture: string | null;
  readonly hand: "left" | "right" | null;
  readonly shot: number | null;
}): string[] {
  const keys = [normaliseLabelFile(photo.file)];
  if (
    photo.participant !== null &&
    photo.gesture !== null &&
    photo.shot !== null
  ) {
    const extension = /\.[A-Za-z0-9]+$/.exec(photo.file)?.[0] ?? ".jpg";
    const copy = (pose: string) =>
      normaliseLabelFile(
        `${photo.participant}/${pose}/${photo.shot}${extension}`,
      );
    keys.push(copy(photo.gesture));
    if (photo.hand !== null) {
      keys.push(copy(`${photo.gesture}${photo.hand === "right" ? "R" : "L"}`));
    }
  }
  return keys;
}

interface LabelEntry {
  readonly label: LabelValue | null;
  readonly reasons: readonly PhotoLabelReason[];
}

interface SessionLabels {
  readonly blind: boolean;
  readonly entries: ReadonlyMap<string, LabelEntry>;
}

/** Labels by session, then by normalised file name. A session or a file given twice is an error: labels are written once, never edited. */
export type LabelIndex = ReadonlyMap<string, SessionLabels>;

export function buildLabelIndex(records: readonly LabelsRecord[]): LabelIndex {
  const sessions = new Map<string, SessionLabels>();
  records.forEach((record, i) => {
    if (sessions.has(record.session)) {
      throw new EvaluationInputError(
        `Two labels files are for session ${record.session}.`,
      );
    }
    const entries = new Map<string, LabelEntry>();
    for (const l of record.labels) {
      const key = normaliseLabelFile(l.file);
      if (entries.has(key)) {
        throw new EvaluationInputError(
          `Labels file ${i + 1} labels the same photo twice.`,
        );
      }
      entries.set(key, { label: l.label, reasons: l.reasons });
    }
    sessions.set(record.session, { blind: record.blind, entries });
  });
  return sessions;
}

/** One photo of an evaluated participant in G02 or G04, as judgement sees it. */
export interface JudgedPhoto {
  /** The run log's session id; `null` when the log names none. */
  readonly session: string | null;
  readonly keys: readonly string[];
  /** Which photo this is, so that the same photo seen twice (a folder sorted twice) is one claimant of its label. */
  readonly identity: string;
  readonly gesture: string;
  /** The product's gates take the photo. */
  readonly accepted: boolean;
  /** The record holds a verdict at all. */
  readonly hasGateRecord: boolean;
}

/** Every photo the logs assign, whatever its participant: the ones a label may legitimately name. */
export interface KnownPhoto {
  readonly session: string | null;
  readonly keys: readonly string[];
  readonly identity: string;
}

export interface PoseJudgement {
  readonly gesture: string;
  readonly photos: number;
  readonly agree: number;
  readonly agreementRate: number | null;
  readonly falseAccepts: number;
  readonly falseRejects: number;
}

export interface ReasonJudgement {
  readonly reason: ReasonKey;
  /** Bad photos that carry this reason (a photo with two reasons is in two rows). */
  readonly badPhotos: number;
  /** Of those, the product asked for a retake: the right call. */
  readonly retake: number;
  /** Of those, the product accepted: a false accept. */
  readonly accepted: number;
}

export interface JudgementStats {
  /** Labelled photos. */
  readonly photos: number;
  readonly agree: number;
  readonly agreementRate: number | null;
  readonly labelGood: number;
  readonly labelBad: number;
  readonly productAccepted: number;
  readonly productRetake: number;
  /** Accepted by the product, labelled bad. */
  readonly falseAccepts: number;
  /** falseAccepts / photos. */
  readonly falseAcceptRate: number | null;
  /** falseAccepts / labelBad. */
  readonly falseAcceptShareOfBad: number | null;
  /** Retake for the product, labelled good. */
  readonly falseRejects: number;
  readonly falseRejectRate: number | null;
  /** falseRejects / labelGood. */
  readonly falseRejectShareOfGood: number | null;
  /** Photos among these with no recorded gate verdict, counted as not accepted. */
  readonly noGateRecord: number;
  readonly byPose: readonly PoseJudgement[];
  readonly byReason: readonly ReasonJudgement[];
}

export interface JudgementSection {
  readonly target: typeof JUDGEMENT_TARGET;
  /** Blind labels only. `null` when no photo has one. */
  readonly headline: JudgementStats | null;
  /** Labels from sessions marked `blind: false`, apart from the headline. */
  readonly notBlind: JudgementStats | null;
  readonly coverage: {
    /** G02 and G04 photos of the evaluated participants. */
    readonly photos: number;
    readonly labelled: number;
    readonly labelledBlind: number;
    readonly labelledNotBlind: number;
    readonly unlabelled: number;
    readonly unlabelledBy: {
      /** The run log names no session, so no labels file can be its own. */
      readonly noSession: number;
      readonly noLabelsFile: number;
      /** The session has a labels file that does not mention the photo. */
      readonly noLabel: number;
      /** The label is still `null`. */
      readonly notLabelledYet: number;
      /** Two photos claim the same label. */
      readonly ambiguous: number;
    };
    /** Good/bad labels that name no photo of any participant in the run logs: a file naming mismatch shows up here. */
    readonly labelsWithNoPhoto: number;
  };
  readonly sessions: {
    /** Sessions the evaluated photos come from. */
    readonly withPhotos: number;
    readonly withLabelsFile: number;
    /** With a labels file that labels every evaluated photo of the session. */
    readonly fullyLabelled: number;
    readonly blind: number;
    readonly notBlind: number;
  };
}

const rate = (part: number, whole: number): number | null =>
  whole === 0 ? null : part / whole;

interface Labelled {
  readonly gesture: string;
  readonly accepted: boolean;
  readonly hasGateRecord: boolean;
  readonly label: LabelValue;
  readonly reasons: readonly PhotoLabelReason[];
}

/** The statistics of a set of labelled photos; `null` for none. */
export function judgementStats(
  photos: readonly Labelled[],
  poses: readonly string[],
): JudgementStats | null {
  if (photos.length === 0) return null;
  const n = photos.length;
  const bad = photos.filter((p) => p.label === "bad");
  const good = photos.filter((p) => p.label === "good");
  const falseAccepts = bad.filter((p) => p.accepted).length;
  const falseRejects = good.filter((p) => !p.accepted).length;
  const agree = n - falseAccepts - falseRejects;
  return {
    photos: n,
    agree,
    agreementRate: rate(agree, n),
    labelGood: good.length,
    labelBad: bad.length,
    productAccepted: photos.filter((p) => p.accepted).length,
    productRetake: photos.filter((p) => !p.accepted).length,
    falseAccepts,
    falseAcceptRate: rate(falseAccepts, n),
    falseAcceptShareOfBad: rate(falseAccepts, bad.length),
    falseRejects,
    falseRejectRate: rate(falseRejects, n),
    falseRejectShareOfGood: rate(falseRejects, good.length),
    noGateRecord: photos.filter((p) => !p.hasGateRecord).length,
    byPose: poses.map((gesture) => {
      const here = photos.filter((p) => p.gesture === gesture);
      const fa = here.filter((p) => p.label === "bad" && p.accepted).length;
      const fr = here.filter((p) => p.label === "good" && !p.accepted).length;
      return {
        gesture,
        photos: here.length,
        agree: here.length - fa - fr,
        agreementRate: rate(here.length - fa - fr, here.length),
        falseAccepts: fa,
        falseRejects: fr,
      };
    }),
    byReason: REASON_KEYS.map((reason) => {
      const withReason = bad.filter((p) =>
        reason === "none-given"
          ? p.reasons.length === 0
          : p.reasons.includes(reason),
      );
      return {
        reason,
        badPhotos: withReason.length,
        retake: withReason.filter((p) => !p.accepted).length,
        accepted: withReason.filter((p) => p.accepted).length,
      };
    }),
  };
}

/**
 * Judgement correctness over the photos of the evaluated participants, from
 * Kirby's labels. `known` is every photo the logs assign (any participant),
 * so that a label can be told from one that names nothing.
 */
export function judge(args: {
  readonly photos: readonly JudgedPhoto[];
  readonly known: readonly KnownPhoto[];
  readonly labels: LabelIndex;
  readonly poses: readonly string[];
}): JudgementSection {
  const { photos, known, labels, poses } = args;

  // Who claims each label: the distinct photos (any participant) that name it.
  const claimants = new Map<string, Set<string>>();
  const firstEntry = (session: string | null, keys: readonly string[]) => {
    if (session === null) return null;
    const entries = labels.get(session)?.entries;
    if (!entries) return null;
    for (const key of keys) if (entries.has(key)) return key;
    return null;
  };
  for (const k of known) {
    const key = firstEntry(k.session, k.keys);
    if (key === null) continue;
    const id = `${k.session}\u0000${key}`;
    const set = claimants.get(id) ?? new Set<string>();
    set.add(k.identity);
    claimants.set(id, set);
  }

  const labelled: { photo: JudgedPhoto; entry: LabelEntry; blind: boolean }[] =
    [];
  const unlabelledBy = {
    noSession: 0,
    noLabelsFile: 0,
    noLabel: 0,
    notLabelledYet: 0,
    ambiguous: 0,
  };
  const sessionsOf = new Map<string, { total: number; labelled: number }>();
  for (const photo of photos) {
    if (photo.session !== null) {
      const s = sessionsOf.get(photo.session) ?? { total: 0, labelled: 0 };
      s.total += 1;
      sessionsOf.set(photo.session, s);
    }
    if (photo.session === null) {
      unlabelledBy.noSession++;
      continue;
    }
    const session = labels.get(photo.session);
    if (!session) {
      unlabelledBy.noLabelsFile++;
      continue;
    }
    const key = firstEntry(photo.session, photo.keys);
    if (key === null) {
      unlabelledBy.noLabel++;
      continue;
    }
    if ((claimants.get(`${photo.session}\u0000${key}`)?.size ?? 0) > 1) {
      unlabelledBy.ambiguous++;
      continue;
    }
    const entry = session.entries.get(key)!;
    if (entry.label === null) {
      unlabelledBy.notLabelledYet++;
      continue;
    }
    labelled.push({ photo, entry, blind: session.blind });
    sessionsOf.get(photo.session)!.labelled += 1;
  }

  const asLabelled = (rows: typeof labelled): Labelled[] =>
    rows.map(({ photo, entry }) => ({
      gesture: photo.gesture,
      accepted: photo.accepted,
      hasGateRecord: photo.hasGateRecord,
      label: entry.label!,
      reasons: entry.reasons,
    }));
  const blindRows = labelled.filter((r) => r.blind);
  const openRows = labelled.filter((r) => !r.blind);

  // Labels (good or bad) that no photo of any participant claims.
  let labelsWithNoPhoto = 0;
  for (const [session, record] of labels) {
    for (const [key, entry] of record.entries) {
      if (entry.label !== null && !claimants.has(`${session}\u0000${key}`)) {
        labelsWithNoPhoto++;
      }
    }
  }

  const sessionIds = [...sessionsOf.keys()];
  return {
    target: JUDGEMENT_TARGET,
    headline: judgementStats(asLabelled(blindRows), poses),
    notBlind: judgementStats(asLabelled(openRows), poses),
    coverage: {
      photos: photos.length,
      labelled: labelled.length,
      labelledBlind: blindRows.length,
      labelledNotBlind: openRows.length,
      unlabelled: photos.length - labelled.length,
      unlabelledBy,
      labelsWithNoPhoto,
    },
    sessions: {
      withPhotos: sessionIds.length,
      withLabelsFile: sessionIds.filter((s) => labels.has(s)).length,
      fullyLabelled: sessionIds.filter(
        (s) =>
          labels.has(s) &&
          sessionsOf.get(s)!.labelled === sessionsOf.get(s)!.total,
      ).length,
      blind: sessionIds.filter((s) => labels.get(s)?.blind === true).length,
      notBlind: sessionIds.filter((s) => labels.get(s)?.blind === false).length,
    },
  };
}
