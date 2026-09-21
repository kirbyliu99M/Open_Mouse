/**
 * MediaPipe landmarks (image px) → HandMeasurements (sheet mm).
 *
 * Reads its arithmetic straight from `MEASUREMENT_DEFINITIONS` in
 * src/lib/contracts/measurement.ts rather than re-encoding it, so this stays
 * correct by construction if that contract's definitions are ever extended.
 * "distance" is a straight line; "chain" sums consecutive segment lengths
 * (never a straight line from base to tip, which undercounts a curled
 * finger).
 */
import {
  MEASUREMENT_DEFINITIONS,
  handMeasurementsSchema,
  type HandMeasurements,
} from "../../lib/contracts/measurement";
import { applyHomography, type Homography, type Point2 } from "./homography";

/** MediaPipe Hand Landmarker: 21 joint-centre landmarks, image pixels. */
export type Landmark = Point2;

const EXPECTED_LANDMARK_COUNT = 21;

type DefinitionKind = "distance" | "chain";

interface ParsedDefinition {
  kind: DefinitionKind;
  indices: number[];
}

const DEFINITION_PATTERN = /^(distance|chain)\(([\d,\s]+)\)$/;

function parseDefinition(field: string, definition: string): ParsedDefinition {
  const match = DEFINITION_PATTERN.exec(definition);
  if (!match) {
    throw new Error(
      `Unrecognised measurement definition for ${field}: "${definition}"`,
    );
  }
  const kind = match[1] as DefinitionKind;
  const indices = match[2].split(",").map((s) => Number(s.trim()));
  if (kind === "distance" && indices.length !== 2) {
    throw new Error(
      `"distance" definition for ${field} needs exactly 2 indices.`,
    );
  }
  if (kind === "chain" && indices.length < 2) {
    throw new Error(
      `"chain" definition for ${field} needs at least 2 indices.`,
    );
  }
  return { kind, indices };
}

function distanceMm(points: readonly Point2[], a: number, b: number): number {
  return Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
}

function chainMm(
  points: readonly Point2[],
  indices: readonly number[],
): number {
  let total = 0;
  for (let i = 1; i < indices.length; i++) {
    total += distanceMm(points, indices[i - 1], indices[i]);
  }
  return total;
}

/**
 * Project 21 MediaPipe landmarks through the homography into sheet mm, then
 * compute every field in `MEASUREMENT_DEFINITIONS`. The result is validated
 * against `handMeasurementsSchema` before being returned, so an
 * implausible measurement (or a bug) fails loudly here rather than reaching
 * the server.
 */
export function computeHandMeasurements(
  landmarks: readonly Landmark[],
  homography: Homography,
): HandMeasurements {
  if (landmarks.length !== EXPECTED_LANDMARK_COUNT) {
    throw new RangeError(
      `computeHandMeasurements expects ${EXPECTED_LANDMARK_COUNT} MediaPipe landmarks, got ${landmarks.length}.`,
    );
  }

  const points = landmarks.map((landmark) =>
    applyHomography(homography, landmark),
  );

  const measurements: Record<string, number> = {};
  for (const [field, definition] of Object.entries(MEASUREMENT_DEFINITIONS)) {
    const { kind, indices } = parseDefinition(field, definition);
    measurements[field] =
      kind === "distance"
        ? distanceMm(points, indices[0], indices[1])
        : chainMm(points, indices);
  }

  return handMeasurementsSchema.parse(measurements);
}
