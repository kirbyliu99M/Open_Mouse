import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CreateCall = [unknown, { baseOptions: Record<string, unknown> }];

const mocks = vi.hoisted(() => ({
  forVisionTasks: vi.fn(async () => ({ wasm: "fileset" })),
  createFromOptions: vi.fn(async (...args: CreateCall) => {
    void args;
    return { detect: vi.fn() };
  }),
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
  mocks.forVisionTasks.mockClear();
  mocks.createFromOptions.mockClear();
  mocks.createFromOptions.mockImplementation(async (...args: CreateCall) => {
    void args;
    return { detect: vi.fn() };
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getHandLandmarker", () => {
  it("reads the model itself, with progress, and hands MediaPipe the bytes", async () => {
    const fetchMock = vi.fn(async () => modelResponse());
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls as unknown[][])[0]![0]).toBe(
      "/mediapipe/models/hand_landmarker.task",
    );
    const options = mocks.createFromOptions.mock.calls[0]![1];
    expect(options.baseOptions.modelAssetBuffer).toBeInstanceOf(Uint8Array);
    expect((options.baseOptions.modelAssetBuffer as Uint8Array).length).toBe(
      200,
    );
    expect(options.baseOptions).not.toHaveProperty("modelAssetPath");
    expect(options.baseOptions.delegate).toBe("CPU");

    // model (counted) -> runtime (indeterminate) -> ready
    // Started (size not known yet), then the counted reads.
    expect(stages[0]).toBe("model 0/null");
    expect(stages).toContain("model 0/200");
    expect(stages).toContain("model 200/200");
    expect(stages.indexOf("runtime")).toBeGreaterThan(
      stages.indexOf("model 200/200"),
    );
    expect(stages.at(-1)).toBe("ready");
    expect(landmarks.getDetectorLoadState()).toEqual({ stage: "ready" });
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
      vi.fn(async () => {
        const response = modelResponse();
        const bare = new Response(response.body);
        return bare;
      }),
    );
    const landmarks = await freshModule();
    const totals = new Set<number | null>();
    landmarks.subscribeDetectorLoadState(() => {
      const state = landmarks.getDetectorLoadState();
      if (state.stage === "model") totals.add(state.totalBytes);
    });
    await landmarks.getHandLandmarker();
    expect([...totals]).toEqual([null]);
    const options = mocks.createFromOptions.mock.calls[0]![1];
    expect(options.baseOptions.modelAssetBuffer).toBeInstanceOf(Uint8Array);
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
    "when %s, falls back to MediaPipe loading the model by path, as before",
    async (_name, respond) => {
      vi.stubGlobal("fetch", vi.fn(respond));
      const landmarks = await freshModule();
      await expect(landmarks.getHandLandmarker()).resolves.toBeTruthy();
      const options = mocks.createFromOptions.mock.calls[0]![1];
      expect(options.baseOptions.modelAssetPath).toBe(
        "/mediapipe/models/hand_landmarker.task",
      );
      expect(options.baseOptions).not.toHaveProperty("modelAssetBuffer");
      expect(landmarks.getDetectorLoadState()).toEqual({ stage: "ready" });
    },
  );

  it("a failed start reports failed, does not poison a retry, and downloads again", async () => {
    const fetchMock = vi.fn(async () => modelResponse());
    vi.stubGlobal("fetch", fetchMock);
    mocks.createFromOptions.mockRejectedValueOnce(new Error("wasm failed"));
    const landmarks = await freshModule();

    await expect(landmarks.getHandLandmarker()).rejects.toBeInstanceOf(
      landmarks.HandLandmarkerLoadError,
    );
    expect(landmarks.getDetectorLoadState()).toEqual({ stage: "failed" });

    await expect(landmarks.getHandLandmarker()).resolves.toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
