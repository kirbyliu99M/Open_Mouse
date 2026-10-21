/**
 * V3.2 F8 bench: the longest stretch the main thread is blocked while the
 * sheet detector and the sharpness run, before F8 (both on the main thread,
 * with F7's break between them) and after (both in a worker thread, the
 * pixels transferred). Manual, never in CI.
 *
 *   npm run paper:worker-bench
 *
 * It runs in Node, not a browser: the worker is a `worker_threads` Worker
 * running the browser worker's own handler (`handleAnalysisRequest`), and the
 * photos are synthetic sheets (`tests/unit/helpers/synthetic-paper.ts`) at
 * the sizes a phone hands the pipeline. "Blocked" is measured by a heartbeat
 * on the main thread (a `setImmediate` loop): the longest gap between two
 * beats while the work is in flight. The times are real measurements on the
 * machine it runs on (實測), of a simulated setting (模擬: Node's V8, not a
 * phone's browser).
 */
import { Worker } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { generateSyntheticPaper } from "../tests/unit/helpers/synthetic-paper";
import {
  runAnalysisJob,
  type AnalysisJob,
  type AnalysisRequest,
  type AnalysisResponse,
} from "../src/client/photo/offMainAnalysis";

const SIZES: readonly (readonly [number, number])[] = [
  [1080, 1440],
  [1440, 1920],
  [2250, 3000],
  [3024, 4032],
];
const RUNS = 3;
const PAPER_JOB: AnalysisJob = {
  kind: "paper",
  paperSize: "a4",
  options: {},
};

/** Starts a heartbeat; `stop()` gives the longest gap between beats, in ms. */
function heartbeat() {
  let last = performance.now();
  let longest = 0;
  let running = true;
  const beat = () => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
    if (running) setImmediate(beat);
  };
  setImmediate(beat);
  return {
    stop() {
      running = false;
      longest = Math.max(longest, performance.now() - last);
      return longest;
    },
  };
}

const worker = new Worker(
  new URL("./paper-worker-bench.worker.ts", import.meta.url),
  { execArgv: ["--import", "tsx"] },
);
let nextId = 1;
function inWorker(
  job: AnalysisJob,
  width: number,
  height: number,
  buffer: ArrayBuffer,
): Promise<AnalysisResponse> {
  const id = nextId++;
  return new Promise((resolve) => {
    const onMessage = (response: AnalysisResponse) => {
      if (response.id !== id) return;
      worker.off("message", onMessage);
      resolve(response);
    };
    worker.on("message", onMessage);
    const request: AnalysisRequest = { id, job, width, height, buffer };
    worker.postMessage(request, [buffer]);
  });
}

async function main() {
  // Warm both sides (JIT) on a small frame.
  const warm = generateSyntheticPaper({ width: 640, height: 480, seed: 1 });
  for (let i = 0; i < 3; i++) {
    runAnalysisJob(PAPER_JOB, warm);
    runAnalysisJob({ kind: "sharpness" }, warm);
    await inWorker(
      PAPER_JOB,
      640,
      480,
      new Uint8ClampedArray(warm.data).buffer,
    );
  }

  console.log(
    "size        | before: sharpness / detect / longest block | after: longest block (worker total)",
  );
  for (const [width, height] of SIZES) {
    const scene = generateSyntheticPaper({ width, height, seed: 4243 });
    const before: number[] = [];
    const after: number[] = [];
    let sharpMs = 0;
    let detectMs = 0;
    let workerTotal = 0;
    for (let r = 0; r < RUNS; r++) {
      // Before F8: each step blocks the main thread for its whole length; F7
      // yields between them, so the longest block is the longer step.
      const frame = { width, height, data: new Uint8ClampedArray(scene.data) };
      let t = performance.now();
      const mainSharp = runAnalysisJob({ kind: "sharpness" }, frame);
      const s = performance.now() - t;
      await new Promise((resolve) => setImmediate(resolve));
      t = performance.now();
      const mainPaper = runAnalysisJob(PAPER_JOB, frame);
      const d = performance.now() - t;
      sharpMs = Math.max(sharpMs, s);
      detectMs = Math.max(detectMs, d);
      before.push(Math.max(s, d));

      // After F8: both in the worker; the main thread only posts and waits.
      const pixels = new Uint8ClampedArray(scene.data);
      const hb = heartbeat();
      const started = performance.now();
      const sharp = await inWorker(
        { kind: "sharpness" },
        width,
        height,
        pixels.buffer,
      );
      const paper = await inWorker(PAPER_JOB, width, height, sharp.buffer);
      workerTotal = Math.max(workerTotal, performance.now() - started);
      after.push(hb.stop());
      if (
        !sharp.ok ||
        !paper.ok ||
        JSON.stringify(sharp.outcome) !== JSON.stringify(mainSharp) ||
        JSON.stringify(paper.outcome) !== JSON.stringify(mainPaper)
      ) {
        throw new Error(
          `worker and main thread disagree at ${width}x${height}`,
        );
      }
    }
    const worst = (list: number[]) => Math.max(...list).toFixed(1);
    console.log(
      `${`${width}x${height}`.padEnd(11)} | ${sharpMs.toFixed(0)} / ${detectMs.toFixed(0)} / ${worst(before)} ms | ${worst(after)} ms (${workerTotal.toFixed(0)} ms)`,
    );
  }
  console.log(
    `(worst of ${RUNS} runs each; Node ${process.version}; synthetic A4 sheets; measured on this machine)`,
  );
  await worker.terminate();
}

void main();
