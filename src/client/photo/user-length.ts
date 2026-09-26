import {
  handMeasurementsSchema,
  LANDMARK,
  type HandMeasurements,
} from "../../lib/contracts/measurement";
import { computeHandMeasurements } from "../geometry/measurements";
import type { Homography, Point2 } from "../geometry/homography";

export const USER_LENGTH_RETAKE =
  "The palm proportions look implausible — keep your whole hand flat, fingers together, and retake from directly above.";

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
