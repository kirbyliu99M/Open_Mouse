/**
 * The worker side of `paper-worker-bench.ts`: the browser worker's own handler
 * (`handleAnalysisRequest`, as `src/client/photo/paper.worker.ts` runs it),
 * on a Node `worker_threads` thread, the buffer transferred back.
 */
import { parentPort } from "node:worker_threads";
import {
  handleAnalysisRequest,
  type AnalysisRequest,
} from "../src/client/photo/offMainAnalysis";

parentPort?.on("message", (request: AnalysisRequest) => {
  const response = handleAnalysisRequest(request);
  parentPort?.postMessage(response, [response.buffer]);
});
