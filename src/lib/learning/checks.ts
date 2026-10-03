/**
 * Per-photo checks for the learning kit: given what the browser found in a
 * photo, decide whether it can be filed or must be retaken, with one plain
 * reason per failed check. Pure; the image work happens in
 * `src/client/learning/analyse.ts`.
 */
import { GATE_THRESHOLDS } from "../../client/photo/gates";
import { SHEET } from "../contracts/measurement";
import {
  LEARNING_KIT_VERSION,
  gestureByCode,
  type HandSide,
  type KitCode,
} from "./kit";
import type { KitV2Sheet } from "./session";

export type CheckTone = "ok" | "warn" | "bad";

export interface LearningCheck {
  readonly id:
    "qr" | "markers" | "fit" | "sharp" | "hand" | "handedness" | "paper";
  readonly tone: CheckTone;
  readonly message: string;
}

export type LearningVerdict = "slate" | "ready" | "retake" | "unidentified";

export interface LearningFindings {
  readonly code: KitCode | null;
  readonly markerIds: readonly number[];
  /** Flat-marker homography fit; `null` when fewer than four were found. */
  readonly reprojectionErrorMm: number | null;
  readonly laplacianVariance: number;
  readonly handFound: boolean;
  readonly detectedHand: HandSide | null;
  /** Paper corners found from the sheet's own edges (0–4). */
  readonly paperCornersSeen: number;
  /**
   * Set for a kit v2 photo: the sheet it was taken on. The pose is not on the
   * page (the order gives it), the QR code is the participant card's, and a
   * hand is expected whatever the code says.
   */
  readonly sheet?: KitV2Sheet;
}

const has = (ids: readonly number[], wanted: readonly number[]) =>
  wanted.filter((id) => !ids.includes(id));

const SHEET_B_MARKER_COUNT = 6;
const SHEET_B_MIN_MARKERS = 4;

/**
 * Kit v2: the checks for a photo of sheet A or B. Every photo carries its
 * participant card's QR code, and the pose is not read from the photo at all,
 * so there is no pose, hand or card branch here. A photo the product would
 * refuse still gets a verdict, but the verdict only advises: kit v2 files every
 * photo that names a participant, because dropping one would shift the shooting
 * order of the rest.
 */
function evaluateKitV2Photo(f: LearningFindings): {
  readonly checks: readonly LearningCheck[];
  readonly verdict: LearningVerdict;
} {
  const checks: LearningCheck[] = [];
  const sheet = f.sheet!;
  const sharp: LearningCheck =
    f.laplacianVariance >= GATE_THRESHOLDS.minLaplacianVariance
      ? { id: "sharp", tone: "ok", message: "Sharp enough." }
      : {
          id: "sharp",
          tone: "bad",
          message:
            "Blurry. Hold the phone still, or tap to focus on the sheet.",
        };

  if (!f.code) {
    checks.push({
      id: "qr",
      tone: "bad",
      message:
        "No participant card QR code found. Keep the card in its slot, uncovered and in focus.",
    });
    checks.push(sharp);
    return { checks, verdict: "unidentified" };
  }
  if (f.code.version !== LEARNING_KIT_VERSION) {
    checks.push({
      id: "qr",
      tone: "bad",
      message: `This is a kit v${f.code.version} code and this run is kit v${LEARNING_KIT_VERSION}. Use a kit v${LEARNING_KIT_VERSION} participant card.`,
    });
    checks.push(sharp);
    return { checks, verdict: "unidentified" };
  }
  if (f.code.kind !== "participant") {
    checks.push({
      id: "qr",
      tone: "bad",
      message:
        "This is a pose page's code, not a participant card. Kit v2 sheets carry no pose code: put a participant card in the slot.",
    });
    checks.push(sharp);
    return { checks, verdict: "unidentified" };
  }
  checks.push({
    id: "qr",
    tone: "ok",
    message: `Participant ${f.code.participant}.`,
  });

  if (sheet === "A") {
    const missing = has(f.markerIds, SHEET.flatMarkerIds);
    checks.push(
      missing.length === 0
        ? {
            id: "markers",
            tone: "ok",
            message: "All four corner markers found.",
          }
        : {
            id: "markers",
            tone: "bad",
            message: `Corner marker${missing.length > 1 ? "s" : ""} ${missing.join(", ")} not found. Keep all four corner squares in the photo, uncovered.`,
          },
    );
  } else {
    const found = [...new Set(f.markerIds)].filter(
      (id) => id >= 0 && id < SHEET_B_MARKER_COUNT,
    );
    const topRow = found.filter((id) => id === 0 || id === 1);
    if (found.length < SHEET_B_MIN_MARKERS) {
      checks.push({
        id: "markers",
        tone: "bad",
        message: `Only ${found.length} of ${SHEET_B_MARKER_COUNT} markers found, and ${SHEET_B_MIN_MARKERS} are needed. Keep the markers at the edge of the sheet in the photo, uncovered.`,
      });
    } else if (topRow.length === 0) {
      checks.push({
        id: "markers",
        tone: "warn",
        message: `${found.length} of ${SHEET_B_MARKER_COUNT} markers found, but neither top marker (0, 1): the plane is carried over the hand from the bottom row alone.`,
      });
    } else {
      checks.push({
        id: "markers",
        tone: "ok",
        message: `${found.length} of ${SHEET_B_MARKER_COUNT} markers found (${SHEET_B_MIN_MARKERS} are enough).`,
      });
    }
  }
  if (f.reprojectionErrorMm !== null) {
    checks.push(
      f.reprojectionErrorMm <= GATE_THRESHOLDS.maxReprojectionErrorMm
        ? {
            id: "fit",
            tone: "ok",
            message: `Markers fit a flat sheet (${f.reprojectionErrorMm.toFixed(2)} mm).`,
          }
        : {
            id: "fit",
            tone: "bad",
            message: `Markers don't fit a flat sheet (${f.reprojectionErrorMm.toFixed(2)} mm). Flatten the page and use the main 1× lens, not ultra-wide.`,
          },
    );
  }
  checks.push(
    f.paperCornersSeen === 4
      ? { id: "paper", tone: "ok", message: "All four paper corners found." }
      : {
          id: "paper",
          tone: "warn",
          message: `Only ${f.paperCornersSeen} of 4 paper corners found, so this photo gives no blank-paper comparison. Use a darker table and keep all four paper edges in view.`,
        },
  );
  checks.push(sharp);
  checks.push(
    f.handFound
      ? { id: "hand", tone: "ok", message: "Hand found." }
      : {
          id: "hand",
          tone: "bad",
          message:
            "No hand found. Kit v2 files the photo anyway: a failure is data.",
        },
  );
  const verdict = checks.some((c) => c.tone === "bad") ? "retake" : "ready";
  return { checks, verdict };
}

export function evaluateLearningPhoto(f: LearningFindings): {
  readonly checks: readonly LearningCheck[];
  readonly verdict: LearningVerdict;
} {
  if (f.sheet) return evaluateKitV2Photo(f);
  const checks: LearningCheck[] = [];
  const sharp: LearningCheck =
    f.laplacianVariance >= GATE_THRESHOLDS.minLaplacianVariance
      ? { id: "sharp", tone: "ok", message: "Sharp enough." }
      : {
          id: "sharp",
          tone: "bad",
          message:
            "Blurry. Hold the phone still, or tap to focus on the sheet.",
        };

  if (!f.code) {
    checks.push({
      id: "qr",
      tone: "bad",
      message:
        "No kit QR code found. Keep the page's QR code in the photo, uncovered and in focus.",
    });
    checks.push(sharp);
    return { checks, verdict: "unidentified" };
  }

  if (f.code.kind === "participant") {
    checks.push({
      id: "qr",
      tone: "ok",
      message: `Participant card ${f.code.participant}. Photos after this one are filed under it.`,
    });
    return { checks, verdict: "slate" };
  }

  const gesture = gestureByCode(f.code.gesture);
  checks.push({
    id: "qr",
    tone: "ok",
    message: `${gesture.code}${f.code.hand === "right" ? "R" : "L"}: ${gesture.name}, ${f.code.hand} hand.`,
  });

  if (gesture.camera === "above") {
    const missing = has(f.markerIds, SHEET.flatMarkerIds);
    checks.push(
      missing.length === 0
        ? {
            id: "markers",
            tone: "ok",
            message: "All four corner markers found.",
          }
        : {
            id: "markers",
            tone: "bad",
            message: `Corner marker${missing.length > 1 ? "s" : ""} ${missing.join(", ")} not found. Keep all four corner squares in the photo, uncovered.`,
          },
    );
    if (f.reprojectionErrorMm !== null) {
      checks.push(
        f.reprojectionErrorMm <= GATE_THRESHOLDS.maxReprojectionErrorMm
          ? {
              id: "fit",
              tone: "ok",
              message: `Markers fit a flat sheet (${f.reprojectionErrorMm.toFixed(2)} mm).`,
            }
          : {
              id: "fit",
              tone: "bad",
              message: `Markers don't fit a flat sheet (${f.reprojectionErrorMm.toFixed(2)} mm). Flatten the page and use the main 1× lens, not ultra-wide.`,
            },
      );
    }
    checks.push(
      f.paperCornersSeen === 4
        ? { id: "paper", tone: "ok", message: "All four paper corners found." }
        : {
            id: "paper",
            tone: "warn",
            message: `Only ${f.paperCornersSeen} of 4 paper corners found, so this photo gives no blank-paper comparison. Use a darker table and keep all four paper edges in view.`,
          },
    );
  } else {
    const missing = has(f.markerIds, [4, 5]);
    checks.push(
      missing.length === 0
        ? { id: "markers", tone: "ok", message: "Both strip markers found." }
        : {
            id: "markers",
            tone: "bad",
            message: `Strip marker${missing.length > 1 ? "s" : ""} ${missing.join(", ")} not found. Stand the flap upright and face it square-on.`,
          },
    );
  }

  checks.push(sharp);

  if (!f.handFound) {
    checks.push({
      id: "hand",
      tone: gesture.camera === "above" ? "bad" : "warn",
      message:
        gesture.camera === "above"
          ? "No hand found. Keep the whole hand on the sheet and in the photo."
          : "No hand found from the side. The photo can still be kept for later analysis.",
    });
  } else {
    checks.push({ id: "hand", tone: "ok", message: "Hand found." });
    if (f.detectedHand && f.detectedHand !== f.code.hand) {
      checks.push({
        id: "handedness",
        tone: "warn",
        message: `This looks like a ${f.detectedHand} hand on a ${f.code.hand}-hand page. Check the page matches the hand.`,
      });
    }
  }

  const verdict = checks.some((c) => c.tone === "bad") ? "retake" : "ready";
  return { checks, verdict };
}

/** Natural file-name order, which is capture order for phone cameras (IMG_0009 < IMG_0010). */
export function compareFileNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}
