/**
 * Measurement contract — the ONLY thing the browser sends about a hand.
 * Images never leave the device; these millimetres are all the server sees.
 *
 * Frontend builders compute these; backend builders validate and store them.
 * Change this file only in a PR of its own.
 */
import { z } from "zod";

// ── Calibration sheet geometry (docs/PLAN.md §M2) ───────────────────────────

/** ArUco marker centres sit on this square; identical on A4 and US Letter. */
export const SHEET = {
  markerSquareMm: 180,
  /** Side length of each printed marker, black border included. */
  markerSizeMm: 30,
  /** js-aruco2 dictionary. Marker ids 0–3 = flat flap, clockwise from top-left. */
  dictionary: "ARUCO_MIP_36h12",
  flatMarkerIds: [0, 1, 2, 3] as const,
  /** Upright (folded) flap for the side shot, left → right along the fold. */
  uprightMarkerIds: [4, 5] as const,
  /** Printed verification ruler, for the user to check printer scaling. */
  rulerMm: 100,
} as const;

/** ISO/IEC 7810 ID-1 — any bank card. The independent scale cross-check. */
export const ID1_CARD_MM = { width: 85.6, height: 53.98 } as const;

/** Sheet-vs-card scale disagreement beyond this blocks the scan. */
export const MAX_SCALE_DISAGREEMENT = 0.01;

// ── MediaPipe landmark definitions ──────────────────────────────────────────
//
// MediaPipe Hand Landmarker indices: 0 wrist; thumb 1 CMC · 2 MCP · 3 IP · 4 TIP;
// index 5–8, middle 9–12, ring 13–16, pinky 17–20 (MCP · PIP · DIP · TIP).
//
// Landmarks are JOINT CENTRES, not skin edges. Two consequences builders must
// respect rather than "fix" silently:
//  • palmWidthMm from 5↔17 underestimates true knuckle breadth (skin to skin)
//    by the joint radii — plausibly 10–20 mm.
//  • handLengthMm from 0↔12 runs to the fingertip landmark, which sits slightly
//    inside the fingertip skin.
// The raw landmark distances are what the browser sends. The correction to
// anthropometric values is a separate, versioned calibration derived from
// Kirby's ruler ground truth in the M2 gate — see `MEASUREMENT_MODEL_VERSION`.

export const LANDMARK = {
  wrist: 0,
  thumb: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
} as const;

/**
 * How each measurement is derived, in sheet-plane millimetres (after the
 * homography). Chains sum consecutive segment lengths — never a straight
 * line from base to tip, which undercounts a slightly curled finger.
 */
export const MEASUREMENT_DEFINITIONS = {
  handLengthMm: "distance(0, 12)",
  palmLengthMm: "distance(0, 9)",
  palmWidthMm: "distance(5, 17)",
  thumbLengthMm: "chain(2, 3, 4)",
  indexLengthMm: "chain(5, 6, 7, 8)",
  middleLengthMm: "chain(9, 10, 11, 12)",
  ringLengthMm: "chain(13, 14, 15, 16)",
  pinkyLengthMm: "chain(17, 18, 19, 20)",
} as const;

export const MEASUREMENT_MODEL_VERSION = "landmark-raw-v1";

// ── Payload ─────────────────────────────────────────────────────────────────

const mm = (min: number, max: number) => z.number().finite().min(min).max(max);

export const handMeasurementsSchema = z
  .object({
    // Top-down shot — required.
    handLengthMm: mm(100, 280),
    palmLengthMm: mm(60, 160),
    palmWidthMm: mm(50, 150),
    thumbLengthMm: mm(20, 120).optional(),
    indexLengthMm: mm(30, 140).optional(),
    middleLengthMm: mm(30, 150).optional(),
    ringLengthMm: mm(30, 140).optional(),
    pinkyLengthMm: mm(20, 120).optional(),
    // Side shot.
    palmThicknessMm: mm(10, 80).optional(),
    knuckleHeightMm: mm(10, 80).optional(),
    // Grip shot.
    gripApertureMm: mm(20, 200).optional(),
    thumbAngleDeg: z.number().finite().min(0).max(180).optional(),
  })
  .refine((m) => m.palmLengthMm < m.handLengthMm, {
    message: "palmLengthMm must be shorter than handLengthMm",
    path: ["palmLengthMm"],
  });

export const calibrationEvidenceSchema = z.object({
  /** Which flat-flap markers were detected; all four are required. */
  markerIds: z.array(z.number().int()).length(4),
  /** Mean corner reprojection error of the homography, in mm on the sheet. */
  reprojectionErrorMm: z.number().finite().min(0).max(5),
  /** (scale from sheet) ÷ (scale from card). 1 = perfect agreement. */
  cardScaleRatio: z
    .number()
    .finite()
    .refine((r) => Math.abs(r - 1) <= MAX_SCALE_DISAGREEMENT, {
      message:
        "Sheet and card scales disagree by more than 1% — the printer probably scaled the page.",
    }),
  parallaxCorrected: z.boolean(),
});

export const scanSubmissionSchema = z.object({
  hand: z.enum(["left", "right"]),
  gripStyleStated: z.enum(["palm", "claw", "fingertip"]).optional(),
  measurements: handMeasurementsSchema,
  calibration: calibrationEvidenceSchema,
  measurementModelVersion: z.literal(MEASUREMENT_MODEL_VERSION),
});

export type HandMeasurements = z.infer<typeof handMeasurementsSchema>;
export type CalibrationEvidence = z.infer<typeof calibrationEvidenceSchema>;
export type ScanSubmission = z.infer<typeof scanSubmissionSchema>;
