/**
 * The kit v2 sorter: assign a folder's photos to participants and poses when
 * the PAGE says neither pose nor hand. (Kit v1's is `sortPhotos` in `kit.ts`.)
 *
 *  - Participant: every kit v2 photo carries its participant card's QR code.
 *    Photos are grouped by that code, wherever they sit in the folder.
 *  - Pose: from the shooting order (`AGREED_V2_SEQUENCE`, G02 x3 then G04 x2),
 *    taking each participant's photos in capture order. Capture order is the
 *    caller's `takenAt` (the checker and `learn:sort` use camera file-name
 *    order, as kit v1 does).
 *  - Extra shot: at most `AGREED_V2_MAX_EXTRA_SHOTS` (one) per participant, for
 *    a hand off the sheet or a covered corner. With one extra photo the order
 *    alone cannot say which pose it belongs to, so the pose check decides (see
 *    `placeByOrder`). If it cannot, the participant is marked `needs-review`
 *    and none of their photos is filed: a guess would put a wrong label on
 *    data.
 *  - Hand: from the participant's `participant.json` (`mouseHand`), passed in.
 *    MediaPipe's label is only a check: a mismatch is flagged, never used.
 *  - The pose check never moves a photo. It flags (`pose-mismatch`) a photo it
 *    disagrees with, and it is used for nothing else but the extra shot.
 *
 * Every photo that names a participant is filed, whatever its quality: a photo
 * the product would refuse is data, and dropping one would shift the shooting
 * order of the rest. A photo with no readable card cannot be placed, and one
 * sitting inside a participant's run puts that participant in review when
 * their photos are already short.
 *
 * Pure.
 */
import {
  LEARNING_KIT_VERSION,
  extensionOf,
  type GestureCode,
  type HandSide,
  type CoverageRow,
  type KitCode,
  type SortResult,
  type SortStatus,
} from "./kit";
import { poseAgrees, type PoseGuess } from "./posecheck";
import {
  AGREED_V2_MAX_EXTRA_SHOTS,
  AGREED_V2_SEQUENCE,
  type KitV2PhotoAssignment,
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

export interface SortV2Options {
  /** Participant id to the hand they use a mouse with (`participant.json`); `null` or absent when not known yet. */
  readonly mouseHands?: Readonly<Record<string, HandSide | null | undefined>>;
  /** The kit version the codes must carry. Default `LEARNING_KIT_VERSION`. */
  readonly version?: number;
  readonly sequence?: readonly {
    readonly gesture: GestureCode;
    readonly shots: number;
  }[];
  readonly maxExtraShots?: number;
}

export type ReviewReason =
  /** More photos than the sequence plus the allowed extra shots. */
  | "too-many-photos"
  /** One extra photo, and the pose check cannot say which pose it belongs to. */
  | "extra-shot-placement-unclear"
  /** Fewer photos than planned, and a photo with no readable card sits next to this run. */
  | "unreadable-photo-in-run";

export const REVIEW_REASON_TEXT: Readonly<Record<ReviewReason, string>> = {
  "too-many-photos":
    "more photos than the shooting order plus one extra shot allows",
  "extra-shot-placement-unclear":
    "one photo more than planned, and the pose check cannot tell which pose it belongs to",
  "unreadable-photo-in-run":
    "short of photos, and a photo with no readable card sits next to this run (it may be one of theirs)",
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

// ── Placing one participant's photos by order ───────────────────────────────

export interface ShotPlacement {
  readonly gesture: GestureCode;
  /** 1-based position within the pose, the extra shot included. */
  readonly shot: number;
  readonly extra: boolean;
}

export type Placement =
  | { readonly ok: true; readonly placements: readonly ShotPlacement[] }
  | { readonly ok: false; readonly reason: ReviewReason };

/** Every way of spreading `extras` extra shots over `blocks` poses. */
function extraVectors(blocks: number, extras: number): number[][] {
  if (blocks === 1) return [[extras]];
  const out: number[][] = [];
  for (let first = 0; first <= extras; first++) {
    for (const rest of extraVectors(blocks - 1, extras - first)) {
      out.push([first, ...rest]);
    }
  }
  return out;
}

function layOut(
  sequence: NonNullable<SortV2Options["sequence"]>,
  extras: readonly number[],
  count: number,
): ShotPlacement[] {
  const out: ShotPlacement[] = [];
  sequence.forEach((block, b) => {
    const planned = block.shots;
    const size = planned + (extras[b] ?? 0);
    for (let k = 1; k <= size && out.length < count; k++) {
      out.push({ gesture: block.gesture, shot: k, extra: k > planned });
    }
  });
  return out;
}

/**
 * Place one participant's photos, in capture order, on the shooting order.
 *
 * With the planned number of photos (or fewer), photo i simply takes slot i of
 * the sequence. With extra shots, the order alone cannot say which pose an
 * extra belongs to, so each way of spreading them over the poses is scored by
 * how many photos' pose-check calls (`predicted`, with `null` for an
 * abstention) it contradicts. A single best way wins; a tie, which includes
 * every call abstaining, is not placed (`extra-shot-placement-unclear`). More
 * photos than the plan allows is not placed either (`too-many-photos`).
 *
 * Within the pose that holds the extra, the last photo is the extra shot (the
 * surplus after the planned ones, so shots 1 to N-1 stay the planned ones).
 * The order cannot tell a retake from the photo it replaces; the evaluator
 * should treat a pose's photos as a set.
 */
export function placeByOrder(
  predicted: readonly (PoseGuess | null)[],
  sequence: NonNullable<SortV2Options["sequence"]> = AGREED_V2_SEQUENCE,
  maxExtraShots: number = AGREED_V2_MAX_EXTRA_SHOTS,
): Placement {
  const n = predicted.length;
  const planned = sequence.reduce((sum, b) => sum + b.shots, 0);
  if (n > planned + maxExtraShots) {
    return { ok: false, reason: "too-many-photos" };
  }
  if (n <= planned) {
    return {
      ok: true,
      placements: layOut(
        sequence,
        sequence.map(() => 0),
        n,
      ),
    };
  }
  const candidates = extraVectors(sequence.length, n - planned).map(
    (extras) => {
      const placements = layOut(sequence, extras, n);
      const disagreements = placements.filter((p, i) => {
        const call = predicted[i] ?? null;
        return call !== null && poseAgrees(call, p.gesture) === false;
      }).length;
      return { placements, disagreements };
    },
  );
  const best = Math.min(...candidates.map((c) => c.disagreements));
  const winners = candidates.filter((c) => c.disagreements === best);
  if (winners.length !== 1) {
    return { ok: false, reason: "extra-shot-placement-unclear" };
  }
  return { ok: true, placements: winners[0]!.placements };
}

// ── Sorting a folder ────────────────────────────────────────────────────────

export function sortPhotosV2(
  photos: readonly IdentifiedPhotoV2[],
  options: SortV2Options = {},
): KitV2SortResult {
  const version = options.version ?? LEARNING_KIT_VERSION;
  const sequence = options.sequence ?? AGREED_V2_SEQUENCE;
  const maxExtra = options.maxExtraShots ?? AGREED_V2_MAX_EXTRA_SHOTS;
  const mouseHands = options.mouseHands ?? {};
  const planned = sequence.reduce((sum, b) => sum + b.shots, 0);

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

  // Place each participant.
  type Decision =
    | { readonly review: ReviewReason }
    | { readonly placements: readonly ShotPlacement[] };
  const decisions = new Map<string, Decision>();
  for (const [participant, run] of runs) {
    const predicted = run.map((i) => ordered[i]!.predictedPose ?? null);
    if (suspects.has(participant) && run.length < planned) {
      decisions.set(participant, { review: "unreadable-photo-in-run" });
      continue;
    }
    const placement = placeByOrder(predicted, sequence, maxExtra);
    decisions.set(
      participant,
      placement.ok
        ? { placements: placement.placements }
        : { review: placement.reason },
    );
  }

  const handOf = (participant: string): HandSide | null => {
    const h = Object.hasOwn(mouseHands, participant)
      ? mouseHands[participant]
      : null;
    return h ?? null;
  };

  // Each photo's place in its participant's run, to look its placement up.
  const slotOf = new Map<number, number>();
  for (const run of runs.values()) run.forEach((i, k) => slotOf.set(i, k));

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
    const place = decision.placements[slotOf.get(i)!]!;
    const predicted = photo.predictedPose ?? null;
    const agrees = poseAgrees(predicted, place.gesture);
    const handMismatch =
      hand !== null &&
      photo.detectedHand != null &&
      photo.detectedHand !== hand;
    return {
      file: photo.file,
      status:
        agrees === false
          ? "pose-mismatch"
          : handMismatch
            ? "hand-mismatch"
            : "ok",
      participant,
      gesture: place.gesture,
      hand,
      shot: place.shot,
      destination: `${participant}/${place.gesture}/${place.shot}${extensionOf(photo.file)}`,
      poseSource: "order",
      extraShot: place.extra,
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
      predictedPoses: run.map((i) => ordered[i]!.predictedPose ?? null),
    });
    if (review) continue;
    for (const block of sequence) {
      const filed = sorted.filter(
        (s) => s.participant === participant && s.gesture === block.gesture,
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
