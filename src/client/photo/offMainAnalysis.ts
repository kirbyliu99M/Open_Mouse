/**
 * V3.2 F8 (candidate): the two long pixel loops of a photo analysis, the
 * sheet detector (`detectPaperQuad`) and the sharpness (Laplacian variance),
 * as one message in and one message out, so a Web Worker can run them
 * (`paper.worker.ts`) while the page keeps drawing the loader.
 *
 * Nothing here is a new algorithm: `runAnalysisJob` calls the very same
 * functions the main thread calls (`detectPaperQuad`, `rgbaToGrayscale`,
 * `computeLaplacianVariance`), on the same pixels, with the same arguments.
 * The main thread's fallback (`analysisWorkerClient.ts`) calls them through
 * `runAnalysisJob` too, so the two places cannot drift apart.
 *
 * The pixels travel as the `ImageData`'s own `ArrayBuffer`, transferred (not
 * copied) to the worker and transferred back with the answer, so the caller
 * gets them back for whatever it still needs them for. Pure: no DOM, no
 * worker API, unit-tested in Node.
 */
import {
  detectPaperQuad,
  type DetectPaperQuadOptions,
  type PaperSize,
  type SheetQuadDetection,
} from "../paper/detect";
import { computeLaplacianVariance, rgbaToGrayscale } from "./sharpness";

/** Where an offloaded step ran, for the local attempt log only (never analytics). */
export type AnalysisThread = "worker" | "fallback";

export type AnalysisJob =
  | { readonly kind: "sharpness" }
  | {
      readonly kind: "paper";
      readonly paperSize: PaperSize;
      readonly options: DetectPaperQuadOptions;
    };

/** What the main thread posts: the job, the frame's size and its pixels. */
export interface AnalysisRequest {
  readonly id: number;
  readonly job: AnalysisJob;
  readonly width: number;
  readonly height: number;
  /** `ImageData.data.buffer`, transferred. */
  readonly buffer: ArrayBuffer;
}

/**
 * The answer, by job. A sharpness of `null` is exactly what the main thread's
 * own `try { … } catch { null }` gives (an image too small to have an
 * interior): the caller treats it as it always has.
 */
export type AnalysisOutcome =
  | { readonly kind: "sharpness"; readonly laplacianVariance: number | null }
  | { readonly kind: "paper"; readonly quad: SheetQuadDetection };

/** What the worker posts back; `buffer` is the request's, transferred back. */
export type AnalysisResponse =
  | {
      readonly id: number;
      readonly ok: true;
      readonly outcome: AnalysisOutcome;
      readonly buffer: ArrayBuffer;
    }
  | { readonly id: number; readonly ok: false; readonly buffer: ArrayBuffer };

/** The frame shape both functions read (`width`, `height`, `data` only). */
export interface AnalysisFrame {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/**
 * Runs one job on one frame: the same calls, in the same form, as the
 * main-thread code they replace. `detectPaperQuad` reads only `width`,
 * `height` and `data` of its `ImageData`.
 */
export function runAnalysisJob(
  job: AnalysisJob,
  frame: AnalysisFrame,
): AnalysisOutcome {
  if (job.kind === "sharpness") {
    let laplacianVariance: number | null;
    try {
      const gray = rgbaToGrayscale(frame.data, frame.width * frame.height);
      laplacianVariance = computeLaplacianVariance(
        gray,
        frame.width,
        frame.height,
      );
    } catch {
      laplacianVariance = null;
    }
    return { kind: "sharpness", laplacianVariance };
  }
  const quad = detectPaperQuad(
    frame as unknown as ImageData,
    job.paperSize,
    job.options,
  );
  return { kind: "paper", quad };
}

/**
 * The worker's whole handler: rebuild the frame around the transferred
 * buffer (no copy), run the job, answer with the buffer. An unexpected throw
 * is answered `ok: false`, so the main thread falls back rather than waits.
 */
export function handleAnalysisRequest(
  request: AnalysisRequest,
): AnalysisResponse {
  try {
    const frame: AnalysisFrame = {
      width: request.width,
      height: request.height,
      data: new Uint8ClampedArray(request.buffer),
    };
    const outcome = runAnalysisJob(request.job, frame);
    return { id: request.id, ok: true, outcome, buffer: request.buffer };
  } catch {
    return { id: request.id, ok: false, buffer: request.buffer };
  }
}
