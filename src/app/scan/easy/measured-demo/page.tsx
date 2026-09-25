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
  title: "Easy scan measured (mock data) — Open_Mouse",
  description:
    "Dev/demo route rendering the easy-scan measured bottom sheet against fixed, schema-valid measurements — no camera, no MediaPipe.",
  robots: { index: false, follow: false },
};

/**
 * Same fixed measurements as `/scan/paper-edge-measured-demo`, wired
 * through EasyScanCamera's `demoMeasured` prop instead of ScanClient's — no
 * synthetic e2e photo makes MediaPipe detect a hand, so this is the only
 * deterministic way to reach and screenshot the easy-scan measured sheet.
 */
const DEMO_SUBMISSION = scanSubmissionSchema.parse({
  hand: "right",
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

const PAPER_INSET = 20;
const DEMO_OVERLAY: PhotoOverlay = {
  imageWidth: DEMO_IMAGE_WIDTH,
  imageHeight: DEMO_IMAGE_HEIGHT,
  markers: [],
  card: null,
  landmarksPx: DEMO_LANDMARKS_PX,
  handedness: "right",
  paperCorners: [
    { x: PAPER_INSET, y: PAPER_INSET },
    { x: DEMO_IMAGE_WIDTH - PAPER_INSET, y: PAPER_INSET },
    { x: DEMO_IMAGE_WIDTH - PAPER_INSET, y: DEMO_IMAGE_HEIGHT - PAPER_INSET },
    { x: PAPER_INSET, y: DEMO_IMAGE_HEIGHT - PAPER_INSET },
  ],
};

export default function EasyScanMeasuredDemoPage() {
  guardDemoRouteFromProduction();
  return (
    <EasyScanCamera
      demoMeasured={{
        previewUrl: DEMO_PHOTO_URL,
        overlay: DEMO_OVERLAY,
        measurements: DEMO_SUBMISSION.measurements,
        submission: DEMO_SUBMISSION,
        imageWidth: DEMO_IMAGE_WIDTH,
        imageHeight: DEMO_IMAGE_HEIGHT,
      }}
    />
  );
}
