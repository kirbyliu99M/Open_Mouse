/**
 * 2026-10-28: the live dots' states go through a small store that only the
 * dots read (EasyCorners.tsx), so a sample no longer re-renders the whole
 * camera screen. The store itself, and the camera's wiring.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createCornerStore } from "@/client/camera/EasyCorners";
import {
  advanceCorners,
  INITIAL_CORNER_STATES,
} from "@/client/camera/cornerSmoother";

describe("the dots' store", () => {
  it("hands out what was set and tells each listener once per change", () => {
    const store = createCornerStore(INITIAL_CORNER_STATES);
    expect(store.get()).toBe(INITIAL_CORNER_STATES);
    let calls = 0;
    const stop = store.subscribe(() => {
      calls += 1;
    });
    const next = advanceCorners(
      INITIAL_CORNER_STATES,
      [{ x: 1, y: 2 }, null, null, null],
      125,
    );
    store.set(next);
    expect(store.get()).toBe(next);
    expect(calls).toBe(1);
    // The same states again are no change.
    store.set(next);
    expect(calls).toBe(1);
    stop();
    store.set(INITIAL_CORNER_STATES);
    expect(calls).toBe(1);
    expect(store.get()).toBe(INITIAL_CORNER_STATES);
  });

  it("the camera writes the store, not camera state, and draws the dots from it", () => {
    const camera = readFileSync("src/client/camera/EasyScanCamera.tsx", "utf8");
    expect(camera).not.toContain("setCornerStates");
    expect(camera).toContain("cornerStore.set(cornerStatesRef.current)");
    expect(camera).toContain("<LiveEasyCorners");
    expect(camera).toContain("store={cornerStore}");
    // The dots' filter is given the picture's diagonal (speeds are measured against it).
    expect(camera).toContain(
      "CAMERA_CONSTANTS.corners,\n          outlineDiagonal,",
    );
  });
});
