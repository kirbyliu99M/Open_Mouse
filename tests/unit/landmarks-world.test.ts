/**
 * V3.3 WP1b: MediaPipe's per-point z and world landmarks, from the same one
 * `detect()` as before, for the photo (`detectHandLandmarks`) and the live
 * viewfinder (`readLiveHand`). `landmarksPx` / `readLiveHandPoints` are what
 * they were.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  detect: vi.fn(),
  createFromOptions: vi.fn(),
}));

vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) },
  HandLandmarker: { createFromOptions: mocks.createFromOptions },
}));

async function freshModule() {
  vi.resetModules();
  return import("../../src/client/photo/landmarks");
}

const NORM = Array.from({ length: 21 }, (_, i) => ({
  x: 0.1 + i * 0.01,
  y: 0.5 - i * 0.01,
  z: i === 0 ? 0 : -0.001 * i,
  visibility: 0,
}));
const WORLD = Array.from({ length: 21 }, (_, i) => ({
  x: 0.001 * i,
  y: -0.002 * i,
  z: 0.0005 * i,
  visibility: 0,
}));

beforeEach(() => {
  mocks.detect.mockReset();
  mocks.createFromOptions.mockReset();
  mocks.createFromOptions.mockImplementation(async () => ({
    detect: mocks.detect,
  }));
});

describe("pure helpers", () => {
  it("landmarkDepths: 21 finite z or null", async () => {
    const { landmarkDepths } = await freshModule();
    expect(landmarkDepths(NORM)).toEqual(NORM.map((p) => p.z));
    expect(landmarkDepths(NORM.slice(0, 20))).toBeNull();
    expect(landmarkDepths([...NORM.slice(0, 20), { z: Number.NaN }])).toBe(
      null,
    );
    expect(landmarkDepths(null)).toBeNull();
  });

  it("toWorldPoints: 21 finite points (x, y, z only) or null", async () => {
    const { toWorldPoints } = await freshModule();
    const out = toWorldPoints(WORLD)!;
    expect(out).toHaveLength(21);
    expect(out[3]).toStrictEqual({ x: 0.003, y: -0.006, z: 0.0015 });
    expect(toWorldPoints(WORLD.slice(1))).toBeNull();
    expect(toWorldPoints([...WORLD.slice(1), { x: 0, y: 0 }])).toBeNull();
    expect(toWorldPoints(undefined)).toBeNull();
  });
});

describe("detectHandLandmarks", () => {
  it("adds z and the world landmarks; landmarksPx is unchanged", async () => {
    mocks.detect.mockReturnValue({
      landmarks: [NORM],
      worldLandmarks: [WORLD],
      handedness: [[{ categoryName: "Right", score: 0.93 }]],
    });
    const { detectHandLandmarks, toPixelPoints } = await freshModule();
    const bitmap = { width: 1000, height: 2000 } as ImageBitmap;
    const hand = (await detectHandLandmarks(bitmap))!;
    expect(hand.landmarksPx).toStrictEqual(toPixelPoints(NORM, 1000, 2000));
    expect(hand.handedness).toBe("right");
    expect(hand.confidence).toBe(0.93);
    expect(hand.landmarkZ).toEqual(NORM.map((p) => p.z));
    expect(hand.worldLandmarks).toHaveLength(21);
    expect(mocks.detect).toHaveBeenCalledTimes(1);
  });

  it("no world landmarks from MediaPipe: null, and the rest as before", async () => {
    mocks.detect.mockReturnValue({
      landmarks: [NORM],
      handedness: [[{ categoryName: "Left", score: 0.8 }]],
    });
    const { detectHandLandmarks } = await freshModule();
    const hand = (await detectHandLandmarks({
      width: 10,
      height: 10,
    } as ImageBitmap))!;
    expect(hand.worldLandmarks).toBeNull();
    expect(hand.handedness).toBe("left");
  });
});

describe("readLiveHand / readLiveHandPoints", () => {
  it("undefined before the landmarker is loaded", async () => {
    const { readLiveHand, readLiveHandPoints } = await freshModule();
    const img = {} as ImageData;
    expect(readLiveHand(img, 360, 640)).toBeUndefined();
    expect(readLiveHandPoints(img, 360, 640)).toBeUndefined();
  });

  it("one detect(): the same points, plus z and world", async () => {
    mocks.detect.mockReturnValue({
      landmarks: [NORM],
      worldLandmarks: [WORLD],
      handedness: [],
    });
    const mod = await freshModule();
    await mod.getHandLandmarker();
    const img = {} as ImageData;
    const reading = mod.readLiveHand(img, 360, 640)!;
    expect(reading.points).toStrictEqual(mod.toPixelPoints(NORM, 360, 640));
    expect(reading.z).toEqual(NORM.map((p) => p.z));
    expect(reading.world).toHaveLength(21);
    expect(mocks.detect).toHaveBeenCalledTimes(1);
    expect(mod.readLiveHandPoints(img, 360, 640)).toStrictEqual(reading.points);
  });

  it("null with no hand or when detect throws", async () => {
    const mod = await freshModule();
    await mod.getHandLandmarker();
    mocks.detect.mockReturnValueOnce({ landmarks: [], worldLandmarks: [] });
    expect(mod.readLiveHand({} as ImageData, 1, 1)).toBeNull();
    mocks.detect.mockImplementationOnce(() => {
      throw new Error("wasm");
    });
    expect(mod.readLiveHand({} as ImageData, 1, 1)).toBeNull();
  });
});
