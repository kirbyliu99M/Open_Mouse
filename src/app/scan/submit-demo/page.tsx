import type { Metadata } from "next";
import ScanSubmitPanel from "../ScanSubmitPanel";
import { guardDemoRouteFromProduction } from "../demo-guard";
import {
  MEASUREMENT_MODEL_VERSION,
  scanSubmissionSchema,
} from "@/lib/contracts/measurement";
import "../scan.css";

export const metadata: Metadata = {
  title: "Scan submit (mock data) — Open_Mouse",
  description:
    "Dev/demo route rendering the scan submit UI against a fixed, schema-valid ScanSubmission — no photo, no MediaPipe.",
  robots: { index: false, follow: false },
};

/**
 * A fixed, schema-valid `ScanSubmission` (validated below, not just typed —
 * `scanSubmissionSchema.parse` throws at build/dev time if this ever drifts
 * from the real contract). Exists because no e2e fixture can make MediaPipe
 * detect a hand in a synthetic image (tests/e2e/fixtures/synthetic-photo.ts),
 * so this is the only deterministic way to reach the "ok" state's submit UI
 * in CI — mirrors `/results/demo`'s reason for existing.
 */
const DEMO_SUBMISSION = scanSubmissionSchema.parse({
  hand: "right",
  gripStyleStated: "palm",
  measurements: {
    handLengthMm: 182,
    palmLengthMm: 102,
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

export default function ScanSubmitDemoPage() {
  guardDemoRouteFromProduction();
  return (
    <main className="scanMain">
      <h1>Scan submit (mock data)</h1>
      <p className="hint">
        Fixed, schema-valid measurements — for exercising the submit button, its
        request and its error handling without a real photo.
      </p>
      <ScanSubmitPanel submission={DEMO_SUBMISSION} />
    </main>
  );
}
