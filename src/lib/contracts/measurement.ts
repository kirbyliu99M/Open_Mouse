/**
 * Measurement contract — the ONLY thing the browser sends about a hand.
 * Images never leave the device; these millimetres are all the server sees.
 *
 * Frontend builders compute these; backend builders validate and store them.
 * Change this file only in a contract PR of its own, carrying no more than the
 * minimal consumer updates (storage included) that keep `main` green.
 */
import { z } from "zod";

// ── Calibration sheet geometry (docs/PLAN.md §M2) ───────────────────────────

/**
 * Flat-flap marker layout. The four markers' OUTER edges span 180 mm, so the
 * layout fits A4 (210 mm wide) and US Letter (215.9 mm) with ≥15 mm side
 * margins — printers cannot print to the paper edge. Centres therefore sit on
 * a 155 mm square. The hand may extend past the markers: the homography plane
 * is the table surface, which the sheet lies flat on.
 * Use all 16 marker corners for the homography, not just 4 centres.
 */
export const SHEET = {
  markerLayoutOuterMm: 180,
  markerSizeMm: 25,
  markerCentreSquareMm: 155,
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

/**
 * Plain-paper calibration (2026-09-25, Kirby): any blank sheet of a known
 * size is the scale reference — its four corners, found from its edges, give
 * the homography. No printing, so no printer-scaling risk. Portrait mm.
 * The size cannot be told apart reliably from one photo (A4 and Letter
 * differ by 6 %), so the user picks it; A4 is the default.
 */
export const PAPER_SIZES_MM = {
  a4: { width: 210, height: 297 },
  letter: { width: 215.9, height: 279.4 },
} as const;
export type PaperSize = keyof typeof PAPER_SIZES_MM;

/**
 * Candidate limits for a plain-paper scan, to be tuned against the M2 ruler
 * ground truth: the mean distance of edge points from their fitted side, and
 * the smallest fraction of any side's length that was actually seen (the
 * wrist usually hides part of one edge).
 */
export const PAPER_EDGE_LIMITS = {
  maxEdgeFitResidualMm: 1.5,
  minSideCoverage: 0.4,
} as const;

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

/**
 * Every measurement model the server accepts. Clients send the one they
 * measured with (`MEASUREMENT_MODEL_VERSION` today). A calibrated model (W7)
 * is appended here, so clients still on the old one keep working through a
 * deploy instead of getting a 400. Written as literals, not derived from
 * `MEASUREMENT_MODEL_VERSION`: bumping the current version must never
 * silently drop an old one from this list.
 */
export const MEASUREMENT_MODEL_VERSIONS = ["landmark-raw-v1"] as const;
export type MeasurementModelVersion =
  (typeof MEASUREMENT_MODEL_VERSIONS)[number];

// ── Payload ─────────────────────────────────────────────────────────────────

const mm = (min: number, max: number) => z.number().finite().min(min).max(max);

const FINGER_KEYS = [
  "thumbLengthMm",
  "indexLengthMm",
  "middleLengthMm",
  "ringLengthMm",
  "pinkyLengthMm",
] as const;

export const handMeasurementsSchema = z
  .strictObject({
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
  })
  // #63: a finger is part of the hand, so every finger chain is shorter than
  // wrist-to-middle-fingertip. Only invariants that hold for any real hand
  // are enforced here; proportion bands need M2 data first.
  .superRefine((m, ctx) => {
    for (const key of FINGER_KEYS) {
      const value = m[key];
      if (value !== undefined && value >= m.handLengthMm) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} must be shorter than handLengthMm`,
        });
      }
    }
  });

/** Printed calibration sheet: ArUco markers + bank-card cross-check. */
export const printedSheetEvidenceSchema = z.strictObject({
  /** The flat-flap markers detected: exactly ids 0–3, each once. */
  markerIds: z
    .array(z.number().int())
    .length(4)
    .refine(
      (ids) =>
        new Set(ids).size === 4 &&
        ids.every((id) =>
          (SHEET.flatMarkerIds as readonly number[]).includes(id),
        ),
      { message: "markerIds must be the four distinct flat-flap markers 0–3." },
    ),
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

/** Plain paper: four corners from the paper's own edges. */
export const paperEdgeEvidenceSchema = z.strictObject({
  method: z.literal("paper-edge"),
  paperSize: z.enum(Object.keys(PAPER_SIZES_MM) as [PaperSize, ...PaperSize[]]),
  /** Mean distance of detected edge points from their fitted side, in mm. */
  edgeFitResidualMm: z
    .number()
    .finite()
    .min(0)
    .max(PAPER_EDGE_LIMITS.maxEdgeFitResidualMm, {
      message:
        "The paper's edges don't fit a flat sheet — is it curled or folded?",
    }),
  /** Smallest fraction of any side's length that was seen, 0–1. */
  minSideCoverage: z
    .number()
    .finite()
    .max(1)
    .min(PAPER_EDGE_LIMITS.minSideCoverage, {
      message: "Too much of one paper edge is hidden to trust its corners.",
    }),
  parallaxCorrected: z.boolean(),
});

/**
 * No paper at all (Kirby, 2026-09-26): the user measures their own hand
 * length — wrist crease to middle fingertip — with a ruler and types it in;
 * that one length sets the photo's scale. Weaker than a reference object:
 * no perspective correction (so never parallax-corrected), and every other
 * measurement inherits the user's ruler error. The submitted
 * `measurements.handLengthMm` must equal `referenceMm` (see
 * `scanSubmissionSchema`) — it is the user's number, not a measurement.
 *
 * Known bias (PR #69 review, 2026-09-26): the ruler measures skin, wrist
 * crease to fingertip, while the photo scale comes from the landmark
 * distance 0→12 (joint centres; the tip landmark sits inside the fingertip).
 * The landmark distance is shorter, so a typed length makes every derived
 * measurement slightly too large, and this method stores an anthropometric
 * hand length where the other methods store the raw landmark distance.
 * The size of the offset is unknown until the M2 ruler ground truth exists;
 * any correction is a **candidate** decision for Kirby, not applied here.
 */
export const userLengthEvidenceSchema = z.strictObject({
  method: z.literal("user-length"),
  referenceMeasurement: z.literal("handLengthMm"),
  referenceMm: z.number().finite().min(100).max(280),
  parallaxCorrected: z.literal(false),
});

/**
 * Any calibration method. The printed sheet keeps its original shape (no
 * `method` field) so clients built before plain paper still parse.
 */
export const calibrationEvidenceSchema = z.union([
  printedSheetEvidenceSchema,
  paperEdgeEvidenceSchema,
  userLengthEvidenceSchema,
]);

/**
 * How a scan was calibrated. The printed sheet predates the `method` tag, so
 * its evidence carries none; the other two name themselves. Stored with the
 * scan (#63) so M2 validation and aggregate stats can tell the paths apart.
 */
export const CALIBRATION_METHODS = [
  "printed-sheet",
  "paper-edge",
  "user-length",
] as const;
export type CalibrationMethod = (typeof CALIBRATION_METHODS)[number];

export function calibrationMethodOf(
  evidence: z.infer<typeof calibrationEvidenceSchema>,
): CalibrationMethod {
  return "method" in evidence ? evidence.method : "printed-sheet";
}

/**
 * Strict: an unexpected field fails the parse instead of being silently
 * stripped, so a client that tries to send an image is rejected loudly.
 */
export const scanSubmissionSchema = z
  .strictObject({
    hand: z.enum(["left", "right"]),
    gripStyleStated: z.enum(["palm", "claw", "fingertip"]).optional(),
    measurements: handMeasurementsSchema,
    calibration: calibrationEvidenceSchema,
    measurementModelVersion: z.enum(MEASUREMENT_MODEL_VERSIONS),
  })
  .superRefine((s, ctx) => {
    if (
      "method" in s.calibration &&
      s.calibration.method === "user-length" &&
      Math.abs(s.measurements.handLengthMm - s.calibration.referenceMm) > 0.05
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["measurements", "handLengthMm"],
        message:
          "With a typed-in hand length, handLengthMm must be that length.",
      });
    }
  });

export type HandMeasurements = z.infer<typeof handMeasurementsSchema>;
export type CalibrationEvidence = z.infer<typeof calibrationEvidenceSchema>;
export type PrintedSheetEvidence = z.infer<typeof printedSheetEvidenceSchema>;
export type PaperEdgeEvidence = z.infer<typeof paperEdgeEvidenceSchema>;
export type UserLengthEvidence = z.infer<typeof userLengthEvidenceSchema>;
export type ScanSubmission = z.infer<typeof scanSubmissionSchema>;
