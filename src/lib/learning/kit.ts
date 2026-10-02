/**
 * Learning kit — the ground-truth data-collection sequence (Kirby,
 * 2026-09-27 and 2026-09-29): photograph many people's hands on printed
 * sheets whose QR codes say which pose each photo shows, then use those
 * photos to tune the blank-paper product.
 *
 * Everything here is pure and unit-tested (AGENTS hard rule 3): the pose
 * catalogue, the QR payload format, the capture order, and the sorter that
 * assigns a folder of photos to participants and poses. Photos themselves
 * never enter this module or the repo (hard rule 5; they live in
 * `../Fixtures/learning/`).
 *
 * No medical claims: poses G06–G07 collect angles and heights for research
 * into hand and wrist posture; nothing here diagnoses or advises.
 */

/**
 * The current kit: v2, protocol `agreed-v2` (2026-10-02). One A4 sheet, a
 * participant card in its slot, and the pose taken from the shooting order
 * instead of from a QR code on the page (see `session.ts` and
 * docs/learning/README.md, "Kit v2").
 */
export const LEARNING_KIT_VERSION = 2 as const;

/**
 * Kit v1: seven poses per hand, one QR code per pose, ruler truth. Its pages
 * (`KitPageSvg`, `SlatePageSvg`), its QR codes (`/l/v1/...`), `sortPhotos` and
 * `sortReports` keep working for it. A v1 photo seen by a v2 run is a version
 * mismatch.
 */
export const KIT_V1_VERSION = 1 as const;

/** Host the printed QR codes point at. Parsing accepts any host (local dev too). */
export const LEARNING_QR_BASE_URL = "https://open-mouse.vercel.app";

export type HandSide = "right" | "left";
export type Camera = "above" | "side";
/** Whether the sheet's top flap lies flat or is folded up for this pose. */
export type Flap = "flat" | "up";

export const GESTURE_CODES = [
  "G01",
  "G02",
  "G03",
  "G04",
  "G05",
  "G06",
  "G07",
] as const;
export type GestureCode = (typeof GESTURE_CODES)[number];

export interface Gesture {
  readonly code: GestureCode;
  readonly name: string;
  readonly camera: Camera;
  readonly flap: Flap;
  /** Photos per hand, re-placing the hand between each. */
  readonly shots: number;
  /** How to pose, one instruction per line, in order. */
  readonly steps: readonly string[];
  /** What the photos are for, in plain words. */
  readonly yields: string;
}

const TOP_DOWN_CAMERA =
  "Phone flat above the sheet, about 40 cm up, main 1× lens. The whole sheet and all four paper edges in the photo.";
const SIDE_CAMERA =
  "Phone on the table in front of the sheet, lens at table height, facing the folded-up strip square-on, about 40 cm away. Use the timer or a helper.";

/**
 * The capture order is the catalogue order: the five top-down poses with the
 * flap lying flat, then the two side poses with the flap folded up, so the
 * sheet changes state once per hand.
 */
export const GESTURES: readonly Gesture[] = [
  {
    code: "G01",
    name: "Flat, fingers together",
    camera: "above",
    flap: "flat",
    shots: 5,
    steps: [
      "Lay the hand flat, palm down, fingers together, thumb resting naturally beside the index finger.",
      "Middle finger along the dashed centre line, wrist crease on the wrist line.",
      TOP_DOWN_CAMERA,
      "Lift the hand and place it again before every photo.",
    ],
    yields:
      "Hand length, palm length, palm width and finger lengths. The five repeats are the M2 accuracy and repeatability gate.",
  },
  {
    code: "G02",
    name: "Flat, fingers spread",
    camera: "above",
    flap: "flat",
    shots: 3,
    steps: [
      "Lay the hand flat, palm down, fingers spread comfortably wide, thumb out to the side.",
      "Middle finger along the dashed centre line, wrist crease on the wrist line.",
      TOP_DOWN_CAMERA,
      "Lift the hand and place it again before every photo.",
    ],
    yields:
      "Finger lengths without neighbouring fingers hiding joints, and the thumb-to-little-finger span.",
  },
  {
    code: "G03",
    name: "Palm grip",
    camera: "above",
    flap: "flat",
    shots: 3,
    steps: [
      "Hold the hand as if resting it on a mouse: the whole palm low and relaxed, fingers gently curved.",
      "Keep the palm heel on the wrist line and the middle finger over the centre line.",
      TOP_DOWN_CAMERA,
      "Relax and form the grip again before every photo.",
    ],
    yields:
      "Grip aperture and thumb angle for a palm grip, so a stated grip can be checked against the hand's shape.",
  },
  {
    code: "G04",
    name: "Claw grip",
    camera: "above",
    flap: "flat",
    shots: 3,
    steps: [
      "Arch the fingers as if clawing a mouse: knuckles raised, fingertips down, palm heel on the sheet.",
      "Palm heel on the wrist line, middle finger over the centre line.",
      TOP_DOWN_CAMERA,
      "Relax and form the grip again before every photo.",
    ],
    yields: "Grip aperture and thumb angle for a claw grip.",
  },
  {
    code: "G05",
    name: "Fingertip grip",
    camera: "above",
    flap: "flat",
    shots: 3,
    steps: [
      "Lift the palm off the sheet so only the fingertips and thumb tip touch, as if holding a small mouse by its edges.",
      "Keep the hand centred over the centre line, wrist above the wrist line.",
      TOP_DOWN_CAMERA,
      "Relax and form the grip again before every photo.",
    ],
    yields: "Grip aperture and thumb angle for a fingertip grip.",
  },
  {
    code: "G06",
    name: "Side, hand flat",
    camera: "side",
    flap: "up",
    shots: 3,
    steps: [
      "Fold this page's top flap up along the dashed line and stand it against a book or box.",
      "Lay the hand flat, palm down, along the fold, little-finger side touching the folded-up strip. Right hand: fingers point left. Left hand: fingers point right.",
      SIDE_CAMERA,
      "Lift the hand and place it again before every photo.",
    ],
    yields:
      "Palm thickness and knuckle height from the side profile. The strip sits about half a palm width behind the hand's midline; the recorded palm width lets the analysis correct for that.",
  },
  {
    code: "G07",
    name: "Side, palm grip",
    camera: "side",
    flap: "up",
    shots: 3,
    steps: [
      "Same side-view page and fold as G06.",
      "Hold the palm-grip pose from G03 along the fold, little-finger side towards the strip, forearm resting on the table.",
      SIDE_CAMERA,
      "Relax and form the grip again before every photo.",
    ],
    yields:
      "Knuckle height and hand pitch in a mouse-holding posture, for research into hand and wrist angles. Research data only; not a health assessment.",
  },
];

export function gestureByCode(code: GestureCode): Gesture {
  const gesture = GESTURES.find((g) => g.code === code);
  if (!gesture) throw new Error(`Unknown gesture ${code}`);
  return gesture;
}

// ── QR payloads ─────────────────────────────────────────────────────────────

export type KitCode =
  | {
      readonly kind: "gesture";
      readonly version: number;
      readonly gesture: GestureCode;
      readonly hand: HandSide;
    }
  | {
      readonly kind: "participant";
      readonly version: number;
      readonly participant: string;
    };

const PARTICIPANT_RE = /^P(\d{3})$/;
const GESTURE_TOKEN_RE = /^(G0[1-7])([RL])$/;
const URL_PATH_RE = /\/l\/v(\d+)\/([A-Za-z0-9]+)\/?$/;

/** Participant ids are P001–P999: never a name, so a photo carries no identity. */
export function formatParticipantId(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 999) {
    throw new Error(`Participant number must be 1–999, got ${n}`);
  }
  return `P${String(n).padStart(3, "0")}`;
}

/** The short token printed under each QR code: "G03R" or "P007". */
export function kitCodeToken(code: KitCode): string {
  return code.kind === "participant"
    ? code.participant
    : `${code.gesture}${code.hand === "right" ? "R" : "L"}`;
}

/**
 * The QR content: a URL of the form /l/v<version>/<token>, and the same
 * string identifies the photo for the checker and the sorter. The pages are
 * served only by a local dev server (production answers 404, Kirby 2026-09-30),
 * so scanning a printed code with a phone does not open them; the code is read
 * from the photo.
 */
export function kitCodeUrl(
  code: KitCode,
  base: string = LEARNING_QR_BASE_URL,
): string {
  return `${base.replace(/\/+$/, "")}/l/v${code.version}/${kitCodeToken(code)}`;
}

/**
 * Parse a bare token ("G03R", "P007") at a given kit version. A bare token
 * names no version; unless the caller says otherwise it is read as kit v1, the
 * only form that existed before QR codes carried a version. Every code kit v2
 * prints is a URL with its version in it (`/l/v2/P007`).
 */
export function parseKitToken(
  token: string,
  version: number = KIT_V1_VERSION,
): KitCode | null {
  const t = token.trim().toUpperCase();
  const participant = PARTICIPANT_RE.exec(t);
  if (participant) {
    const n = Number(participant[1]);
    if (n < 1) return null;
    return { kind: "participant", version, participant: t };
  }
  const gesture = GESTURE_TOKEN_RE.exec(t);
  if (gesture) {
    return {
      kind: "gesture",
      version,
      gesture: gesture[1] as GestureCode,
      hand: gesture[2] === "R" ? "right" : "left",
    };
  }
  return null;
}

/**
 * Parse whatever a QR decoder returned: the kit URL on any host, or a bare
 * token. Anything else (another QR code in the photo, garbage) is `null`.
 */
export function parseKitCode(text: string): KitCode | null {
  const trimmed = text.trim();
  const fromUrl = URL_PATH_RE.exec(trimmed.split(/[?#]/)[0] ?? "");
  if (fromUrl) {
    const version = Number(fromUrl[1]);
    if (!Number.isInteger(version) || version < 1) return null;
    return parseKitToken(fromUrl[2] ?? "", version);
  }
  if (/[/:]/.test(trimmed)) return null;
  return parseKitToken(trimmed);
}

// ── Capture sequence ────────────────────────────────────────────────────────

export interface SequenceStep {
  /** 1-based position in the session. */
  readonly index: number;
  readonly gesture: Gesture;
  readonly hand: HandSide;
  /** 1-based shot number within this pose and hand. */
  readonly shot: number;
  readonly shots: number;
}

/**
 * The session order for one participant: all poses for the first hand, then
 * all for the second. The participant slate photo comes before step 1 and is
 * not a step. Right hand first by default, matching the product's default.
 */
export function buildSequence(
  hands: readonly HandSide[] = ["right", "left"],
): SequenceStep[] {
  const unique = [...new Set(hands)];
  const steps: SequenceStep[] = [];
  for (const hand of unique) {
    for (const gesture of GESTURES) {
      for (let shot = 1; shot <= gesture.shots; shot++) {
        steps.push({
          index: steps.length + 1,
          gesture,
          hand,
          shot,
          shots: gesture.shots,
        });
      }
    }
  }
  return steps;
}

/** Photos per hand for a full session (excluding the slate). */
export function shotsPerHand(): number {
  return GESTURES.reduce((sum, g) => sum + g.shots, 0);
}

// ── Sorting a folder of photos ──────────────────────────────────────────────

export interface IdentifiedPhoto {
  /** File name as found in the input folder. */
  readonly file: string;
  /** Capture order: EXIF time or file time, earlier first. Ties keep input order. */
  readonly takenAt: number;
  /** The kit code read from the photo's QR, or `null` if none was readable. */
  readonly code: KitCode | null;
  /** MediaPipe's handedness, when a hand was found. */
  readonly detectedHand?: HandSide | null;
}

export type SortStatus =
  | "slate"
  | "ok"
  | "hand-mismatch"
  | "no-code"
  | "no-participant"
  | "version-mismatch"
  /** Kit v2 only: filed, but the pose check disagrees with the shooting order. */
  | "pose-mismatch"
  /** Kit v2 only: the participant's photos cannot be placed by order without guessing; none is filed. */
  | "needs-review";

export interface SortedPhoto {
  readonly file: string;
  readonly status: SortStatus;
  readonly participant: string | null;
  readonly gesture: GestureCode | null;
  readonly hand: HandSide | null;
  /** 1-based shot number within participant + pose + hand, counting only usable photos. */
  readonly shot: number | null;
  /** Relative destination, e.g. "P007/G03R/2.jpg"; `null` if the photo is not filed. */
  readonly destination: string | null;
}

export interface CoverageRow {
  readonly participant: string;
  readonly gesture: GestureCode;
  readonly hand: HandSide;
  readonly expected: number;
  readonly got: number;
}

export interface SortResult {
  readonly photos: readonly SortedPhoto[];
  /** Per participant, per hand that appears, per pose: expected vs filed shots. */
  readonly coverage: readonly CoverageRow[];
}

/** The file's extension, lower-case with its dot, or ".jpg" when it has none. */
export function extensionOf(file: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(file);
  return m ? `.${(m[1] ?? "jpg").toLowerCase()}` : ".jpg";
}

/**
 * Kit v1: assign photos to participants and poses. A participant slate photo
 * starts that participant's block; every later pose photo belongs to it until
 * the next slate (the film-clapperboard pattern). The pose and hand come from
 * the photo's own QR code, never from its position in the folder, so a skipped
 * or repeated photo cannot shift the ones after it. (Kit v2 takes the pose
 * from the shooting order instead: `sortPhotosV2` in `sortv2.ts`.)
 *
 * A pose photo whose detected hand contradicts its sheet is still filed (the
 * sheet is the ground truth of what was asked) but flagged, because it is the
 * likeliest sign the wrong page was used.
 */
export function sortPhotos(
  photos: readonly IdentifiedPhoto[],
  version: number = KIT_V1_VERSION,
): SortResult {
  const ordered = photos
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.takenAt - b.p.takenAt || a.i - b.i)
    .map(({ p }) => p);

  let participant: string | null = null;
  const counts = new Map<string, number>();
  const handsSeen = new Map<string, Set<HandSide>>();
  const sorted: SortedPhoto[] = [];

  for (const photo of ordered) {
    const code = photo.code;
    if (!code) {
      sorted.push({
        file: photo.file,
        status: "no-code",
        participant,
        gesture: null,
        hand: null,
        shot: null,
        destination: null,
      });
      continue;
    }
    if (code.version !== version) {
      sorted.push({
        file: photo.file,
        status: "version-mismatch",
        participant,
        gesture: code.kind === "gesture" ? code.gesture : null,
        hand: code.kind === "gesture" ? code.hand : null,
        shot: null,
        destination: null,
      });
      continue;
    }
    if (code.kind === "participant") {
      participant = code.participant;
      if (!handsSeen.has(participant)) handsSeen.set(participant, new Set());
      sorted.push({
        file: photo.file,
        status: "slate",
        participant,
        gesture: null,
        hand: null,
        shot: null,
        destination: `${participant}/slate${extensionOf(photo.file)}`,
      });
      continue;
    }
    if (!participant) {
      sorted.push({
        file: photo.file,
        status: "no-participant",
        participant: null,
        gesture: code.gesture,
        hand: code.hand,
        shot: null,
        destination: null,
      });
      continue;
    }
    const key = `${participant}/${code.gesture}${code.hand === "right" ? "R" : "L"}`;
    const shot = (counts.get(key) ?? 0) + 1;
    counts.set(key, shot);
    handsSeen.get(participant)?.add(code.hand);
    const mismatch =
      photo.detectedHand != null && photo.detectedHand !== code.hand;
    sorted.push({
      file: photo.file,
      status: mismatch ? "hand-mismatch" : "ok",
      participant,
      gesture: code.gesture,
      hand: code.hand,
      shot,
      destination: `${key}/${shot}${extensionOf(photo.file)}`,
    });
  }

  const coverage: CoverageRow[] = [];
  for (const [who, hands] of handsSeen) {
    for (const hand of (["right", "left"] as const).filter((h) =>
      hands.has(h),
    )) {
      for (const gesture of GESTURES) {
        const key = `${who}/${gesture.code}${hand === "right" ? "R" : "L"}`;
        coverage.push({
          participant: who,
          gesture: gesture.code,
          hand,
          expected: gesture.shots,
          got: counts.get(key) ?? 0,
        });
      }
    }
  }

  return { photos: sorted, coverage };
}
