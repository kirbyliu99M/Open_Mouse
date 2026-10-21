/**
 * V3.2 F8: when the worker is missing, cannot be built, reports an error,
 * crashes, never answers or cannot be posted to, the job runs on the main
 * thread through the same functions, with the identical result, and says
 * `fallback`. Where the failure took the transferred pixels, they are read
 * again (`reread`); after a failure the worker is not tried again. Scenes are
 * SIMULATED (模擬).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectPaperQuad } from "../../src/client/paper/detect";
import {
  computeLaplacianVariance,
  rgbaToGrayscale,
} from "../../src/client/photo/sharpness";
import {
  createAnalysisRunner,
  type AnalysisRunner,
} from "../../src/client/photo/analysisWorkerClient";
import {
  handleAnalysisRequest,
  runAnalysisJob,
  type AnalysisFrame,
} from "../../src/client/photo/offMainAnalysis";
import { generateSyntheticPaper } from "./helpers/synthetic-paper";
import {
  FakeAnalysisWorker,
  type FakeWorkerMode,
} from "./helpers/fake-analysis-worker";

const W = 640;
const H = 480;
const PIXELS = generateSyntheticPaper({ width: W, height: H, seed: 4243 }).data;
const PAPER_JOB = {
  kind: "paper",
  paperSize: "a4",
  options: { focalPxHint: 520 },
} as const;

/** Byte-for-byte equality, fast (`toStrictEqual` on megabyte arrays is very slow). */
function sameBytes(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  return (
    a.length === b.length &&
    Buffer.compare(
      Buffer.from(a.buffer, a.byteOffset, a.byteLength),
      Buffer.from(b.buffer, b.byteOffset, b.byteLength),
    ) === 0
  );
}

function freshFrame(): AnalysisFrame {
  return { width: W, height: H, data: new Uint8ClampedArray(PIXELS) };
}

const MAIN_QUAD = detectPaperQuad(
  freshFrame() as unknown as ImageData,
  "a4",
  PAPER_JOB.options,
);
const MAIN_SHARPNESS = computeLaplacianVariance(
  rgbaToGrayscale(PIXELS, W * H),
  W,
  H,
);

/** Runs both jobs through `runner`, counting rereads. */
async function runBoth(runner: AnalysisRunner) {
  let rereads = 0;
  const reread = () => {
    rereads += 1;
    return freshFrame();
  };
  const sharp = await runner.run({ kind: "sharpness" }, freshFrame(), reread);
  const paper = await runner.run(PAPER_JOB, sharp.frame, reread);
  return { sharp, paper, rereads: () => rereads };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("the shared job (runAnalysisJob / handleAnalysisRequest)", () => {
  it("is the main thread's own calls", () => {
    expect(runAnalysisJob(PAPER_JOB, freshFrame())).toStrictEqual({
      kind: "paper",
      quad: MAIN_QUAD,
    });
    expect(runAnalysisJob({ kind: "sharpness" }, freshFrame())).toStrictEqual({
      kind: "sharpness",
      laplacianVariance: MAIN_SHARPNESS,
    });
  });

  it("gives a sharpness of null where the main thread's try/catch did (an image with no interior)", () => {
    const tiny = { width: 2, height: 2, data: new Uint8ClampedArray(16) };
    expect(() =>
      computeLaplacianVariance(rgbaToGrayscale(tiny.data, 4), 2, 2),
    ).toThrow(RangeError);
    expect(runAnalysisJob({ kind: "sharpness" }, tiny)).toStrictEqual({
      kind: "sharpness",
      laplacianVariance: null,
    });
  });

  it("answers ok: false, with its id, when the request cannot be read", () => {
    const broken = handleAnalysisRequest({
      id: 8,
      job: { kind: "sharpness" },
      width: W,
      height: H,
      // Not something a typed array can be built on.
      buffer: Symbol("not a buffer") as unknown as ArrayBuffer,
    });
    expect(broken.ok).toBe(false);
    expect(broken.id).toBe(8);
  });
});

describe("fallback to the main thread, identical result", () => {
  it("no worker at all (createWorker gives null): fallback, no reread", async () => {
    const createWorker = vi.fn(() => null);
    const { sharp, paper, rereads } = await runBoth(
      createAnalysisRunner({ createWorker }),
    );
    expect(sharp.thread).toBe("fallback");
    expect(paper.thread).toBe("fallback");
    expect(sharp.outcome.laplacianVariance).toBe(MAIN_SHARPNESS);
    expect(paper.outcome.quad).toStrictEqual(MAIN_QUAD);
    expect(rereads()).toBe(0);
    // Not tried again for the second job.
    expect(createWorker).toHaveBeenCalledTimes(1);
  });

  it("the worker cannot be built (the constructor throws): fallback", async () => {
    const createWorker = vi.fn(() => {
      throw new Error("SecurityError");
    });
    const { sharp, paper, rereads } = await runBoth(
      createAnalysisRunner({ createWorker }),
    );
    expect([sharp.thread, paper.thread]).toStrictEqual([
      "fallback",
      "fallback",
    ]);
    expect(sharp.outcome.laplacianVariance).toBe(MAIN_SHARPNESS);
    expect(paper.outcome.quad).toStrictEqual(MAIN_QUAD);
    expect(rereads()).toBe(0);
    expect(createWorker).toHaveBeenCalledTimes(1);
  });

  it.each<[FakeWorkerMode, number]>([
    // The buffer came back with the error answer: nothing to reread.
    ["notOk", 0],
    // Nothing was transferred.
    ["postThrows", 0],
    // The worker kept the pixels: read again, once (the second job never
    // reaches a worker).
    ["error", 1],
    ["messageerror", 1],
  ])(
    "the worker %s: fallback, %i reread(s), worker built once and terminated",
    async (mode, expectedRereads) => {
      const workers: FakeAnalysisWorker[] = [];
      const runner = createAnalysisRunner({
        createWorker: () => {
          const w = new FakeAnalysisWorker(mode);
          workers.push(w);
          return w;
        },
      });
      const { sharp, paper, rereads } = await runBoth(runner);
      expect(sharp.thread).toBe("fallback");
      expect(paper.thread).toBe("fallback");
      expect(sharp.outcome.laplacianVariance).toBe(MAIN_SHARPNESS);
      expect(paper.outcome.quad).toStrictEqual(MAIN_QUAD);
      expect(sameBytes(paper.frame.data, PIXELS)).toBe(true);
      expect(rereads()).toBe(expectedRereads);
      expect(workers).toHaveLength(1);
      if (mode !== "notOk") expect(workers[0].terminated).toBe(true);
    },
  );

  it("an ok: false answer falls back for that job only; the worker stays for the next", async () => {
    const worker = new FakeAnalysisWorker("notOk");
    const runner = createAnalysisRunner({ createWorker: () => worker });
    const first = await runner.run(PAPER_JOB, freshFrame(), freshFrame);
    expect(first.thread).toBe("fallback");
    expect(first.outcome.quad).toStrictEqual(MAIN_QUAD);
    await runner.run(PAPER_JOB, freshFrame(), freshFrame);
    expect(worker.received).toHaveLength(2);
  });

  it("a worker that never answers: fallback after the timeout, with the pixels read again", async () => {
    vi.useFakeTimers();
    const worker = new FakeAnalysisWorker("silent");
    const runner = createAnalysisRunner({
      createWorker: () => worker,
      timeoutMs: 5_000,
    });
    let rereads = 0;
    const pending = runner.run(PAPER_JOB, freshFrame(), () => {
      rereads += 1;
      return freshFrame();
    });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(rereads).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result.thread).toBe("fallback");
    expect(result.outcome.quad).toStrictEqual(MAIN_QUAD);
    expect(rereads).toBe(1);
    expect(worker.terminated).toBe(true);
  });

  it("a frame whose pixels are a slice of a larger buffer is not transferred: fallback, untouched", async () => {
    const worker = new FakeAnalysisWorker("ok");
    const runner = createAnalysisRunner({ createWorker: () => worker });
    const big = new Uint8ClampedArray(PIXELS.length + 16);
    big.set(PIXELS, 16);
    const frame = { width: W, height: H, data: big.subarray(16) };
    const result = await runner.run(PAPER_JOB, frame, freshFrame);
    expect(result.thread).toBe("fallback");
    expect(result.outcome.quad).toStrictEqual(MAIN_QUAD);
    expect(worker.received).toHaveLength(0);
    expect(big.byteLength).toBe(PIXELS.length + 16);
  });
});

describe("the page's runner (getAnalysisRunner)", () => {
  it("where there is no Worker (Node, an old browser): fallback", async () => {
    expect(typeof (globalThis as { Worker?: unknown }).Worker).toBe(
      "undefined",
    );
    const { getAnalysisRunner } =
      await import("../../src/client/photo/analysisWorkerClient");
    const { sharp, paper } = await runBoth(getAnalysisRunner());
    expect([sharp.thread, paper.thread]).toStrictEqual([
      "fallback",
      "fallback",
    ]);
    expect(paper.outcome.quad).toStrictEqual(MAIN_QUAD);
  });

  it("where Worker exists: builds the module worker from paper.worker.ts, once", async () => {
    const built: { url: string; options: unknown }[] = [];
    class StubWorker extends FakeAnalysisWorker {
      constructor(url: URL, options: unknown) {
        super("ok");
        built.push({ url: String(url), options });
      }
    }
    vi.stubGlobal("Worker", StubWorker);
    const { getAnalysisRunner } =
      await import("../../src/client/photo/analysisWorkerClient");
    const { sharp, paper } = await runBoth(getAnalysisRunner());
    expect([sharp.thread, paper.thread]).toStrictEqual(["worker", "worker"]);
    expect(paper.outcome.quad).toStrictEqual(MAIN_QUAD);
    expect(built).toHaveLength(1);
    expect(built[0].url).toMatch(/paper\.worker\.ts$/);
    expect(built[0].options).toStrictEqual({ type: "module" });
  });

  it("where the Worker constructor throws (blocked by policy): fallback", async () => {
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("SecurityError");
        }
      },
    );
    const { getAnalysisRunner } =
      await import("../../src/client/photo/analysisWorkerClient");
    const { sharp, paper } = await runBoth(getAnalysisRunner());
    expect([sharp.thread, paper.thread]).toStrictEqual([
      "fallback",
      "fallback",
    ]);
    expect(sharp.outcome.laplacianVariance).toBe(MAIN_SHARPNESS);
    expect(paper.outcome.quad).toStrictEqual(MAIN_QUAD);
  });
});
