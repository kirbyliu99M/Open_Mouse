import type { Metadata } from "next";
import ScanClient from "../ScanClient";
import { guardDemoRouteFromProduction } from "../demo-guard";
import {
  MEASUREMENT_MODEL_VERSION,
  scanSubmissionSchema,
} from "@/lib/contracts/measurement";
import type { PhotoOverlay } from "@/client/photo/pipeline";
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

/**
 * A synthetic "photo" (an inline SVG data URI — no real photo exists for
 * this fixture) plus a plausible 21-point MediaPipe-shaped landmark
 * layout, so this route can also screenshot the measured-state overlay
 * (knuckle emphasis, hand-length/palm-width lines — see ScanClient's "ok"
 * branch) instead of only the numbers. Positions are illustrative, not
 * measured from anything real; `DEMO_SUBMISSION.measurements` above are
 * the only numbers actually drawn.
 */
const DEMO_IMAGE_WIDTH = 800;
const DEMO_IMAGE_HEIGHT = 1000;
const DEMO_PHOTO_URL = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${DEMO_IMAGE_WIDTH}" height="${DEMO_IMAGE_HEIGHT}">` +
    `<rect width="${DEMO_IMAGE_WIDTH}" height="${DEMO_IMAGE_HEIGHT}" fill="#eef0f2"/>` +
    `<rect x="20" y="20" width="${DEMO_IMAGE_WIDTH - 40}" height="${DEMO_IMAGE_HEIGHT - 40}" rx="24" fill="#f7f8fa" stroke="#d5d5dc" stroke-width="2"/>` +
    `</svg>`,
)}`;

const DEMO_OVERLAY: PhotoOverlay = {
  imageWidth: DEMO_IMAGE_WIDTH,
  imageHeight: DEMO_IMAGE_HEIGHT,
  markers: [],
  card: null,
  landmarksPx: [
    { x: 400, y: 900 }, // 0 wrist
    { x: 340, y: 850 }, // 1 thumb CMC
    { x: 300, y: 780 }, // 2 thumb MCP
    { x: 270, y: 720 }, // 3 thumb IP
    { x: 250, y: 670 }, // 4 thumb tip
    { x: 380, y: 650 }, // 5 index MCP
    { x: 370, y: 520 }, // 6 index PIP
    { x: 365, y: 440 }, // 7 index DIP
    { x: 360, y: 370 }, // 8 index tip
    { x: 420, y: 630 }, // 9 middle MCP
    { x: 415, y: 480 }, // 10 middle PIP
    { x: 410, y: 380 }, // 11 middle DIP
    { x: 405, y: 300 }, // 12 middle tip
    { x: 460, y: 650 }, // 13 ring MCP
    { x: 458, y: 510 }, // 14 ring PIP
    { x: 456, y: 420 }, // 15 ring DIP
    { x: 454, y: 350 }, // 16 ring tip
    { x: 500, y: 670 }, // 17 pinky MCP
    { x: 505, y: 560 }, // 18 pinky PIP
    { x: 508, y: 490 }, // 19 pinky DIP
    { x: 510, y: 430 }, // 20 pinky tip
  ],
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
