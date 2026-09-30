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
import { createModelReader } from "./model-download";

const WASM_BASE_PATH = "/mediapipe/wasm";
const MODEL_ASSET_PATH = "/mediapipe/models/hand_landmarker.task";

let landmarkerPromise: Promise<HandLandmarker> | null = null;

/**
 * Where the detector is in loading, for a progress display. MediaPipe loads
 * its WASM runtime first and reports nothing while it does, so that stage is
 * indeterminate; it then reads the model, which is counted (determinate).
 */
export type DetectorLoadState =
  | { readonly stage: "idle" }
  | {
      readonly stage: "model";
      readonly loadedBytes: number;
      readonly totalBytes: number | null;
    }
  | { readonly stage: "runtime" }
  | { readonly stage: "ready" }
  | { readonly stage: "failed" };

let loadState: DetectorLoadState = { stage: "idle" };
const loadListeners = new Set<() => void>();

function setLoadState(next: DetectorLoadState) {
  loadState = next;
  for (const listener of loadListeners) listener();
}

/** Current snapshot; stable between changes (safe for useSyncExternalStore). */
export function getDetectorLoadState(): DetectorLoadState {
  return loadState;
}

export function subscribeDetectorLoadState(listener: () => void): () => void {
  loadListeners.add(listener);
  return () => {
    loadListeners.delete(listener);
  };
}

/**
 * Thrown by `getHandLandmarker()` when the model/WASM fetch or
 * initialization itself fails — as opposed to any other error that might
 * escape `runPhotoPipeline` (a bug, an implausible-measurement throw, an
 * unexpected DOM/Canvas failure). The caller (ScanClient's catch-all) uses
 * `instanceof` on this to show "couldn't load the hand detector" only when
 * that's actually what happened, per the review checklist's "errors are
 * specific" rule — a generic failure must not claim a specific cause it
 * doesn't know is true.
 */
export class HandLandmarkerLoadError extends Error {
  constructor(cause: unknown) {
    super("Failed to load the MediaPipe HandLandmarker.");
    this.name = "HandLandmarkerLoadError";
    this.cause = cause;
  }
}

/**
 * Lazily creates (and caches) the single `HandLandmarker` instance this app
 * uses. Call this as early as convenient (e.g. on `/scan` mount) so the
 * model/WASM fetch happens before the user starts a scan, not while an
 * e2e test is recording "zero requests during processing".
 */
export function getHandLandmarker(): Promise<HandLandmarker> {
  landmarkerPromise ??= (async () => {
    // MediaPipe loads its WASM runtime first (nothing to count there), and
    // only then reads the model. The model goes in as a reader that counts
    // the bytes and fetches nothing until MediaPipe first reads from it, so
    // the request order and timing stay MediaPipe's own.
    setLoadState({ stage: "runtime" });
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_PATH);
    const create = (
      model:
        | { modelAssetBuffer: ReadableStreamDefaultReader<Uint8Array> }
        | { modelAssetPath: string },
    ) =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          ...model,
          delegate: "CPU", // GPU delegate isn't consistently available/deterministic across devices for a one-shot still-photo scan.
        },
        runningMode: "IMAGE",
        numHands: 1,
      });
    let landmarker: HandLandmarker;
    try {
      landmarker = await create({
        modelAssetBuffer: createModelReader(
          (input, init) => globalThis.fetch(input, init),
          MODEL_ASSET_PATH,
          (progress) => setLoadState({ stage: "model", ...progress }),
        ),
      });
    } catch {
      // The counted download failed (no stream, a network or read error, a
      // truncated file): let MediaPipe fetch the same file by path, exactly as
      // it did before this counted bytes. If that fails too, the error below
      // is the one the caller sees.
      setLoadState({ stage: "runtime" });
      landmarker = await create({ modelAssetPath: MODEL_ASSET_PATH });
    }
    setLoadState({ stage: "ready" });
    return landmarker;
  })().catch((error: unknown) => {
    // A transient asset failure must not poison every later retry.
    landmarkerPromise = null;
    setLoadState({ stage: "failed" });
    throw new HandLandmarkerLoadError(error);
  });
  return landmarkerPromise;
}

/**
 * MediaPipe's handedness label, lower-cased, NOT swapped.
 *
 * MediaPipe documents its label for a mirrored (selfie) image of a hand
 * facing the camera, and says to swap it for an unmirrored image. Our photos
 * are unmirrored rear-camera shots, but of the BACK of the hand (palm down on
 * the paper), and seeing the back of a hand is itself a mirror of seeing its
 * palm. The two flips cancel, so the raw label is already the hand in the
 * photo. Swapping it (as this function did until 2026-09-29) reported every
 * palm-down hand as the other hand: measured on four photos, including
 * Kirby's own (right hand, palm down → "left", 0.91), and in Kirby's field
 * test, where right-hand scans failed with HANDEDNESS_MISMATCH.
 * Unit-tested in tests/unit/handedness.test.ts.
 */
export function normalizeHandedness(
  categoryName: string,
): "left" | "right" | null {
  const normalized = categoryName.trim().toLowerCase();
  if (normalized === "left") return "left";
  if (normalized === "right") return "right";
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
