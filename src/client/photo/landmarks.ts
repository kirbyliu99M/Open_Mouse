/**
 * MediaPipe HandLandmarker adapter — `@mediapipe/tasks-vision` 1.0.1 in
 * IMAGE mode. The model (`hand_landmarker.task`, float16, 7.8 MB) and the
 * WASM runtime (`vision_wasm_internal.{js,wasm}`, SIMD build, ~12 MB) are
 * vendored under `public/mediapipe/` — see that directory and the PR
 * description for exact sizes/provenance — and loaded from same-origin
 * paths, never a CDN, so creating a HandLandmarker makes no third-party
 * network request (docs/PLAN.md hard rule 5: photos and everything
 * downstream of them stay on-device).
 */
import {
  FilesetResolver,
  HandLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import type { Point2 } from "../geometry/homography";

const WASM_BASE_PATH = "/mediapipe/wasm";
const MODEL_ASSET_PATH = "/mediapipe/models/hand_landmarker.task";

let landmarkerPromise: Promise<HandLandmarker> | null = null;

/**
 * Lazily creates (and caches) the single `HandLandmarker` instance this app
 * uses. Call this as early as convenient (e.g. on `/scan` mount) so the
 * model/WASM fetch happens before the user starts a scan, not while an
 * e2e test is recording "zero requests during processing".
 */
export function getHandLandmarker(): Promise<HandLandmarker> {
  landmarkerPromise ??= (async () => {
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_PATH);
    return HandLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: MODEL_ASSET_PATH,
        delegate: "CPU", // GPU delegate isn't consistently available/deterministic across devices for a one-shot still-photo scan.
      },
      runningMode: "IMAGE",
      numHands: 1,
    });
  })();
  return landmarkerPromise;
}

/**
 * MediaPipe's documented convention: handedness assumes a mirrored
 * (front/selfie-camera) input image, and instructs callers to swap the
 * output when that isn't the case. Our top-down hand photos are shot with
 * the phone's rear/main camera per docs/PLAN.md §M2 ("ask for the main 1×
 * camera"), i.e. NOT mirrored, so the raw "Left"/"Right" category is the
 * mirror image of the hand actually in the photo and must be swapped.
 * Pure and unit-tested on its own, since it's easy to get backwards.
 */
export function normalizeHandedness(
  categoryName: string,
): "left" | "right" | null {
  const normalized = categoryName.trim().toLowerCase();
  if (normalized === "left") return "right";
  if (normalized === "right") return "left";
  return null;
}

/** Normalized [0,1] MediaPipe landmarks → image-pixel points. Pure. */
export function toPixelPoints(
  normalized: readonly NormalizedLandmark[],
  width: number,
  height: number,
): Point2[] {
  return normalized.map((p) => ({ x: p.x * width, y: p.y * height }));
}

export interface HandDetectionResult {
  /** 21 landmarks, in image pixels (already de-normalized). */
  readonly landmarksPx: readonly Point2[];
  readonly handedness: "left" | "right" | null;
  /** The handedness classifier's confidence — doubles as detection confidence (MediaPipe's IMAGE-mode HandLandmarkerResult has no separate per-hand score). */
  readonly confidence: number;
}

/**
 * Run detection on an already-decoded, already-downscaled bitmap (the same
 * one markers.ts and card.ts see, per docs/PLAN.md §M2: "ArUco and
 * MediaPipe must run on the same bitmap so their coordinates share a
 * frame"). Returns `null` if MediaPipe found no hand at all.
 */
export async function detectHandLandmarks(
  bitmap: ImageBitmap,
): Promise<HandDetectionResult | null> {
  const landmarker = await getHandLandmarker();
  const result = landmarker.detect(bitmap);

  const landmarks = result.landmarks[0];
  const handedness = result.handedness[0];
  if (!landmarks || landmarks.length === 0) return null;

  return {
    landmarksPx: toPixelPoints(landmarks, bitmap.width, bitmap.height),
    handedness: handedness?.[0]
      ? normalizeHandedness(handedness[0].categoryName)
      : null,
    confidence: handedness?.[0]?.score ?? 0,
  };
}
