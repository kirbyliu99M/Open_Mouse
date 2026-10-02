/**
 * The kit v2 sorter: assign a folder's photos to participants and poses when
 * the PAGE says neither pose nor hand. (Kit v1's is `sortPhotos` in `kit.ts`.)
 *
 *  - Participant: every kit v2 photo carries its participant card's QR code.
 *    Photos are grouped by that code, wherever they sit in the folder.
 *  - Pose: from the shooting order, taking each participant's photos in
 *    capture order. The plan is the contract's `planShots(count, shotCounts)`
 *    and nothing else: five photos are G02 x3 then G04 x2; any other count is
 *    placed only if Kirby wrote `shotCounts` (how many G02, then how many G04)
 *    in the participant's `participant.json`. Otherwise the participant is
 *    `needs-review` and none of their photos is filed: the sorter never
 *    guesses a pose. Capture order is the caller's `takenAt` (the checker and
 *    `learn:sort` use camera file-name order, as kit v1 does).
 *  - Hand: from the participant's `participant.json` (`mouseHand`), passed in.
 *    MediaPipe's label is only a check: a mismatch is flagged, never used.
 *  - The pose check never places or moves a photo. It fills `poseCheck` and
 *    the `pose-mismatch` flag, nothing else.
 *
 * Every photo that names a participant is placed, whatever its quality, and
 * keeps its slot in the order even when its copy cannot be made (`unfileable`:
 * a PNG, a damaged JPEG): the photos after it do not shift pose. Such a photo
 * has no destination and a status that names why, and its participant is
 * counted as having an unfiled photo. A photo with no readable card cannot be
 * placed; one sitting beside a participant's run (it may be theirs) sends that
 * participant to review unless Kirby has confirmed their `shotCounts`.
 *
 * Pure.
 */
import {
  LEARNING_KIT_VERSION,
  extensionOf,
  type CoverageRow,
  type HandSide,
  type KitCode,
  type SortResult,
  type SortStatus,
} from "./kit";
import { poseAgrees, type PoseGuess } from "./posecheck";
import {
  AGREED_V2_SEQUENCE,
  planShots,
  type KitV2PhotoAssignment,
  type ParticipantRecord,
} from "./session";

export interface IdentifiedPhotoV2 {
  /** File name as found in the input folder. */
  readonly file: string;
  /** Capture order: earlier first. Ties keep input order. */
  readonly takenAt: number;
  /** The kit code read from the photo's QR, or `null` if none was readable. */
  readonly code: KitCode | null;
  /** MediaPipe's handedness, when a hand was found. */
  readonly detectedHand?: HandSide | null;
  /** The pose check's call on the photo's landmarks; `null` or absent when it abstained or there was no hand. */
  readonly predictedPose?: PoseGuess | null;
}

/** Why a photo's copy cannot be made; each is a `SortStatus` of the same name. */
export type UnfiledReason = "not-a-jpeg" | "damaged-jpeg" | "copy-failed";

export interface SortV2Options {
  /** Participant id to the hand they use a mouse with (`participant.json`); `null` or absent when not known yet. */
  readonly mouseHands?: Readonly<Record<string, HandSide | null | undefined>>;
  /** Participant id to `shotCounts` from `participant.json`; `null` or absent means "as planned". */
  readonly shotCounts?: Readonly<
    Record<string, ParticipantRecord["shotCounts"] | undefined>
  >;
  /** Input file names whose copy cannot be made, and why. They keep their slot but are not filed. */
  readonly unfileable?: Readonly<Record<string, UnfiledReason | undefined>>;
  /** The kit version the codes must carry. Default `LEARNING_KIT_VERSION`. */
  readonly version?: number;
}

export type ReviewReason =
  /** Not the planned five photos, and no `shotCounts` to say what was taken. */
  | "photo-count-not-planned"
  /** `shotCounts` is there but does not add up to the photos (or allows more than one extra). */
  | "shot-counts-do-not-match"
  /** A photo with no readable card sits beside this run, and `shotCounts` has not confirmed it is not theirs. */
  | "unreadable-photo-in-run";

export const REVIEW_REASON_TEXT: Readonly<Record<ReviewReason, string>> = {
  "photo-count-not-planned":
    "not the planned 3 + 2 photos: write shotCounts (how many G02, then how many G04) in participant.json and run the sorter again",
  "shot-counts-do-not-match":
    "shotCounts in participant.json does not add up to the photos, or allows more than one extra: correct it and run the sorter again",
  "unreadable-photo-in-run":
    "a photo with no readable card sits next to this run and may be theirs: once you know it is not, write shotCounts (G02 3, G04 2 if as planned) in participant.json and run the sorter again",
};

/**
 * One `sort.photos[]` entry of a kit v2 run log: exactly the contract's
 * `KitV2PhotoAssignment` (`file`, `status`, `destination`, `participant`,
 * `gesture`, `hand`, `shot`, `poseSource`, `extraShot`, `poseCheck`), which also
 * has every field of kit v1's `SortedPhoto`.
 */
export interface SortedPhotoV2 extends KitV2PhotoAssignment {
  /** One of kit v2's statuses (`SortStatus`); the contract only says `string`. */
  readonly status: SortStatus;
}

export interface ParticipantSortRow {
  readonly participant: string;
  /** Photos that name this participant. */
  readonly photos: number;
  readonly status: "ok" | "needs-review";
  /** Why the participant is in review; `null` when they are not. */
  readonly reason: ReviewReason | null;
  /** The mouse hand from `participant.json`; `null` when not filled in yet. */
  readonly hand: HandSide | null;
  /** Photos placed in the order but not filed because their copy cannot be made. */
  readonly unfiled: number;
  /** The pose check's call on each photo in capture order, for a person looking at a participant in review. */
  readonly predictedPoses: readonly (PoseGuess | null)[];
}

export interface CoverageRowV2 extends CoverageRow {
  /** `got` counts the photos filed under the pose, the extra shot included; this is how many of them are the extra shot. */
  readonly extra: number;
}

export interface KitV2SortResult extends SortResult {
  /** In capture order. */
  readonly photos: readonly SortedPhotoV2[];
  /** Per participant not in review, per pose: expected vs filed shots. `hand` is the participant's mouse hand. */
  readonly coverage: readonly CoverageRowV2[];
  /** One row per participant seen, in the order they first appear. */
  readonly participants: readonly ParticipantSortRow[];
}

// ── Sorting a folder ────────────────────────────────────────────────────────

export function sortPhotosV2(
  photos: readonly IdentifiedPhotoV2[],
  options: SortV2Options = {},
): KitV2SortResult {
  const version = options.version ?? LEARNING_KIT_VERSION;
  const mouseHands = options.mouseHands ?? {};
  const shotCounts = options.shotCounts ?? {};
  const unfileable = options.unfileable ?? {};
  const own = <T>(table: Readonly<Record<string, T>>, key: string) =>
    Object.hasOwn(table, key) ? table[key] : undefined;

  const ordered = photos
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.takenAt - b.p.takenAt || a.i - b.i)
    .map(({ p }) => p);

  // Who each photo names, or why it names no one.
  type Owner =
    | { readonly kind: "participant"; readonly participant: string }
    | { readonly kind: "no-code" }
    | { readonly kind: "version-mismatch" };
  const owners: Owner[] = ordered.map((photo) => {
    const code = photo.code;
    if (!code) return { kind: "no-code" };
    if (code.version !== version) return { kind: "version-mismatch" };
    // A pose page's code means nothing to this protocol: it names no participant.
    if (code.kind !== "participant") return { kind: "no-code" };
    return { kind: "participant", participant: code.participant };
  });

  const runs = new Map<string, number[]>();
  owners.forEach((o, i) => {
    if (o.kind !== "participant") return;
    const run = runs.get(o.participant) ?? [];
    run.push(i);
    runs.set(o.participant, run);
  });

  // A photo with no readable card, next to a participant's run on either side,
  // may be one of that participant's: they are suspect.
  const suspects = new Set<string>();
  owners.forEach((o, i) => {
    if (o.kind === "participant") return;
    for (let left = i - 1; left >= 0; left--) {
      const l = owners[left]!;
      if (l.kind === "participant") {
        suspects.add(l.participant);
        break;
      }
    }
    for (let right = i + 1; right < owners.length; right++) {
      const r = owners[right]!;
      if (r.kind === "participant") {
        suspects.add(r.participant);
        break;
      }
    }
  });

  // Plan each participant's poses with the contract's `planShots`, or review.
  type Decision =
    { readonly review: ReviewReason } | { readonly plan: readonly string[] };
  const decisions = new Map<string, Decision>();
  for (const [participant, run] of runs) {
    const counts = own(shotCounts, participant) ?? null;
    if (suspects.has(participant) && counts === null) {
      decisions.set(participant, { review: "unreadable-photo-in-run" });
      continue;
    }
    const plan = planShots(run.length, counts);
    decisions.set(
      participant,
      plan
        ? { plan }
        : {
            review:
              counts === null
                ? "photo-count-not-planned"
                : "shot-counts-do-not-match",
          },
    );
  }

  const handOf = (participant: string): HandSide | null =>
    own(mouseHands, participant) ?? null;

  // Each photo's place in its participant's run, to look its pose up.
  const slotOf = new Map<number, number>();
  for (const run of runs.values()) run.forEach((i, k) => slotOf.set(i, k));
  const plannedShots = new Map<string, number>(
    AGREED_V2_SEQUENCE.map((b) => [b.gesture, b.shots]),
  );
  // Running shot number per participant and pose.
  const shotNo = new Map<string, number>();

  const sorted: SortedPhotoV2[] = ordered.map((photo, i) => {
    const owner = owners[i]!;
    if (owner.kind !== "participant") {
      return {
        file: photo.file,
        status: owner.kind,
        participant: null,
        gesture: null,
        hand: null,
        shot: null,
        destination: null,
        poseSource: "order",
        extraShot: false,
        poseCheck: null,
      };
    }
    const { participant } = owner;
    const hand = handOf(participant);
    const decision = decisions.get(participant)!;
    if ("review" in decision) {
      return {
        file: photo.file,
        status: "needs-review",
        participant,
        gesture: null,
        hand,
        shot: null,
        destination: null,
        poseSource: "order",
        extraShot: false,
        poseCheck: null,
      };
    }
    const gesture = decision.plan[slotOf.get(i)!] as "G02" | "G04";
    const key = `${participant}/${gesture}`;
    const shot = (shotNo.get(key) ?? 0) + 1;
    shotNo.set(key, shot);
    const predicted = photo.predictedPose ?? null;
    const agrees = poseAgrees(predicted, gesture);
    const handMismatch =
      hand !== null &&
      photo.detectedHand != null &&
      photo.detectedHand !== hand;
    const refused = own(unfileable, photo.file) ?? null;
    return {
      file: photo.file,
      status:
        refused ??
        (agrees === false
          ? "pose-mismatch"
          : handMismatch
            ? "hand-mismatch"
            : "ok"),
      participant,
      gesture,
      hand,
      shot,
      destination: refused
        ? null
        : `${participant}/${gesture}/${shot}${extensionOf(photo.file)}`,
      poseSource: "order",
      extraShot: shot > (plannedShots.get(gesture) ?? 0),
      poseCheck: { predicted, agrees },
    };
  });

  const coverage: CoverageRowV2[] = [];
  const participants: ParticipantSortRow[] = [];
  for (const [participant, run] of runs) {
    const decision = decisions.get(participant)!;
    const review = "review" in decision ? decision.review : null;
    participants.push({
      participant,
      photos: run.length,
      status: review ? "needs-review" : "ok",
      reason: review,
      hand: handOf(participant),
      unfiled: sorted.filter(
        (s) =>
          s.participant === participant &&
          s.gesture !== null &&
          s.destination === null,
      ).length,
      predictedPoses: run.map((i) => ordered[i]!.predictedPose ?? null),
    });
    if (review) continue;
    for (const block of AGREED_V2_SEQUENCE) {
      const filed = sorted.filter(
        (s) =>
          s.participant === participant &&
          s.gesture === block.gesture &&
          s.destination !== null,
      );
      coverage.push({
        participant,
        gesture: block.gesture,
        hand: handOf(participant),
        expected: block.shots,
        got: filed.length,
        extra: filed.filter((s) => s.extraShot).length,
      });
    }
  }

  return { photos: sorted, coverage, participants };
}
