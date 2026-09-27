import {
  handMeasurementsSchema,
  LANDMARK,
  type HandMeasurements,
} from "../../lib/contracts/measurement";
import { computeHandMeasurements } from "../geometry/measurements";
import type { Homography, Point2 } from "../geometry/homography";

interface UserLengthFailure {
  readonly code: "FINGER_NOT_STRAIGHT" | "HAND_TILTED";
  readonly message: string;
}

export const USER_LENGTH_RETAKE =
  "The palm proportions look implausible — keep your whole hand flat, fingers together, and retake from directly above.";

// Candidate — tune on M2 photos. A flat middle finger's joint chain is
// almost collinear with the wrist-to-tip line; curling lengthens that chain.
export const MIN_MIDDLE_FINGER_STRAIGHTNESS = 0.95;
// Candidate screening band derived from adult skin-to-skin palm proportions.
// This gate instead compares landmark joint centres (5↔17 over 0↔12), so the
// skin-based derivation does not directly apply: 5↔17 can read 10–20 mm narrower
// than skin breadth, and the landmark ratio may sit lower. MUST measure this
// band on real M2 photos before deploy.
export const USER_LENGTH_PALM_RATIO = { min: 0.38, max: 0.56 } as const;

function distance(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Pure pose check on the unscaled image landmarks. */
export function checkUserLengthStraightness(
  landmarks: readonly Point2[],
): UserLengthFailure | null {
  const middle = [0, 9, 10, 11, 12];
  if (landmarks.length !== 21) {
    return {
      code: "FINGER_NOT_STRAIGHT",
      message: "Straighten your fingers and lay your hand flat, then retake.",
    };
  }
  const chain = middle
    .slice(1)
    .reduce(
      (sum, index, step) =>
        sum + distance(landmarks[middle[step]], landmarks[index]),
      0,
    );
  const ratio = distance(landmarks[0], landmarks[12]) / chain;
  if (Number.isFinite(ratio) && ratio >= MIN_MIDDLE_FINGER_STRAIGHTNESS)
    return null;
  return {
    code: "FINGER_NOT_STRAIGHT",
    message: "Straighten your fingers and lay your hand flat, then retake.",
  };
}

/** Pure proportion check after typed-length measurement. */
export function checkUserLengthProportion(
  measurements: HandMeasurements,
): UserLengthFailure | null {
  const ratio = measurements.palmWidthMm / measurements.handLengthMm;
  if (
    Number.isFinite(ratio) &&
    ratio >= USER_LENGTH_PALM_RATIO.min &&
    ratio <= USER_LENGTH_PALM_RATIO.max
  )
    return null;
  return {
    code: "HAND_TILTED",
    message:
      "The photo looks tilted — hold the phone flat, straight above your hand, and retake.",
  };
}

/** A similarity transform: photo pixels to millimetres, anchored at the wrist. */
export function userLengthHomography(
  landmarks: readonly Point2[],
  handLengthMm: number,
): Homography {
  if (
    landmarks.length !== 21 ||
    !Number.isFinite(handLengthMm) ||
    handLengthMm < 100 ||
    handLengthMm > 280
  ) {
    throw new RangeError(
      "Hand length must be between 100 and 280 mm with all 21 landmarks present.",
    );
  }
  const wrist = landmarks[LANDMARK.wrist];
  const tip = landmarks[LANDMARK.middle[3]];
  const distancePx = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
  if (!Number.isFinite(distancePx) || distancePx < 1)
    throw new RangeError(USER_LENGTH_RETAKE);
  const scale = handLengthMm / distancePx;
  return [
    [scale, 0, -wrist.x * scale],
    [0, scale, -wrist.y * scale],
    [0, 0, 1],
  ];
}

export function measureWithUserLength(
  landmarks: readonly Point2[],
  handLengthMm: number,
): HandMeasurements {
  const homography = userLengthHomography(landmarks, handLengthMm);
  let raw: HandMeasurements;
  try {
    raw = computeHandMeasurements(landmarks, homography);
  } catch {
    throw new RangeError(USER_LENGTH_RETAKE);
  }
  // The reference is entered by the user, never reported as a photo measurement.
  const parsed = handMeasurementsSchema.safeParse({ ...raw, handLengthMm });
  if (!parsed.success) throw new RangeError(USER_LENGTH_RETAKE);
  return parsed.data;
}

export function parseUserLength(value: string): number | null {
  if (value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 100 && number <= 280
    ? number
    : null;
}
