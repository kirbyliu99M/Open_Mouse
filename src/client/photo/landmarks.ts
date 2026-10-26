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
import { scanCommonCopy } from "../../lib/copy/scan-common";
import type { Point2 } from "../geometry/homography";
import type { Point3 } from "./handWorld";
import { createModelReader } from "./model-download";

const WASM_BASE_PATH = "/mediapipe/wasm";
const MODEL_ASSET_PATH = "/mediapipe/models/hand_landmarker.task";

let landmarkerPromise: Promise<HandLandmarker> | null = null;
/** The landmarker once it has loaded, for the live loop's synchronous reading (F14). */
let readyLandmarker: HandLandmarker | null = null;

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
 * What a person is told when the hand detector could not be loaded (the app's
 * own download and MediaPipe's fetch by path both failed). Shared by every
 * screen that says so, so the wording cannot drift.
 */
export const DETECTOR_LOAD_FAILED_MESSAGE =
  scanCommonCopy("en").detectorLoadFailed;

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
    readyLandmarker = landmarker;
    return landmarker;
  })().catch((error: unknown) => {
    // A transient asset failure must not poison every later retry.
    landmarkerPromise = null;
    readyLandmarker = null;
    setLoadState({ stage: "failed" });
    throw new HandLandmarkerLoadError(error);
  });
  return landmarkerPromise;
}

/** Whether the landmarker has loaded (the live loop reads the hand only then, F14). */
export function isHandLandmarkerReady(): boolean {
  return readyLandmarker !== null;
}

/**
 * V3.3 WP1b (candidate): one live reading of the hand. `points` are what
 * `readLiveHandPoints` has always returned (image px of the sample); `z` is
 * MediaPipe's per-point relative depth (wrist = 0, image-width units) and
 * `world` the 21 world landmarks (metres, around the hand's centre), each
 * `null` when MediaPipe gave none or not 21 finite values. Log only: nothing
 * acts on `z` or `world`, and neither is ever stored as an array.
 */
export interface LiveHandReading {
  readonly points: Point2[];
  readonly z: number[] | null;
  readonly world: Point3[] | null;
}

/**
 * V3.2 F14 (candidate): the hand's landmarks in one picture of the live
 * preview (`source`, `width` x `height` px), read synchronously with the
 * landmarker that is already loaded, or `undefined` while it is not loaded
 * yet (this never starts a load or waits for one). `null` when no hand was
 * found or the reading threw. Only whether a hand is there and held still is
 * used (`noSheetCapture.ts`): nothing is measured from it, and the picture is
 * not kept.
 */
export function readLiveHandPoints(
  source: HTMLCanvasElement | ImageData,
  width: number,
  height: number,
): Point2[] | null | undefined {
  const reading = readLiveHand(source, width, height);
  return reading ? reading.points : reading;
}

/**
 * The same single `detect()` as `readLiveHandPoints`, with the per-point z
 * and the world landmarks MediaPipe returns from it (V3.3 WP1b; no second
 * inference). `undefined` while the landmarker is not loaded, `null` when no
 * hand was found or the reading threw.
 */
export function readLiveHand(
  source: HTMLCanvasElement | ImageData,
  width: number,
  height: number,
): LiveHandReading | null | undefined {
  const landmarker = readyLandmarker;
  if (!landmarker) return undefined;
  try {
    const result = landmarker.detect(source);
    const landmarks = result.landmarks[0];
    if (!landmarks || landmarks.length === 0) return null;
    return {
      points: toPixelPoints(landmarks, width, height),
      z: landmarkDepths(landmarks),
      world: toWorldPoints(result.worldLandmarks?.[0]),
    };
  } catch {
    return null;
  }
}

/**
 * MediaPipe's per-landmark `z` (relative depth, wrist = 0), or `null` unless
 * there are exactly 21 finite values. Pure.
 */
export function landmarkDepths(
  landmarks: readonly { readonly z?: unknown }[] | null | undefined,
): number[] | null {
  if (!Array.isArray(landmarks) || landmarks.length !== 21) return null;
  const out: number[] = [];
  for (const p of landmarks) {
    const z = (p as { z?: unknown } | null)?.z;
    if (typeof z !== "number" || !Number.isFinite(z)) return null;
    out.push(z);
  }
  return out;
}

/**
 * MediaPipe's 21 world landmarks (metres) as plain points, or `null` unless
 * there are exactly 21 with finite x, y, z. Pure.
 */
export function toWorldPoints(
  world:
    | readonly {
        readonly x?: unknown;
        readonly y?: unknown;
        readonly z?: unknown;
      }[]
    | null
    | undefined,
): Point3[] | null {
  if (!Array.isArray(world) || world.length !== 21) return null;
  const out: Point3[] = [];
  for (const p of world) {
    const q = (p ?? {}) as { x?: unknown; y?: unknown; z?: unknown };
    if (
      typeof q.x !== "number" ||
      typeof q.y !== "number" ||
      typeof q.z !== "number" ||
      !Number.isFinite(q.x) ||
      !Number.isFinite(q.y) ||
      !Number.isFinite(q.z)
    )
      return null;
    out.push({ x: q.x, y: q.y, z: q.z });
  }
  return out;
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
  /**
   * V3.3 WP1b (candidate, log only): MediaPipe's per-point relative depth
   * (`landmarkDepths`) and its 21 world landmarks in metres
   * (`toWorldPoints`), from the same `detect()`. Absent or `null` where
   * MediaPipe gave none. Nothing measured reads them.
   */
  readonly landmarkZ?: readonly number[] | null;
  readonly worldLandmarks?: readonly Point3[] | null;
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
    landmarkZ: landmarkDepths(landmarks),
    worldLandmarks: toWorldPoints(result.worldLandmarks?.[0]),
  };
}
