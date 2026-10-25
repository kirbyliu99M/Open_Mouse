/**
 * V3.2 F8: the REAL paper-edge `runPhotoPipeline`, with the REAL detector, run
 * once with a Web Worker (a stand-in that crosses a `structuredClone`
 * boundary with the buffer transferred, `helpers/fake-analysis-worker.ts`) and
 * once without one (Node has no `Worker`: the main-thread fallback). Only the
 * decoder, MediaPipe and the canvas are faked. Both runs must give the same
 * result and the same diagnostics apart from timings; the detector is called
 * once either way; the attempt log says `worker` or `fallback`; analytics
 * carry neither. Scenes are SIMULATED (模擬).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/photo/decode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/photo/decode")>()),
  decodePhoto: vi.fn(),
}));
vi.mock("../../src/client/photo/landmarks", () => ({
  detectHandLandmarks: vi.fn(async () => null),
}));
vi.mock("../../src/client/paper/detect", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/client/paper/detect")>();
  return { ...actual, detectPaperQuad: vi.fn(actual.detectPaperQuad) };
});

import { generateSyntheticPaper } from "./helpers/synthetic-paper";
import type { FakeAnalysisWorker } from "./helpers/fake-analysis-worker";

const W = 1000;
const H = 750;
const SCENES = {
  sheet: generateSyntheticPaper({ width: W, height: H, seed: 4243 }).data,
  "no sheet": new Uint8ClampedArray(W * H * 4).fill(90),
} as const;

/** Every module fresh, so the page's runner is built again for each run. */
async function runOnce(pixels: Uint8ClampedArray, withWorker: boolean) {
  vi.resetModules();
  vi.unstubAllGlobals();
  const workers: FakeAnalysisWorker[] = [];
  if (withWorker) {
    // Imported after the reset, so its handler calls the same (fresh) detector.
    const { FakeAnalysisWorker: Fresh } =
      await import("./helpers/fake-analysis-worker");
    vi.stubGlobal(
      "Worker",
      class extends Fresh {
        constructor() {
          super("ok");
          workers.push(this);
        }
      },
    );
  }
  let reads = 0;
  vi.stubGlobal("document", {
    visibilityState: "visible",
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: () => undefined,
        getImageData: () => {
          reads += 1;
          return { width: W, height: H, data: new Uint8ClampedArray(pixels) };
        },
      }),
    }),
  });
  const { decodePhoto } = await import("../../src/client/photo/decode");
  const { detectPaperQuad } = await import("../../src/client/paper/detect");
  const { runPhotoPipeline } = await import("../../src/client/photo/pipeline");
  const { buildAttemptRecord } =
    await import("../../src/client/camera/attemptLog");
  const { buildScanRejected } =
    await import("../../src/client/analytics/scanQuality");
  vi.mocked(decodePhoto).mockResolvedValue({
    bitmap: { width: W, height: H, close() {} } as unknown as ImageBitmap,
    width: W,
    height: H,
  });
  vi.mocked(detectPaperQuad).mockClear();
  const result = await runPhotoPipeline({
    file: new File([new Uint8Array([0xff, 0xd8])], "p.jpg", {
      type: "image/jpeg",
    }),
    hand: "right",
    calibration: { method: "paper-edge", paperSize: "a4" },
  });
  const record = buildAttemptRecord({
    at: "2026-10-21T00:00:00.000Z",
    userAgent: "test",
    capture: {
      method: "upload",
      photoWidth: W,
      photoHeight: H,
      photoKb: 1,
      previewWidth: null,
      previewHeight: null,
    },
    outcome: { kind: "result", result },
  });
  const rejected =
    result.status === "error"
      ? buildScanRejected({
          flow: "easy",
          attempt: 1,
          errors: result.errors,
          diagnostics: result.diagnostics,
        })
      : null;
  return {
    result,
    record,
    rejected,
    detectorCalls: vi.mocked(detectPaperQuad).mock.calls.length,
    workerRequests: workers.flatMap((w) => w.received.map((r) => r.job.kind)),
    reads,
  };
}

/** The result with its timings taken out (they differ run to run). */
function comparable(r: Awaited<ReturnType<typeof runOnce>>["result"]) {
  const d = r.diagnostics;
  return {
    ...r,
    diagnostics: d
      ? {
          ...d,
          decodeMs: 0,
          paperMs: 0,
          handMs: 0,
          totalMs: 0,
          analysisThread: null,
        }
      : d,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("F8 — the paper-edge pipeline is the same with and without the worker", () => {
  it.each(Object.keys(SCENES) as (keyof typeof SCENES)[])(
    "%s: same result and diagnostics, detector called once, attempt log says where it ran",
    async (scene) => {
      const pixels = SCENES[scene];
      const onWorker = await runOnce(pixels, true);
      const onMain = await runOnce(pixels, false);

      expect(comparable(onWorker.result)).toStrictEqual(
        comparable(onMain.result),
      );
      expect(onWorker.result.status).toBe("error");
      expect(
        onMain.result.status === "error" ? onMain.result.errors[0]?.code : null,
      ).toBe(scene === "sheet" ? "HAND_NOT_DETECTED" : "PAPER_NOT_FOUND");

      // The detector ran once each time: in the worker, or here.
      expect(onWorker.detectorCalls).toBe(1);
      expect(onMain.detectorCalls).toBe(1);
      expect(onWorker.workerRequests).toStrictEqual(["sharpness", "paper"]);
      // The pixels were read once (no copy for the worker, no reread).
      expect(onWorker.reads).toBe(1);
      expect(onMain.reads).toBe(1);

      expect(onWorker.result.diagnostics?.analysisThread).toBe("worker");
      expect(onMain.result.diagnostics?.analysisThread).toBe("fallback");
      expect(onWorker.record.analysisThread).toBe("worker");
      expect(onMain.record.analysisThread).toBe("fallback");

      // Nothing about it is sent: the analytics event is the same either way
      // and has no such field.
      expect(onWorker.rejected).toStrictEqual(onMain.rejected);
      expect(JSON.stringify(onWorker.rejected)).not.toMatch(
        /analysisThread|worker|fallback/,
      );
    },
    120_000,
  );
});

describe("the attempt log's analysisThread", () => {
  it("keeps worker and fallback, drops anything else to null", async () => {
    const { sanitizeAttempt } =
      await import("../../src/client/camera/attemptLog");
    const base = { at: "2026-10-21T00:00:00.000Z", result: "ok" };
    expect(
      sanitizeAttempt({ ...base, analysisThread: "worker" })?.analysisThread,
    ).toBe("worker");
    expect(
      sanitizeAttempt({ ...base, analysisThread: "fallback" })?.analysisThread,
    ).toBe("fallback");
    expect(
      sanitizeAttempt({ ...base, analysisThread: "gpu" })?.analysisThread,
    ).toBeNull();
    // A record from before F8.
    expect(sanitizeAttempt(base)?.analysisThread).toBeNull();
  });
});
