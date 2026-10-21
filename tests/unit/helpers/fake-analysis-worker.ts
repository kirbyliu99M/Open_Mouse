/**
 * V3.2 F8: a stand-in for the browser's `Worker` running `paper.worker.ts`,
 * for Node. Messages cross the "thread" boundary the way they do in a browser:
 * through `structuredClone` with the buffer in the transfer list (so the
 * sender's buffer is detached, exactly as `postMessage` leaves it), answered
 * on a later task. The handler is the worker's own (`handleAnalysisRequest`).
 *
 * `mode` makes it misbehave in each way the client must survive. NOT a test
 * file (vitest only collects `*.test.ts`).
 */
import {
  handleAnalysisRequest,
  type AnalysisRequest,
  type AnalysisResponse,
} from "../../../src/client/photo/offMainAnalysis";
import type { AnalysisWorkerLike } from "../../../src/client/photo/analysisWorkerClient";

export type FakeWorkerMode =
  /** Answers every request as the real worker does. */
  | "ok"
  /** Answers `ok: false` (the handler threw), buffer returned. */
  | "notOk"
  /** Takes the pixels, then fires `error` (a crash, or a script that would not load). */
  | "error"
  /** Takes the pixels, then fires `messageerror`. */
  | "messageerror"
  /** Takes the pixels and never answers. */
  | "silent"
  /** `postMessage` throws (nothing is transferred). */
  | "postThrows";

type Listener = (event: never) => void;

export class FakeAnalysisWorker implements AnalysisWorkerLike {
  readonly received: AnalysisRequest[] = [];
  terminated = false;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly mode: FakeWorkerMode = "ok") {}

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  private emit(type: string, event: unknown) {
    for (const l of this.listeners.get(type) ?? [])
      (l as (e: unknown) => void)(event);
  }

  postMessage(message: AnalysisRequest, transfer: Transferable[]): void {
    if (this.mode === "postThrows") {
      throw new DOMException("could not be cloned", "DataCloneError");
    }
    // Into the worker: the sender's buffer is detached here.
    const inside = structuredClone(message, {
      transfer: transfer as ArrayBuffer[],
    });
    this.received.push(inside);
    setTimeout(() => {
      if (this.terminated) return;
      if (this.mode === "silent") return;
      if (this.mode === "error") return this.emit("error", new Event("error"));
      if (this.mode === "messageerror") {
        return this.emit("messageerror", new Event("messageerror"));
      }
      const response: AnalysisResponse =
        this.mode === "notOk"
          ? { id: inside.id, ok: false, buffer: inside.buffer }
          : handleAnalysisRequest(inside);
      // Back out of the worker, the buffer transferred again.
      const outside = structuredClone(response, {
        transfer: [response.buffer],
      });
      this.emit("message", { data: outside });
    }, 0);
  }

  terminate(): void {
    this.terminated = true;
  }
}
