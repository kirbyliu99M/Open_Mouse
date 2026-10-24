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

/**
 * The model the client measures with today. `landmark-raw-v2` (2026-10-04)
 * keeps the raw landmark distances of v1 but corrects parallax with
 * per-landmark heights that scale with hand length (`landmark-heights-v2`,
 * docs/research/landmark-heights-v2.md); v1 used 21 fixed heights. The stored
 * version is what tells the two apart.
 *
 * `landmark-raw-v3` (V3.2 candidate, 未拍板; Kirby 2026-10-22): the same
 * distances and heights as v2, but a photo with no EXIF focal length and no
 * trustworthy homography estimate is still corrected for parallax, with a
 * nominal focal length (design R7 `DESIGN-nominal-focal.md`: 18 mm
 * equivalent on a live video frame's long edge since 2026-10-23, from Kirby's
 * S25 measurements; 26 mm for a still photo with no EXIF). Before v3 such frames were not
 * corrected at all. A v3 measurement says where its focal length came from
 * (`focalSource` on the calibration evidence).
 */
export const MEASUREMENT_MODEL_VERSION = "landmark-raw-v3";

/**
 * Every measurement model the server accepts. Clients send the one they
 * measured with (`MEASUREMENT_MODEL_VERSION` today). A calibrated model (W7)
 * is appended here, so clients still on the old one keep working through a
 * deploy instead of getting a 400. Written as literals, not derived from
 * `MEASUREMENT_MODEL_VERSION`: bumping the current version must never
 * silently drop an old one from this list.
 */
export const MEASUREMENT_MODEL_VERSIONS = [
  "landmark-raw-v1",
  "landmark-raw-v2",
  "landmark-raw-v3",
] as const;

/**
 * Where a parallax correction's focal length came from (landmark-raw-v3).
 * `exif`: the photo's own EXIF; `homography`: estimated from the sheet and
 * inside the plausible range around the nominal one; `nominal`: the nominal
 * prior; `none`: no correction was made.
 */
export const FOCAL_LENGTH_SOURCES = [
  "exif",
  "homography",
  "nominal",
  "none",
] as const;
export type FocalLengthSource = (typeof FOCAL_LENGTH_SOURCES)[number];

/**
 * The engine's scale (V3.2 candidate, 未拍板; Kirby 2026-10-22, design R7).
 * The fit engine, the hand type, the survey bins and the similar-hand cells
 * were all tuned on frame scans with NO parallax correction. A scan that WAS
 * corrected (`parallaxCorrected: true`, any focal source) is multiplied by
 * these ratios before any of them reads it, so a corrected hand ranks like
 * the same hand did before correction, while corrections stay consistent
 * across distance, tilt and capture path. The person sees the same engine-
 * scale numbers (Kirby, D1 = B). Simulated for a frame path at a paper fill
 * of 0.65 (Kirby's measured average 0.653). 2026-10-23 (F17, Kirby D2): the
 * live-frame prior moved from 26 mm to 18 mm equivalent after seven S25
 * homography estimates all read 894-1153 px (0.62-0.80 of the 26 mm prior);
 * the ratios were recomputed at 998 px. Kirby's measured ratios at the old
 * prior (median kL 1.041, kP 1.056, kW 1.036, n = 8) are not comparable.
 * One phone only; an iPhone is not checked (不確定).
 * 2026-10-24 (Kirby, D5): replaced by the S25 ratios MEASURED at the 18 mm
 * prior, from near-straight scans only (tilted scans read a smaller ratio
 * because their uncorrected numbers carry a different bias; the corrected
 * numbers agree across tilt, 177.4-186.1 mm over 7 scans). Measured kL sat
 * about 1.2 % above the simulation at both priors (1.039 vs 1.024 at 26 mm,
 * 1.047 vs 1.035 at 18 mm), so the simulation's hand-height model likely
 * under-states the parallax a little (不確定, n = 3).
 */
export const FIT_SCALE_FROM_CORRECTED = {
  handLength: 1.047,
  palmLength: 1.067,
  palmWidth: 1.044,
  referenceFill: 0.65,
  basis: "S25 measured at the 18 mm frame prior, 2026-10-24: median uncorrected/corrected of 3 near-straight frame scans (tilt <= 4 deg, fill 0.41-0.67); R7 simulation gave 1.035/1.061/1.051",
} as const;
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
  /** landmark-raw-v3: see `FOCAL_LENGTH_SOURCES`. Absent before v3. */
  focalSource: z.enum(FOCAL_LENGTH_SOURCES).optional(),
});

/** Where a paper-edge calibration's four corners came from (V3.2 candidate,
 * 未拍板; Kirby 2026-10-21). `auto`: the detector's corners, unchanged.
 * `adjusted`: the detector's corners, moved by the person. `manual`: placed by
 * the person after detection failed. The homography and every millimetre
 * formula are the same for all three; only the source differs. */
export const PAPER_CORNER_SOURCES = ["auto", "adjusted", "manual"] as const;
export type PaperCornerSource = (typeof PAPER_CORNER_SOURCES)[number];

/**
 * Plain paper: four corners from the paper's own edges.
 *
 * `cornersSource` absent means `auto` (every body sent before V3.2). For
 * `auto`, `edgeFitResidualMm` and `minSideCoverage` are required as before:
 * they describe the fitted edges the corners came from. For `adjusted` and
 * `manual` they may be left out, because no fitted edge stands behind a
 * corner the person placed, and a number there would claim a check that did
 * not happen. When present they still obey the same limits.
 */
export const paperEdgeEvidenceSchema = z
  .strictObject({
    method: z.literal("paper-edge"),
    paperSize: z.enum(
      Object.keys(PAPER_SIZES_MM) as [PaperSize, ...PaperSize[]],
    ),
    /** V3.2 candidate: see `PAPER_CORNER_SOURCES`. Absent = `auto`. */
    cornersSource: z.enum(PAPER_CORNER_SOURCES).optional(),
    /** Mean distance of detected edge points from their fitted side, in mm. */
    edgeFitResidualMm: z
      .number()
      .finite()
      .min(0)
      .max(PAPER_EDGE_LIMITS.maxEdgeFitResidualMm, {
        message:
          "The paper's edges don't fit a flat sheet — is it curled or folded?",
      })
      .optional(),
    /** Smallest fraction of any side's length that was seen, 0–1. */
    minSideCoverage: z
      .number()
      .finite()
      .max(1)
      .min(PAPER_EDGE_LIMITS.minSideCoverage, {
        message: "Too much of one paper edge is hidden to trust its corners.",
      })
      .optional(),
    parallaxCorrected: z.boolean(),
    /** landmark-raw-v3: see `FOCAL_LENGTH_SOURCES`. Absent before v3. */
    focalSource: z.enum(FOCAL_LENGTH_SOURCES).optional(),
  })
  .superRefine((e, ctx) => {
    if ((e.cornersSource ?? "auto") !== "auto") return;
    if (e.edgeFitResidualMm === undefined)
      ctx.addIssue({
        code: "custom",
        path: ["edgeFitResidualMm"],
        message: "Detected corners need their edge-fit residual.",
      });
    if (e.minSideCoverage === undefined)
      ctx.addIssue({
        code: "custom",
        path: ["minSideCoverage"],
        message: "Detected corners need their side coverage.",
      });
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
 * Typed numbers, no photo (Kirby, 2026-10-11; ratio and layout OK 2026-10-12,
 * candidate until M2 data exists): the user types hand length and hand width
 * in centimetres (stored as millimetres) and the typed pair replaces a scan.
 * Palm length is not typed, it is ESTIMATED as `MANUAL_ENTRY.palmLengthRatio`
 * times the hand length, so `palmLengthEstimated` is always true and the
 * ratio used is stored with the scan; a later, measured ratio can then be
 * applied to old rows. Because the estimate is the same fraction for every
 * hand, the fit engine's palm-over-hand grip prediction carries no information
 * here: a manual-entry submission MUST state a grip (`gripStyleStated`, see
 * `scanSubmissionSchema`). No photo, so no scale reference and no parallax;
 * M2 accuracy statistics must exclude this method.
 *
 * Known scale mismatch (candidate, 2026-10-12; measured on one hand,
 * 2026-10-17): a scan's palmWidthMm is a joint-centre distance (landmarks 5 to
 * 17), which the notes above put 10-20 mm under a skin-to-skin width. The
 * typed values are skin measurements stored as typed. On Kirby's hand the gap
 * was 19 mm, not "slightly": a ruler breadth of 85 mm against a scan's
 * 65.7 mm (ratio 0.77). Typed 85 sent the fit to wide mice (Scimitar Elite
 * first; G903 Hero, the mouse he actually likes, 319th of 402 mice, and still
 * 326th after this conversion, because its LENGTH score is 22: the claw length
 * target is 0.62 of the hand). So (Kirby: OK, 2026-10-17) the typed WIDTH is
 * converted to the scan's scale, by `MANUAL_ENTRY.widthToLandmarkScale`, for
 * scoring only: the stored value, the typed value the page shows and the
 * contract's own checks stay as typed. The factor is a candidate from that one
 * pair (and a ratio, where the 10-20 mm above reads more like a constant); a
 * versioned typed-to-landmark mapping fitted on paired ruler and scan data
 * replaces it (the small collection of 2026-10-17). The length is not
 * converted: on that hand a ruler length from the wrist crease (190 mm) and the
 * scans' mean (189.4 mm) agree within 1 mm, but that is two errors of about
 * 6 mm cancelling (no parallax correction on the video-frame path against a
 * joint-centre length shorter than the skin length), so a scan that does
 * correct would read about 6 mm short of a ruler. Typed scans stay out of the
 * similar-hand pool, and the results page still discloses the estimate.
 */
export const manualEntryEvidenceSchema = z.strictObject({
  method: z.literal("manual-entry"),
  /** The typed hand length, mm. Must equal `measurements.handLengthMm`. */
  handLengthMm: z.number().finite().min(135).max(265),
  /** The typed hand width, mm. Must equal `measurements.palmWidthMm`. */
  handWidthMm: z.number().finite().min(50).max(150),
  palmLengthEstimated: z.literal(true),
  /** The palm-length / hand-length ratio the estimate used. */
  palmLengthRatio: z.number().finite().min(0.4).max(0.7),
  parallaxCorrected: z.literal(false),
});

/**
 * Constants of the typed-number path. All candidates (not M2-calibrated):
 * the length range is the same 135-265 mm the typed-length scan accepts, and
 * the width band 0.38-0.56 of the hand length is the plausibility band the
 * scan gates use, read here as skin-to-skin width.
 */
export const MANUAL_ENTRY = {
  handLengthRangeMm: { min: 135, max: 265 },
  handWidthRangeMm: { min: 50, max: 150 },
  widthOverLengthBand: { min: 0.38, max: 0.56 },
  /** Midpoint of the claw-grip band of fit v1 (0.54-0.58). Placeholder. */
  palmLengthRatio: 0.56,
  /**
   * A typed (ruler, skin-to-skin) hand width times this is the width on the
   * engine's scale (landmarks 5 to 17; since landmark-raw-v3 the engine
   * scale of `FIT_SCALE_FROM_CORRECTED`, about 0.74 on the corrected landmark
   * scale), so a typed width and a scanned width
   * enter the fit on the same scale. It converts skin to landmarks only and
   * does not depend on any engine's grip-width factor (v1 x 0.88, v3 x 1.00).
   * Candidate, from ONE pair: 65.7 mm scanned against 85 mm ruler (Kirby,
   * 2026-10-17). Applied for scoring only.
   */
  widthToLandmarkScale: 0.77,
} as const;

/** Estimated palm length for a typed hand length, to 0.1 mm. */
export function estimatePalmLengthMm(handLengthMm: number): number {
  return Math.round(handLengthMm * MANUAL_ENTRY.palmLengthRatio * 10) / 10;
}

/**
 * Any calibration method. The printed sheet keeps its original shape (no
 * `method` field) so clients built before plain paper still parse.
 */
export const calibrationEvidenceSchema = z.union([
  printedSheetEvidenceSchema,
  paperEdgeEvidenceSchema,
  userLengthEvidenceSchema,
  manualEntryEvidenceSchema,
]);

/**
 * How a scan was calibrated. The printed sheet predates the `method` tag, so
 * its evidence carries none; the others name themselves. Stored with the
 * scan (#63) so M2 validation and aggregate stats can tell the paths apart.
 */
export const CALIBRATION_METHODS = [
  "printed-sheet",
  "paper-edge",
  "user-length",
  "manual-entry",
] as const;
export type CalibrationMethod = (typeof CALIBRATION_METHODS)[number];

export function calibrationMethodOf(
  evidence: z.infer<typeof calibrationEvidenceSchema>,
): CalibrationMethod {
  return "method" in evidence ? evidence.method : "printed-sheet";
}

/**
 * The user's own answer to "how thick is your palm", a three-way choice shown
 * after the scan (candidate, 2026-10-08). It is a rough self-report, not a
 * measurement: no millimetre value is implied, and it is unrelated to the
 * measured `palmThicknessMm`, which stays a separate optional field. The three
 * labels order the hand from flat to full and nothing more.
 */
export const PALM_THICKNESS_LEVELS = ["thin", "medium", "thick"] as const;
export type PalmThicknessLevel = (typeof PALM_THICKNESS_LEVELS)[number];

/**
 * Strict: an unexpected field fails the parse instead of being silently
 * stripped, so a client that tries to send an image is rejected loudly.
 *
 * `palmThicknessStated` (candidate, 2026-10-08) follows `gripStyleStated`:
 * what the user said, stored with the scan in the nullable column
 * `scans.palm_thickness_stated` (migration 0008, #155; a skip is stored as
 * NULL), absent when they skipped the question. A client MUST omit the field
 * on a skip. It never sends `"medium"` as a default, because a default would
 * be stored as if the user had chosen it. Fit v1 reads it
 * (`fit-v1-candidate.3`, candidate, 2026-10-11): the answer shifts the height
 * target by -1.5 / 0 / +1.5 mm for thin / medium / thick, and no answer means
 * no shift (docs/fit-algorithm.md §3). The 1.5 mm is an uncalibrated
 * placeholder. v0 never reads it; the vertical-mouse candidate (#142) stays off.
 */
export const scanSubmissionSchema = z
  .strictObject({
    hand: z.enum(["left", "right"]),
    gripStyleStated: z.enum(["palm", "claw", "fingertip"]).optional(),
    palmThicknessStated: z.enum(PALM_THICKNESS_LEVELS).optional(),
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
    if ("method" in s.calibration && s.calibration.method === "manual-entry") {
      const c = s.calibration;
      const m = s.measurements;
      if (Math.abs(m.handLengthMm - c.handLengthMm) > 0.05) {
        ctx.addIssue({
          code: "custom",
          path: ["measurements", "handLengthMm"],
          message: "With manual entry, handLengthMm must be the typed length.",
        });
      }
      if (Math.abs(m.palmWidthMm - c.handWidthMm) > 0.05) {
        ctx.addIssue({
          code: "custom",
          path: ["measurements", "palmWidthMm"],
          message: "With manual entry, palmWidthMm must be the typed width.",
        });
      }
      if (Math.abs(m.palmLengthMm - c.handLengthMm * c.palmLengthRatio) > 0.1) {
        ctx.addIssue({
          code: "custom",
          path: ["measurements", "palmLengthMm"],
          message:
            "With manual entry, palmLengthMm must be handLengthMm times the stated palmLengthRatio.",
        });
      }
      const widthOverLength = c.handWidthMm / c.handLengthMm;
      if (
        widthOverLength < MANUAL_ENTRY.widthOverLengthBand.min ||
        widthOverLength > MANUAL_ENTRY.widthOverLengthBand.max
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["calibration", "handWidthMm"],
          message:
            "The typed hand width does not fit the typed hand length (width / length outside 0.38-0.56).",
        });
      }
      // No photo, so the palm-over-hand ratio is the same for every hand: the
      // engine cannot predict a grip from it and the user has to state one.
      if (s.gripStyleStated === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["gripStyleStated"],
          message: "Manual entry needs a stated grip style.",
        });
      }
      // Optional scan-only fields would mix scan values into a typed record.
      for (const key of [
        "thumbLengthMm",
        "indexLengthMm",
        "middleLengthMm",
        "ringLengthMm",
        "pinkyLengthMm",
        "palmThicknessMm",
        "knuckleHeightMm",
        "gripApertureMm",
        "thumbAngleDeg",
      ] as const) {
        if (m[key] !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["measurements", key],
            message: `With manual entry, ${key} must be absent.`,
          });
        }
      }
    }
  });

/**
 * `GET /api/scans/{scanId}/measurements` (routes.ts): what the 3D viewer needs
 * to scale the hand model. The values the scan stored, to 0.1 mm; optional
 * fields the scan never had are absent, never null.
 */
export const scanMeasurementsResponseSchema = z.strictObject({
  scanId: z.string().uuid(),
  hand: z.enum(["left", "right"]),
  measurements: handMeasurementsSchema,
});

export type HandMeasurements = z.infer<typeof handMeasurementsSchema>;
export type ScanMeasurementsResponse = z.infer<
  typeof scanMeasurementsResponseSchema
>;
export type CalibrationEvidence = z.infer<typeof calibrationEvidenceSchema>;
export type PrintedSheetEvidence = z.infer<typeof printedSheetEvidenceSchema>;
export type PaperEdgeEvidence = z.infer<typeof paperEdgeEvidenceSchema>;
export type UserLengthEvidence = z.infer<typeof userLengthEvidenceSchema>;
export type ManualEntryEvidence = z.infer<typeof manualEntryEvidenceSchema>;
export type ScanSubmission = z.infer<typeof scanSubmissionSchema>;
