/**
 * V3.2 F8 (candidate): hands the sheet detector and the sharpness to a Web
 * Worker (`paper.worker.ts`) so the main thread stays free to draw the loader
 * while they run (Kirby's phone test, 2026-10-21: `detectPaperQuad` alone held
 * the main thread 0.2-1.1 s on the desktop, 實測), and falls back to running
 * the very same functions on the main thread whenever the worker cannot.
 *
 * - The pixels go as the `ImageData`'s buffer, transferred (no copy), and come
 *   back with the answer, so the caller can still read them afterwards.
 * - Fallback: no `Worker` in this browser, a worker that cannot be built, a
 *   worker that reports an error, a message that cannot be cloned, or no
 *   answer within `timeoutMs`. The job then runs here, through the same
 *   `runAnalysisJob`, so the result is identical; after the first failure the
 *   worker is not tried again for the rest of the page's life.
 * - Where a failure took the transferred pixels with it, `reread` gets them
 *   again from the still-open bitmap (the same `getImageData` call).
 * - Which way each job ran is returned as `thread` (`worker` / `fallback`), for
 *   the local attempt log only. Nothing here sends anything anywhere.
 */
import {
  runAnalysisJob,
  type AnalysisFrame,
  type AnalysisJob,
  type AnalysisOutcome,
  type AnalysisRequest,
  type AnalysisResponse,
  type AnalysisThread,
} from "./offMainAnalysis";

/** The longest wait for the worker's answer before running the job here (ms). */
export const ANALYSIS_WORKER_TIMEOUT_MS = 30_000;

/** The part of `Worker` used here, so tests can hand in a fake. */
export interface AnalysisWorkerLike {
  postMessage(message: AnalysisRequest, transfer: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<AnalysisResponse>) => void,
  ): void;
  addEventListener(
    type: "error" | "messageerror",
    listener: (event: Event) => void,
  ): void;
  terminate(): void;
}

export interface AnalysisRunnerOptions {
  /** Builds the worker; `null` (or a throw) means there is none. */
  readonly createWorker: () => AnalysisWorkerLike | null;
  readonly timeoutMs?: number;
}

export interface OffloadedAnalysis<T extends AnalysisOutcome["kind"]> {
  readonly outcome: Extract<AnalysisOutcome, { kind: T }>;
  /** The frame to read afterwards: the pixels as they came back, or as reread. */
  readonly frame: AnalysisFrame;
  readonly thread: AnalysisThread;
}

export interface AnalysisRunner {
  run<J extends AnalysisJob>(
    job: J,
    frame: AnalysisFrame,
    reread: () => AnalysisFrame,
  ): Promise<OffloadedAnalysis<J["kind"]>>;
}

interface Pending {
  readonly resolve: (response: AnalysisResponse) => void;
  readonly reject: () => void;
}

/** A frame whose pixels are still here (not transferred away). */
function isReadable(frame: AnalysisFrame): boolean {
  return frame.data.byteLength === frame.width * frame.height * 4;
}

/** Whether `data` is its buffer's whole and only view, so it can be transferred. */
function ownsBuffer(data: Uint8ClampedArray): boolean {
  return data.byteOffset === 0 && data.byteLength === data.buffer.byteLength;
}

export function createAnalysisRunner(
  options: AnalysisRunnerOptions,
): AnalysisRunner {
  const timeoutMs = options.timeoutMs ?? ANALYSIS_WORKER_TIMEOUT_MS;
  let worker: AnalysisWorkerLike | null = null;
  let disabled = false;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  function failWorker() {
    disabled = true;
    const current = worker;
    worker = null;
    try {
      current?.terminate();
    } catch {
      // Already gone.
    }
    const waiting = [...pending.values()];
    pending.clear();
    for (const p of waiting) p.reject();
  }

  function getWorker(): AnalysisWorkerLike | null {
    if (disabled) return null;
    if (worker) return worker;
    let created: AnalysisWorkerLike | null;
    try {
      created = options.createWorker();
    } catch {
      created = null;
    }
    if (!created) {
      disabled = true;
      return null;
    }
    created.addEventListener("message", (event) => {
      const response = event.data;
      const p = pending.get(response?.id);
      if (!p) return;
      pending.delete(response.id);
      p.resolve(response);
    });
    created.addEventListener("error", failWorker);
    created.addEventListener("messageerror", failWorker);
    worker = created;
    return created;
  }

  function onMainThread<J extends AnalysisJob>(
    job: J,
    frame: AnalysisFrame,
    reread: () => AnalysisFrame,
  ): OffloadedAnalysis<J["kind"]> {
    const readable = isReadable(frame) ? frame : reread();
    return {
      outcome: runAnalysisJob(job, readable) as Extract<
        AnalysisOutcome,
        { kind: J["kind"] }
      >,
      frame: readable,
      thread: "fallback",
    };
  }

  async function run<J extends AnalysisJob>(
    job: J,
    frame: AnalysisFrame,
    reread: () => AnalysisFrame,
  ): Promise<OffloadedAnalysis<J["kind"]>> {
    const target = ownsBuffer(frame.data) ? getWorker() : null;
    if (!target) return onMainThread(job, frame, reread);

    const id = nextId++;
    const buffer = frame.data.buffer as ArrayBuffer;
    let response: AnalysisResponse;
    try {
      response = await new Promise<AnalysisResponse>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (pending.has(id)) failWorker();
        }, timeoutMs);
        pending.set(id, {
          resolve: (r) => {
            clearTimeout(timer);
            resolve(r);
          },
          reject: () => {
            clearTimeout(timer);
            reject(new Error("analysis worker failed"));
          },
        });
        try {
          target.postMessage(
            { id, job, width: frame.width, height: frame.height, buffer },
            [buffer],
          );
        } catch {
          failWorker();
        }
      });
    } catch {
      // The pixels may have gone with the worker: `onMainThread` rereads them.
      return onMainThread(job, frame, reread);
    }

    const returned: AnalysisFrame = {
      width: frame.width,
      height: frame.height,
      data: new Uint8ClampedArray(response.buffer),
    };
    if (!response.ok || response.outcome.kind !== job.kind) {
      return onMainThread(job, returned, reread);
    }
    return {
      outcome: response.outcome as Extract<
        AnalysisOutcome,
        { kind: J["kind"] }
      >,
      frame: returned,
      thread: "worker",
    };
  }

  return { run };
}

/** The browser's worker, or `null` where there is no `Worker`. */
function createBrowserWorker(): AnalysisWorkerLike | null {
  if (typeof Worker === "undefined") return null;
  // Written as one expression so Next's bundler finds and bundles the worker.
  return new Worker(new URL("./paper.worker.ts", import.meta.url), {
    type: "module",
  }) as unknown as AnalysisWorkerLike;
}

let defaultRunner: AnalysisRunner | null = null;

/** The page's one runner, built on first use. */
export function getAnalysisRunner(): AnalysisRunner {
  defaultRunner ??= createAnalysisRunner({ createWorker: createBrowserWorker });
  return defaultRunner;
}
