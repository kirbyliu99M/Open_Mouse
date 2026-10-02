/**
 * Synthetic kit v2 inputs (run-log format 3, `participant.json`, `session.json`)
 * for the M2 evaluator's tests. NOT a test file.
 *
 * Built from the contract (`src/lib/learning/session.ts`) and the brief, not
 * from the sorter, which is written in parallel. A photo here is a report
 * whose planes are scaled identities with no parallax correction, so the
 * millimetre values the evaluator recomputes are exactly the lengths chosen
 * in the test and every expected statistic can be worked out by hand:
 *  - `markersMm`: the wrist-to-middle-fingertip length through the marker plane;
 *  - `paperMm`:   the same through the paper-edge plane (default: the same);
 *  - `palmRatio`: palm length / hand length of the landmarks (default 0.55).
 *
 * Like a real kit v2 photo, each report's `code` is the participant's card
 * (a participant code), never a pose: the evaluator must not read it.
 */
import type { Point2 } from "../../../src/client/geometry/homography";
import type { LearningPhotoReport } from "../../../src/lib/learning/report";
import type {
  LabelsRecord,
  ParticipantRecord,
  PHOTO_LABEL_REASONS,
  PoseCheck,
  SessionRecord,
} from "../../../src/lib/learning/session";
import { handOfLength, identityPlane } from "./m2-synth";

export interface KitV2SynthPhoto {
  readonly participant: string;
  readonly gesture: "G02" | "G04";
  /** Marker-plane wrist-to-middle-fingertip length, mm; `null` = no marker plane. */
  readonly markersMm: number | null;
  /** Paper-edge-plane length, mm; default = `markersMm`; `null` = no paper plane. */
  readonly paperMm?: number | null;
  /** palm / hand length of the landmarks, default 0.55. */
  readonly palmRatio?: number;
  /** The hand the assignment gives (from the participant record). Default "right"; `null` = not recorded. */
  readonly hand?: "left" | "right" | null;
  /** The hand MediaPipe sees. Default: the assigned hand. */
  readonly detectedHand?: "left" | "right" | null;
  /** Default: counted per participant and pose from 1. */
  readonly shot?: number | null;
  readonly extraShot?: boolean;
  readonly refusedBy?: {
    readonly paper?: readonly string[];
    readonly hand?: readonly string[];
  };
  readonly noHand?: boolean;
  readonly retake?: boolean;
  readonly poseCheck?: PoseCheck | null;
  /** The participant of the assignment; default `participant`. `null` = the sorter could not place the photo. */
  readonly assignedTo?: string | null;
  /** Add a `status` to the assignment, as a sorter might. */
  readonly status?: string;
}

/** The landmarks of a hand with the given wrist-to-fingertip length and palm ratio. */
export function handWithPalm(lengthMm: number, palmRatio: number): Point2[] {
  const hand = handOfLength(lengthMm);
  const wrist = hand[0]!;
  const tip = hand[12]!;
  const palmY = wrist.y + palmRatio * lengthMm;
  const base: Point2 = { x: wrist.x, y: palmY };
  hand[9] = base;
  hand[10] = {
    x: base.x + (tip.x - base.x) / 3,
    y: base.y + (tip.y - base.y) / 3,
  };
  hand[11] = {
    x: base.x + (2 * (tip.x - base.x)) / 3,
    y: base.y + (2 * (tip.y - base.y)) / 3,
  };
  return hand;
}

function gates(photo: KitV2SynthPhoto) {
  const paperCodes = photo.refusedBy?.paper ?? [];
  const handCodes = photo.refusedBy?.hand ?? [];
  const paper = {
    ok: paperCodes.length === 0,
    errorCodes: [...paperCodes],
    warningCodes: [] as string[],
  };
  const hand =
    paperCodes.length > 0 && handCodes.length === 0
      ? null
      : {
          ok: handCodes.length === 0,
          errorCodes: [...handCodes],
          warningCodes: [] as string[],
        };
  return { paper, hand, accepted: paper.ok && (hand?.ok ?? false) };
}

function reportOf(photo: KitV2SynthPhoto, file: string): LearningPhotoReport {
  const handSide = photo.hand === undefined ? "right" : photo.hand;
  const markersMm = photo.markersMm;
  const paperMm = photo.paperMm === undefined ? markersMm : photo.paperMm;
  const base = paperMm ?? markersMm ?? 150;
  const palmRatio = photo.palmRatio ?? 0.55;
  const scaled = (target: number | null) =>
    target === null
      ? null
      : {
          ...identityPlane("markers"),
          homography: [
            [target / base, 0, 0],
            [0, target / base, 0],
            [0, 0, 1],
          ],
        };
  const markerPlane = scaled(markersMm);
  const paperPlane =
    paperMm === null
      ? null
      : {
          ...identityPlane("paper-edge"),
          homography: scaled(paperMm)!.homography,
        };
  const detected =
    photo.detectedHand === undefined ? handSide : photo.detectedHand;
  return {
    kitVersion: 2,
    gitSha: null,
    gitDirty: null,
    file,
    width: 1000,
    height: 1000,
    paperSize: "a4",
    exif: {
      focalLengthMm: null,
      focalLengthIn35mmFilm: null,
      pixelXDimension: null,
      pixelYDimension: null,
    },
    // The card in the slot, as on every real kit v2 photo: a participant code.
    qrText: `https://open-mouse.vercel.app/l/v2/${photo.participant}`,
    code: { kind: "participant", version: 2, participant: photo.participant },
    markers: [],
    reprojectionErrorMm: null,
    paperCorners: null,
    paperCornersSeen: 4,
    paperEdge: null,
    productGates: gates(photo),
    laplacianVariance: 300,
    hand: photo.noHand
      ? null
      : {
          landmarksPx: handWithPalm(base, palmRatio),
          handedness: detected,
          confidence: 0.9,
        },
    markerPlane,
    paperPlane,
    // Recorded values the evaluator must not read: it recomputes.
    markerMm: { handLengthMm: 999, palmLengthMm: 90, palmWidthMm: 80 },
    paperMm: { handLengthMm: 999, palmLengthMm: 90, palmWidthMm: 80 },
    checks: photo.retake
      ? [{ id: "markers", tone: "bad", message: "synthetic: markers failed" }]
      : [],
    verdict: photo.retake ? "retake" : "ready",
  } as unknown as LearningPhotoReport;
}

export interface KitV2LogOptions {
  /** `top-level session`: an id, the whole session record, or `null`. Default "S001". */
  readonly session?: string | SessionRecord | null;
  readonly sheet?: "A" | "B" | null;
  /** First file number, so two logs do not share file names. Default 1. */
  readonly firstFile?: number;
}

/** The shooting-order counters of a list of photos, as the sorter numbers shots: per participant and pose, from 1. */
function placements(photos: readonly KitV2SynthPhoto[]) {
  const counts = new Map<string, number>();
  return photos.map((photo) => {
    const key = `${photo.participant}/${photo.gesture}`;
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    const participant =
      photo.assignedTo === undefined ? photo.participant : photo.assignedTo;
    // A photo the sorter could not place has no pose, shot or filed copy.
    const placed = participant !== null;
    const shot = !placed ? null : photo.shot === undefined ? next : photo.shot;
    return {
      participant,
      placed,
      shot,
      destination:
        participant === null || shot === null
          ? null
          : `${participant}/${photo.gesture}/${shot}.jpg`,
    };
  });
}

/** The `destination` the log gives each photo (`null` for one the sorter could not place): the name a label carries. */
export function destinationsOf(
  photos: readonly KitV2SynthPhoto[],
): (string | null)[] {
  return placements(photos).map((p) => p.destination);
}

/** A format-3 run log (as parsed JSON), photos in the order given. */
export function kitV2LogOf(
  photos: readonly KitV2SynthPhoto[],
  options: KitV2LogOptions = {},
): Record<string, unknown> {
  let n = (options.firstFile ?? 1) - 1;
  const reports: LearningPhotoReport[] = [];
  const assignments: Record<string, unknown>[] = [];
  const placed = placements(photos);
  photos.forEach((photo, i) => {
    const file = `IMG_${String(++n).padStart(4, "0")}.jpg`;
    reports.push(reportOf(photo, file));
    const hand = photo.hand === undefined ? "right" : photo.hand;
    const p = placed[i]!;
    assignments.push({
      file,
      // The contract's KitV2PhotoAssignment, status and destination included.
      status: photo.status ?? (p.placed ? "ok" : "no-code"),
      destination: p.destination,
      participant: p.participant,
      gesture: p.placed ? photo.gesture : null,
      hand: p.placed ? hand : null,
      shot: p.shot,
      poseSource: "order",
      extraShot: photo.extraShot ?? false,
      poseCheck: photo.poseCheck ?? null,
    });
  });
  return {
    format: "open-mouse-learning-run/3",
    protocol: "agreed-v2",
    // The whole session record, as the sorter writes it.
    session:
      options.session === undefined ? sessionRecordOf("S001") : options.session,
    sheet: options.sheet === undefined ? "A" : options.sheet,
    createdAt: "2026-10-05T00:00:00.000Z",
    kitVersion: 2,
    gitSha: null,
    gitDirty: null,
    paperSize: "a4",
    input: null,
    reports,
    sort: { photos: assignments, coverage: [] },
  };
}

export function participantRecordOf(
  participant: string,
  fields: Partial<
    Pick<ParticipantRecord, "mouseHand" | "gripSelf" | "ageBand" | "session">
  > = {},
): ParticipantRecord {
  return {
    format: "open-mouse-learning-participant/1",
    participant,
    protocol: "agreed-v2",
    session: fields.session ?? "S001",
    mouseHand: fields.mouseHand === undefined ? "right" : fields.mouseHand,
    gripSelf: fields.gripSelf === undefined ? null : fields.gripSelf,
    ageBand: fields.ageBand === undefined ? null : fields.ageBand,
    note: "",
  };
}

export function sessionRecordOf(
  session: string,
  fields: Partial<Pick<SessionRecord, "phone" | "sheet">> = {},
): SessionRecord {
  return {
    format: "open-mouse-learning-session/1",
    session,
    protocol: "agreed-v2",
    date: "2026-10-05",
    timeBlock: "afternoon",
    venue: "club room",
    light: "ceiling LED",
    phone: fields.phone ?? "Phone A, main 1x",
    holding: "handheld",
    sheet: fields.sheet ?? "A",
    paperSize: "a4",
    printCheckMm: 100,
    note: "",
  };
}

/** The file name `kitV2LogOf` gives the n-th photo of a log (1-based). */
export const fileNameOf = (n: number, firstFile = 1): string =>
  `IMG_${String(firstFile + n - 1).padStart(4, "0")}.jpg`;

/** One of Kirby's calls in a `labels.json`. */
export interface SynthLabel {
  readonly file: string;
  readonly label: "good" | "bad" | null;
  readonly reasons?: readonly (typeof PHOTO_LABEL_REASONS)[number][];
  readonly note?: string;
}

/** A `labels.json` (`open-mouse-learning-labels/1`) for a session. */
export function labelsRecordOf(
  session: string,
  blind: boolean,
  labels: readonly SynthLabel[],
): LabelsRecord {
  return {
    format: "open-mouse-learning-labels/1",
    session,
    protocol: "agreed-v2",
    blind,
    labels: labels.map((l) => ({
      file: l.file,
      label: l.label,
      reasons: [...(l.reasons ?? [])],
      note: l.note ?? "",
    })),
  };
}

/** `P###` ids from a number range. */
export const ids = (first: number, last: number): string[] =>
  Array.from(
    { length: last - first + 1 },
    (_, i) => `P${String(first + i).padStart(3, "0")}`,
  );
