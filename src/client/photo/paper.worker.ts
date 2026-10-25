/**
 * V3.2 F8 (candidate): the Web Worker that runs the sheet detector and the
 * sharpness off the main thread (`offMainAnalysis.ts`). It is part of the
 * same page, bundled by Next from this file
 * (`new Worker(new URL("./paper.worker.ts", import.meta.url))`), served from
 * the same origin (`worker-src 'self'`), and it makes no request of its own:
 * the pixels it is handed never leave the browser.
 */
import {
  handleAnalysisRequest,
  type AnalysisRequest,
  type AnalysisResponse,
} from "./offMainAnalysis";

/**
 * The slice of `DedicatedWorkerGlobalScope` used here. Typed by hand because
 * the project compiles against the DOM library, not the worker one.
 */
interface WorkerScope {
  onmessage: ((event: MessageEvent<AnalysisRequest>) => void) | null;
  postMessage(message: AnalysisResponse, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const response = handleAnalysisRequest(event.data);
  scope.postMessage(response, [response.buffer]);
};
