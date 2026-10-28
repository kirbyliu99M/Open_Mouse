/**
 * Warms the browser's HTTP cache with the hand detector's files before the
 * scan page needs them (Kirby 2026-10-26, candidate / 未拍板): the landing page
 * fetches the model once it is idle, and the scan button the runtime on a
 * press, so the scan page's `getHandLandmarker()` reads them from the cache
 * instead of downloading ~20 MB while the camera opens. Same-origin files only, never a
 * CDN, no photo involved (docs/PLAN.md hard rule 5).
 *
 * It only downloads; it does not start MediaPipe (compiling the WASM would
 * cost the landing page's animation its frames). The bodies are read to the
 * end and dropped, since a cache entry is written only once the whole body
 * has arrived. `/mediapipe/*` is served with a day's max-age
 * (next.config.ts, MEDIAPIPE_CACHE_CONTROL).
 *
 * Skipped when the person asked to save data, on a 2G-class connection, or
 * when the detector is already loaded. Each file once per page load.
 */
import { isHandLandmarkerReady } from "./landmarks";

/**
 * What is warmed when (Kirby 2026-10-26, candidate / 未拍板): the landing page
 * only the 7.8 MB model, the scan button the rest, the WASM runtime MediaPipe
 * picks on every browser we support (the SIMD build, ~12 MB).
 */
export const DETECTOR_PRELOAD_PATHS = {
  landing: ["/mediapipe/models/hand_landmarker.task"],
  scan: [
    "/mediapipe/wasm/vision_wasm_internal.js",
    "/mediapipe/wasm/vision_wasm_internal.wasm",
  ],
} as const;

export type PreloadStage = keyof typeof DETECTOR_PRELOAD_PATHS;

interface ConnectionHints {
  saveData?: boolean;
  effectiveType?: string;
}

/** Whether this connection should not spend ~20 MB on a scan that may never happen. Pure. */
export function shouldSkipPreload(hints: ConnectionHints | undefined): boolean {
  if (!hints) return false;
  if (hints.saveData) return true;
  return hints.effectiveType === "slow-2g" || hints.effectiveType === "2g";
}

/** One fetch per file per page load, whoever asks first. */
const started = new Map<string, Promise<void>>();

async function drain(path: string): Promise<void> {
  const response = await fetch(path, {
    credentials: "same-origin",
    // Below anything the page itself asks for.
    priority: "low",
  } as RequestInit);
  const reader = response.body?.getReader();
  if (!reader) return;
  for (;;) {
    const { done } = await reader.read();
    if (done) return;
  }
}

/**
 * Warms the files of `stage` ("landing": the model; "scan": the runtime, and
 * the model too if the landing page did not get to it). Each file is fetched
 * once; resolves when they have finished or failed.
 */
export function preloadDetectorAssets(stage: PreloadStage): Promise<void> {
  const hints = (navigator as Navigator & { connection?: ConnectionHints })
    .connection;
  if (isHandLandmarkerReady() || shouldSkipPreload(hints))
    return Promise.resolve();
  const paths =
    stage === "landing"
      ? DETECTOR_PRELOAD_PATHS.landing
      : [...DETECTOR_PRELOAD_PATHS.landing, ...DETECTOR_PRELOAD_PATHS.scan];
  return Promise.all(
    paths.map((path) => {
      let run = started.get(path);
      if (!run) {
        run = drain(path).catch(() => {
          // Best effort: the scan page downloads it itself, as before.
        });
        started.set(path, run);
      }
      return run;
    }),
  ).then(() => undefined);
}
