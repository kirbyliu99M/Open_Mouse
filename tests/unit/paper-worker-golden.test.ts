/**
 * V3.2 F8: the sheet detector and the sharpness give exactly the same answer
 * in the worker as on the main thread, on every one of the S2 golden scenes
 * (`helpers/s2-golden-scenes.ts`, 91 scenes, every one SIMULATED 模擬).
 *
 * "Main thread" is the call the pipeline made before F8, written out here
 * (`detectPaperQuad(imageData, "a4", { focalPxHint })`, and
 * `computeLaplacianVariance(rgbaToGrayscale(...))` with `null` where it
 * throws). "Worker" is the real client (`createAnalysisRunner`) talking to
 * the worker's own handler across a `structuredClone` boundary with the
 * buffer transferred (`helpers/fake-analysis-worker.ts`). Equal means
 * `toStrictEqual`: no tolerance.
 */
import { describe, expect, it } from "vitest";
import { detectPaperQuad } from "../../src/client/paper/detect";
import {
  computeLaplacianVariance,
  rgbaToGrayscale,
} from "../../src/client/photo/sharpness";
import { createAnalysisRunner } from "../../src/client/photo/analysisWorkerClient";
import { goldenFrames } from "./helpers/s2-golden-scenes";
import { FakeAnalysisWorker } from "./helpers/fake-analysis-worker";

const FOCAL_PX_HINT = 900;

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

function mainThreadSharpness(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): number | null {
  try {
    return computeLaplacianVariance(
      rgbaToGrayscale(data, width * height),
      width,
      height,
    );
  } catch {
    return null;
  }
}

describe("F8 — worker output equals the main thread's on the S2 golden scenes", () => {
  const frames = goldenFrames();

  it("covers all 91 scenes", () => {
    expect(frames).toHaveLength(91);
  });

  it("every scene: the same detection, the same sharpness, the pixels back unchanged, the buffer transferred", async () => {
    const worker = new FakeAnalysisWorker("ok");
    const runner = createAnalysisRunner({ createWorker: () => worker });
    const noReread = () => {
      throw new Error("the worker path must not reread the pixels");
    };
    for (const scene of frames) {
      const { width, height } = scene;
      const original = new Uint8ClampedArray(scene.data);

      const mainQuad = detectPaperQuad(
        {
          width,
          height,
          data: new Uint8ClampedArray(original),
        } as unknown as ImageData,
        "a4",
        { focalPxHint: FOCAL_PX_HINT },
      );
      const mainSharpness = mainThreadSharpness(
        new Uint8ClampedArray(original),
        width,
        height,
      );

      const sent = { width, height, data: new Uint8ClampedArray(original) };
      const sharp = await runner.run({ kind: "sharpness" }, sent, noReread);
      // Transferred, not copied: the sender's view is detached.
      expect(sent.data.byteLength, scene.name).toBe(0);
      const paper = await runner.run(
        {
          kind: "paper",
          paperSize: "a4",
          options: { focalPxHint: FOCAL_PX_HINT },
        },
        sharp.frame,
        noReread,
      );
      expect(sharp.frame.data.byteLength, scene.name).toBe(0);

      expect(sharp.thread, scene.name).toBe("worker");
      expect(paper.thread, scene.name).toBe("worker");
      expect(sharp.outcome.laplacianVariance, scene.name).toBe(mainSharpness);
      expect(paper.outcome.quad, scene.name).toStrictEqual(mainQuad);
      // `toStrictEqual` treats an absent key and `undefined` alike; the key
      // sets must match too (S2: a found sheet has no `failureStage` key).
      expect(Object.keys(paper.outcome.quad).sort(), scene.name).toStrictEqual(
        Object.keys(mainQuad).sort(),
      );
      expect(sameBytes(paper.frame.data, original), scene.name).toBe(true);
    }
    // One request per job, nothing else.
    expect(worker.received).toHaveLength(frames.length * 2);
  }, 240_000);
});
