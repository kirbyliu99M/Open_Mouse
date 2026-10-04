import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CreateCall = [unknown, { baseOptions: Record<string, unknown> }];

// What MediaPipe does with a modelAssetBuffer that is a reader: read it to the
// end (after the WASM has loaded) before the landmarker exists. A reader that
// errors makes createFromOptions reject.
async function readModelLikeMediaPipe(...args: CreateCall) {
  const model = args[1].baseOptions.modelAssetBuffer as
    ReadableStreamDefaultReader<Uint8Array> | undefined;
  const chunks: Uint8Array[] = [];
  if (model)
    for (;;) {
      const { done, value } = await model.read();
      if (done) break;
      chunks.push(value);
    }
  return {
    detect: vi.fn(),
    modelBytes: chunks.reduce((n, c) => n + c.length, 0),
  };
}

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  forVisionTasks: vi.fn(),
  createFromOptions: vi.fn(),
}));

vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: mocks.forVisionTasks },
  HandLandmarker: { createFromOptions: mocks.createFromOptions },
}));

const MODEL = new Uint8Array(200).fill(5);

function modelResponse(headers: Record<string, string> = {}) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(MODEL.slice(0, 120));
        controller.enqueue(MODEL.slice(120));
        controller.close();
      },
    }),
    { headers: { "content-length": String(MODEL.length), ...headers } },
  );
}

async function freshModule() {
  vi.resetModules();
  return import("../../src/client/photo/landmarks");
}

beforeEach(() => {
  mocks.order.length = 0;
  mocks.forVisionTasks.mockReset();
  mocks.forVisionTasks.mockImplementation(async () => {
    mocks.order.push("wasm");
    return { wasm: "fileset" };
  });
  mocks.createFromOptions.mockReset();
  mocks.createFromOptions.mockImplementation(readModelLikeMediaPipe);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getHandLandmarker", () => {
  it("counts the model as MediaPipe reads it, after the runtime, and reports each stage", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      mocks.order.push(`fetch ${input}`);
      return modelResponse();
    });
    vi.stubGlobal("fetch", fetchMock);
    const landmarks = await freshModule();
    const stages: string[] = [];
    landmarks.subscribeDetectorLoadState(() => {
      const state = landmarks.getDetectorLoadState();
      stages.push(
        state.stage === "model"
          ? `model ${state.loadedBytes}/${state.totalBytes}`
          : state.stage,
      );
    });

    expect(landmarks.getDetectorLoadState()).toEqual({ stage: "idle" });
    await landmarks.getHandLandmarker();

    // The same order as before this counted bytes: the WASM runtime first,
    // the model only when MediaPipe reads it.
    expect(mocks.order).toEqual([
      "wasm",
      "fetch /mediapipe/models/hand_landmarker.task",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const options = mocks.createFromOptions.mock.calls[0]![1] as CreateCall[1];
    // A reader, not a path, and MediaPipe read every byte of it.
    expect(options.baseOptions.modelAssetBuffer).toBeInstanceOf(
      ReadableStreamDefaultReader,
    );
    expect(options.baseOptions).not.toHaveProperty("modelAssetPath");
    expect(options.baseOptions.delegate).toBe("CPU");
    const created = await mocks.createFromOptions.mock.results[0]!.value;
    expect(created.modelBytes).toBe(200);

    // runtime (nothing to count) -> model (counted) -> ready
    expect(stages[0]).toBe("runtime");
    expect(stages).toContain("model 0/200");
    expect(stages).toContain("model 200/200");
    expect(stages.indexOf("model 0/200")).toBeGreaterThan(0);
    expect(stages.at(-1)).toBe("ready");
    expect(landmarks.getDetectorLoadState()).toEqual({ stage: "ready" });
  });

  it("does not fetch the model just because the landmarker is asked for: only MediaPipe's read does", async () => {
    const fetchMock = vi.fn(async () => modelResponse());
    vi.stubGlobal("fetch", fetchMock);
    // A createFromOptions that holds back before it reads the reader (a
    // stand-in for the stretch while MediaPipe is still loading its runtime).
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    mocks.createFromOptions.mockImplementation(async (...args: CreateCall) => {
      await gate;
      return readModelLikeMediaPipe(...args);
    });
    const landmarks = await freshModule();
    const pending = landmarks.getHandLandmarker();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchMock).not.toHaveBeenCalled();
    release();
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("loads once per session: a second call downloads and starts nothing", async () => {
    const fetchMock = vi.fn(async () => modelResponse());
    vi.stubGlobal("fetch", fetchMock);
    const landmarks = await freshModule();
    const first = await landmarks.getHandLandmarker();
    const second = await landmarks.getHandLandmarker();
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.createFromOptions).toHaveBeenCalledTimes(1);
    expect(mocks.forVisionTasks).toHaveBeenCalledTimes(1);
    expect(landmarks.getDetectorLoadState()).toEqual({ stage: "ready" });
  });

  it("two callers at once share one download", async () => {
    const fetchMock = vi.fn(async () => modelResponse());
    vi.stubGlobal("fetch", fetchMock);
    const landmarks = await freshModule();
    const [a, b] = await Promise.all([
      landmarks.getHandLandmarker(),
      landmarks.getHandLandmarker(),
    ]);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("without Content-Length still loads, and the progress has no total", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(modelResponse().body)),
    );
    const landmarks = await freshModule();
    const totals = new Set<number | null>();
    landmarks.subscribeDetectorLoadState(() => {
      const state = landmarks.getDetectorLoadState();
      if (state.stage === "model") totals.add(state.totalBytes);
    });
    await landmarks.getHandLandmarker();
    expect([...totals]).toEqual([null]);
    const created = await mocks.createFromOptions.mock.results[0]!.value;
    expect(created.modelBytes).toBe(200);
  });

  it.each([
    ["the download fails", () => Promise.reject(new TypeError("offline"))],
    ["the response is not OK", async () => new Response("", { status: 503 })],
    [
      "the model is cut short",
      async () =>
        new Response(new Uint8Array(50), {
          headers: { "content-length": "200" },
        }),
    ],
  ])(
    "when %s, MediaPipe loads the model by path, as before, and the detector comes up",
    async (_name, respond) => {
      vi.stubGlobal("fetch", vi.fn(respond));
      const landmarks = await freshModule();
      await expect(landmarks.getHandLandmarker()).resolves.toBeTruthy();
      expect(mocks.createFromOptions).toHaveBeenCalledTimes(2);
      const retry = mocks.createFromOptions.mock.calls[1]![1] as CreateCall[1];
      expect(retry.baseOptions.modelAssetPath).toBe(
        "/mediapipe/models/hand_landmarker.task",
      );
      expect(retry.baseOptions).not.toHaveProperty("modelAssetBuffer");
      expect(retry.baseOptions.delegate).toBe("CPU");
      expect(landmarks.getDetectorLoadState()).toEqual({ stage: "ready" });
    },
  );

  it("a start that fails both ways reports failed, does not poison a retry, and downloads again", async () => {
    const fetchMock = vi.fn(async () => modelResponse());
    vi.stubGlobal("fetch", fetchMock);
    mocks.createFromOptions.mockRejectedValue(new Error("wasm failed"));
    const landmarks = await freshModule();

    await expect(landmarks.getHandLandmarker()).rejects.toBeInstanceOf(
      landmarks.HandLandmarkerLoadError,
    );
    expect(landmarks.getDetectorLoadState()).toEqual({ stage: "failed" });
    expect(mocks.createFromOptions).toHaveBeenCalledTimes(2);

    mocks.createFromOptions.mockReset();
    mocks.createFromOptions.mockImplementation(readModelLikeMediaPipe);
    await expect(landmarks.getHandLandmarker()).resolves.toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(landmarks.getDetectorLoadState()).toEqual({ stage: "ready" });
  });

  it("stops telling a subscriber once it unsubscribes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => modelResponse()),
    );
    const landmarks = await freshModule();
    const listener = vi.fn();
    const stop = landmarks.subscribeDetectorLoadState(listener);
    stop();
    await landmarks.getHandLandmarker();
    expect(listener).not.toHaveBeenCalled();
  });
});
