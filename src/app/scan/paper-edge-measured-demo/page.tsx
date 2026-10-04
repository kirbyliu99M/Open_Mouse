import type { Metadata } from "next";
import ScanClient from "../ScanClient";
import { guardDemoRouteFromProduction } from "../demo-guard";
import {
  MEASUREMENT_MODEL_VERSION,
  scanSubmissionSchema,
} from "@/lib/contracts/measurement";
import type { PhotoOverlay } from "@/client/photo/pipeline";
import {
  DEMO_IMAGE_WIDTH,
  DEMO_IMAGE_HEIGHT,
  DEMO_LANDMARKS_PX,
  buildDemoPhotoUrl,
} from "../demo-photo";
import "../scan.css";

export const metadata: Metadata = {
  title: "Scan measured, paper-edge (mock data)",
  description:
    "Dev/demo route rendering /scan's measured state in paper-edge mode against fixed, schema-valid measurements — no photo, no MediaPipe. Mirrors /scan/measured-demo for the future blank-paper calibration path (see src/client/paper/detect.ts).",
  robots: { index: false, follow: false },
};

/**
 * The paper-edge counterpart to `/scan/measured-demo`: same fixed
 * measurements, but a `calibration` shaped for `paperEdgeEvidenceSchema`
 * (method/paperSize/edgeFitResidualMm/minSideCoverage/parallaxCorrected)
 * instead of the printed-sheet shape — so the measured card's caption
 * reads "All four paper corners were found, so the scale is checked."
 * never "sheet markers and the card" (Kirby, 2026-09-25).
 */
const DEMO_SUBMISSION = scanSubmissionSchema.parse({
  hand: "right",
  gripStyleStated: "claw",
  measurements: {
    handLengthMm: 190,
    palmLengthMm: 108,
    palmWidthMm: 84,
    thumbLengthMm: 58,
    indexLengthMm: 68,
    middleLengthMm: 74,
    ringLengthMm: 69,
    pinkyLengthMm: 54,
  },
  calibration: {
    method: "paper-edge",
    paperSize: "a4",
    edgeFitResidualMm: 0.6,
    minSideCoverage: 0.92,
    parallaxCorrected: true,
  },
  measurementModelVersion: MEASUREMENT_MODEL_VERSION,
});

const DEMO_PHOTO_URL = buildDemoPhotoUrl("paper");

const DEMO_OVERLAY: PhotoOverlay = {
  imageWidth: DEMO_IMAGE_WIDTH,
  imageHeight: DEMO_IMAGE_HEIGHT,
  markers: [],
  card: null,
  landmarksPx: DEMO_LANDMARKS_PX,
};

export default function ScanPaperEdgeMeasuredDemoPage() {
  guardDemoRouteFromProduction();
  return (
    <ScanClient
      demoLabel="Demo — sample measurements (paper-edge)"
      calibrationMode="paper-edge"
      demoMeasured={{
        hand: DEMO_SUBMISSION.hand,
        gripStyle: "claw",
        measurements: DEMO_SUBMISSION.measurements,
        submission: DEMO_SUBMISSION,
        overlay: DEMO_OVERLAY,
        previewUrl: DEMO_PHOTO_URL,
      }}
    />
  );
}
