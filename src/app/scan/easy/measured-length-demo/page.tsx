import type { Metadata } from "next";
import EasyScanCamera from "@/client/camera/EasyScanCamera";
import { guardDemoRouteFromProduction } from "../../demo-guard";
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
} from "../../demo-photo";

export const metadata: Metadata = {
  title: "Easy scan measured, typed length (mock data)",
  description:
    "Dev/demo route rendering the easy-scan measured bottom sheet for a scan calibrated by a typed-in hand length — no camera, no MediaPipe.",
  robots: { index: false, follow: false },
};

/**
 * The typed-length twin of `/scan/easy/measured-demo`: a real photo cannot be
 * made to reach this sheet (no synthetic image makes MediaPipe find a hand),
 * so this is the only deterministic way to see and test what the sheet says
 * when the hand length was entered rather than measured.
 */
const DEMO_SUBMISSION = scanSubmissionSchema.parse({
  hand: "right",
  measurements: {
    handLengthMm: 186,
    palmLengthMm: 106,
    palmWidthMm: 80,
    thumbLengthMm: 57,
    indexLengthMm: 67,
    middleLengthMm: 73,
    ringLengthMm: 68,
    pinkyLengthMm: 53,
  },
  calibration: {
    method: "user-length",
    referenceMeasurement: "handLengthMm",
    referenceMm: 186,
    parallaxCorrected: false,
  },
  measurementModelVersion: MEASUREMENT_MODEL_VERSION,
});

const DEMO_OVERLAY: PhotoOverlay = {
  imageWidth: DEMO_IMAGE_WIDTH,
  imageHeight: DEMO_IMAGE_HEIGHT,
  markers: [],
  card: null,
  landmarksPx: DEMO_LANDMARKS_PX,
  handedness: "right",
};

export default function EasyScanMeasuredLengthDemoPage() {
  guardDemoRouteFromProduction();
  return (
    <EasyScanCamera
      demoMeasured={{
        previewUrl: buildDemoPhotoUrl("paper"),
        overlay: DEMO_OVERLAY,
        measurements: DEMO_SUBMISSION.measurements,
        submission: DEMO_SUBMISSION,
        imageWidth: DEMO_IMAGE_WIDTH,
        imageHeight: DEMO_IMAGE_HEIGHT,
      }}
    />
  );
}
