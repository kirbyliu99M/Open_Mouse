/**
 * F7 (Kirby's phone test 2026-10-21): the photo analysis lets the browser
 * draw a frame between its steps, so the loader moves while it works
 * (src/client/photo/yieldToBrowser.ts). It only waits; it never hangs.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  YIELD_FALLBACK_MS,
  yieldToBrowser,
  type YieldEnvironment,
} from "../../src/client/photo/yieldToBrowser";

afterEach(() => {
  vi.useRealTimers();
});

function fakeEnvironment(visibilityState?: string) {
  const frames: (() => void)[] = [];
  const env: YieldEnvironment = {
    requestAnimationFrame: (callback) => frames.push(callback),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    visibilityState,
  };
  return { env, frames };
}

describe("yieldToBrowser", () => {
  it("waits for the next animation frame, then one task after it (that frame is painted)", async () => {
    vi.useFakeTimers();
    const { env, frames } = fakeEnvironment("visible");
    let resolved = false;
    void yieldToBrowser(env).then(() => {
      resolved = true;
    });
    // Before the frame: still waiting, even after a task.
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(false);
    expect(frames).toHaveLength(1);
    // The frame comes; the task after it lets the run go on.
    frames[0]!();
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(true);
  });

  it("gives up on a frame that never comes after YIELD_FALLBACK_MS, so a run never hangs", async () => {
    vi.useFakeTimers();
    const { env } = fakeEnvironment("visible");
    let resolved = false;
    void yieldToBrowser(env).then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(YIELD_FALLBACK_MS - 1);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
    expect(YIELD_FALLBACK_MS).toBe(100);
  });

  it("a hidden page or one with no animation frames waits one task only", async () => {
    vi.useFakeTimers();
    const hidden = fakeEnvironment("hidden");
    let a = false;
    void yieldToBrowser(hidden.env).then(() => {
      a = true;
    });
    expect(hidden.frames).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(a).toBe(true);

    let b = false;
    void yieldToBrowser({
      setTimeout: (callback, ms) => setTimeout(callback, ms),
    }).then(() => {
      b = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(b).toBe(true);
  });

  it("in this test environment (no animation frames) it resolves on its own", async () => {
    await expect(yieldToBrowser()).resolves.toBeUndefined();
  });
});

describe("the pipeline yields between its steps (pipeline.ts)", () => {
  // Read as LF whatever the checkout's line endings are.
  const source = readFileSync("src/client/photo/pipeline.ts", "utf8")
    .split("\r\n")
    .join("\n");

  it("after decoding, before the sheet is looked for, after the sheet and after the hand", () => {
    const decoded = source.indexOf('notifyStage(input, "decoded");');
    const firstYield = source.indexOf("await yieldToBrowser();", decoded);
    const runDecoded = source.indexOf(
      "return await runDecodedPipeline(",
      decoded,
    );
    expect(firstYield).toBeGreaterThan(decoded);
    expect(firstYield).toBeLessThan(runDecoded);

    // Inside the paper step itself: after the sharpness is worked out and
    // before the sheet's clock starts and the detector runs (an anchor on the
    // import line would let a missing yield through).
    // Since F8 both run through the worker client (analysisWorkerClient.ts),
    // so the anchors are those calls.
    const sharpness = source.indexOf(
      "trace.laplacianVariance = sharp.outcome.laplacianVariance;",
    );
    const paperStart = source.indexOf(
      "const paperStartedAt = performance.now();",
      sharpness,
    );
    const detect = source.indexOf(
      "const detected = await getAnalysisRunner().run(",
      sharpness,
    );
    expect(sharpness).toBeGreaterThan(0);
    expect(paperStart).toBeGreaterThan(sharpness);
    expect(detect).toBeGreaterThan(paperStart);
    const before = source.indexOf("await yieldToBrowser();", sharpness);
    expect(before).toBeGreaterThan(sharpness);
    expect(before).toBeLessThan(paperStart);
    for (const after of [
      'notifyStage(input, "paper");\n    await yieldToBrowser();',
      'notifyStage(input, "paper");\n  await yieldToBrowser();',
    ])
      expect(source).toContain(after);
    const hand = source.indexOf('notifyStage(input, "hand");');
    const handYield = source.indexOf("await yieldToBrowser();", hand);
    expect(hand).toBeGreaterThan(0);
    expect(handYield).toBeGreaterThan(hand);
    expect(handYield).toBeLessThan(source.indexOf("return hand;", hand));
  });
});
