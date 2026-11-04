/**
 * v3.4 card reference (2026-11-05, candidate 未拍板): the hand measured from
 * one full-resolution shot with a card, ported from the scan lab
 * (`src/client/lab/hand/handMeasureLab.ts`, `cardOnlyHomography` +
 * `estimateHand`, nominal focal).
 *
 * The card's four corners alone (no motion sensor) give `H`, image px →
 * table mm: the corners are mapped to an upright 53.98 × 85.6 mm rectangle
 * (ID-1). The 21 landmarks are parallax-corrected on it with the product's
 * own correction (`correctLandmarksByHandLength`, heights scaled with the
 * hand) at the NOMINAL focal (18 mm on the stream's long edge) and the
 * crop's principal point. Every field of `MEASUREMENT_DEFINITIONS` comes
 * out (`measurementsFromSheetMm`), so the submission has the paper path's
 * shape.
 *
 * Why card-only and not card + tilt (coordinator, 2026-11-05, Kirby's 60
 * Galaxy S25 photos with A4 and card in the same frame): card-only was
 * closer to the A4 path than card + tilt. One phone, one hand (candidate
 * 未拍板).
 *
 * The scale (review G4): the submitted figures are the corrected ones times
 * ONE uniform factor, `CARD_TO_PAPER_SCALE`, on every length, so they sit on
 * the same corrected scale as a paper scan's and the display / fit path
 * applies `FIT_SCALE_FROM_CORRECTED` once, as for paper. (The lab's ×1.038,
 * `src/client/lab`, was against the tape and stacked with that fit scale:
 * the card showed ≈ A4 × 1.046.)
 *
 * Pure; never throws (a failure says why in `error`).
 */
import type { HandMeasurements } from "../../lib/contracts/measurement";
import { recoverCameraPose, type Intrinsics } from "../geometry/camera-pose";
import {
  applyHomography,
  estimateHomography,
  type Homography,
  type Point2,
} from "../geometry/homography";
import {
  correctLandmarksByHandLength,
  measurementsFromSheetMm,
} from "../geometry/measurements";
import type { CardSizeMm } from "./detect/cardMeasure";
import type { Quad } from "./detect/detectCard";

/**
 * The card path's one uniform scale onto the paper path's corrected scale
 * (review G4, candidate 未拍板), applied to every length of the corrected
 * card measurements.
 *
 * Basis: Kirby 60 S25 photos, A4 + card same frame, 2026-11-05: card-only
 * corrected / A4 corrected = 1.0078 (length, n=45, SD 0.0045) and 1.0078
 * (width); 1/1.0078 = 0.9922. After it, shown card − shown A4 = −0.03 mm,
 * SD 0.84.
 */
export const CARD_TO_PAPER_SCALE = 0.9922;

function dist(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Image px → table mm from the card's four corners alone: the corners go
 * to an upright `shortMm` × `longMm` rectangle, labelled so the first side
 * is the short one. Throws what `estimateHomography` throws.
 */
export function cardOnlyHomography(
  corners: Quad,
  cardSize: CardSizeMm,
): Homography {
  const d01 = dist(corners[0], corners[1]);
  const d12 = dist(corners[1], corners[2]);
  const c: Quad =
    d01 <= d12 ? corners : [corners[1], corners[2], corners[3], corners[0]];
  const w = cardSize.shortMm;
  const h = cardSize.longMm;
  const dst: Point2[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  return estimateHomography(c.map((src, i) => ({ src, dst: dst[i] })));
}

export type CardHandError = "card_homography" | "measurement";

export interface CardHandResult {
  /** What is submitted: corrected, every length × `CARD_TO_PAPER_SCALE`. */
  readonly measurements: HandMeasurements | null;
  /** The corrected length and width before the scale, mm. */
  readonly correctedLengthMm: number | null;
  readonly correctedWidthMm: number | null;
  /** The camera's height above the table, mm, from `H` and the focal. */
  readonly cameraHeightMm: number | null;
  readonly error: CardHandError | null;
  readonly detail: string | null;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** `measurements` with one uniform scale on every length (every `…Mm` field). */
export function applyCardScale(
  m: HandMeasurements,
  scale: number,
): HandMeasurements {
  const out: Record<string, unknown> = { ...m };
  for (const [key, value] of Object.entries(m))
    if (
      key.endsWith("Mm") &&
      typeof value === "number" &&
      Number.isFinite(value)
    )
      out[key] = value * scale;
  return out as HandMeasurements;
}

/** The hand on the table through the card's corners, nominal focal. */
export function measureHandWithCard(input: {
  readonly landmarksPx: readonly Point2[];
  readonly cardCorners: Quad;
  readonly intrinsics: Intrinsics;
  readonly cardSize: CardSizeMm;
}): CardHandResult {
  const empty = {
    measurements: null,
    correctedLengthMm: null,
    correctedWidthMm: null,
    cameraHeightMm: null,
  };
  let h: Homography;
  try {
    h = cardOnlyHomography(input.cardCorners, input.cardSize);
  } catch (e) {
    return { ...empty, error: "card_homography", detail: message(e) };
  }
  let cameraHeightMm: number | null = null;
  try {
    cameraHeightMm = recoverCameraPose(h, input.intrinsics).cameraHeightMm;
  } catch {
    cameraHeightMm = null;
  }
  try {
    const c = correctLandmarksByHandLength(
      input.landmarksPx,
      h,
      input.intrinsics,
    );
    const corrected = measurementsFromSheetMm(c.points);
    return {
      measurements: applyCardScale(corrected, CARD_TO_PAPER_SCALE),
      correctedLengthMm: corrected.handLengthMm,
      correctedWidthMm: corrected.palmWidthMm,
      cameraHeightMm,
      error: null,
      detail: null,
    };
  } catch (e) {
    return {
      ...empty,
      cameraHeightMm,
      error: "measurement",
      detail: message(e),
    };
  }
}

/** The card's corners on the table through `H` (a check of the fit). */
export function cardCornersMm(corners: Quad, h: Homography): Point2[] {
  return corners.map((p) => applyHomography(h, p));
}
