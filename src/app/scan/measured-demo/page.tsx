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
  title: "Scan measured (mock data) — Open_Mouse",
  description:
    "Dev/demo route rendering /scan's measured state against fixed, schema-valid measurements — no photo, no MediaPipe. Exists because no e2e fixture can make MediaPipe detect a hand in a synthetic image (see tests/e2e/scan.spec.ts).",
  robots: { index: false, follow: false },
};

/**
 * A fixed, schema-valid `ScanSubmission` (validated below, not just typed).
 * Mirrors `/scan/submit-demo`'s reason for existing, one step earlier in the
 * flow: this is the only deterministic way to reach and screenshot the
 * measured layout (chips, "Hand measured" card, primary/secondary actions)
 * in CI.
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
    markerIds: [0, 1, 2, 3],
    reprojectionErrorMm: 0.4,
    cardScaleRatio: 1.0,
    parallaxCorrected: false,
  },
  measurementModelVersion: MEASUREMENT_MODEL_VERSION,
});

const DEMO_PHOTO_URL = buildDemoPhotoUrl("sheet");

const DEMO_OVERLAY: PhotoOverlay = {
  imageWidth: DEMO_IMAGE_WIDTH,
  imageHeight: DEMO_IMAGE_HEIGHT,
  markers: [],
  card: null,
  landmarksPx: DEMO_LANDMARKS_PX,
};

export default function ScanMeasuredDemoPage() {
  guardDemoRouteFromProduction();
  return (
    <ScanClient
      demoLabel="Demo — sample measurements"
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
