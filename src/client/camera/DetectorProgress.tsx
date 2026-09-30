"use client";

import { useRef, useSyncExternalStore } from "react";
import {
  DETECTOR_LOAD_FAILED_MESSAGE,
  getDetectorLoadState,
  getHandLandmarker,
  subscribeDetectorLoadState,
  type DetectorLoadState,
} from "../photo/landmarks";
import { describeDetectorLoad } from "../photo/model-download";

const IDLE: DetectorLoadState = { stage: "idle" };

/**
 * The hand detector's model is 7.8 MB, fetched in the background while the
 * camera opens. This shows how far along it is, so a slow first load reads as
 * progress and not as a broken camera. Nothing renders once it is ready (or
 * before it starts), and a second visit in the same session never shows it:
 * the detector is loaded once.
 *
 * If the detector could not be loaded at all, it says so and offers a retry:
 * without this the failure was invisible until a photo was taken.
 *
 * Assistive technology gets a `progressbar` whose value moves in 10% steps
 * (not once per chunk); the visible megabyte count is hidden from it as a
 * duplicate. `inert` takes it out while a full-screen step covers the shell.
 */
export function DetectorProgress({ inert = false }: { inert?: boolean }) {
  const state = useSyncExternalStore(
    subscribeDetectorLoadState,
    getDetectorLoadState,
    () => IDLE,
  );
  // The same element stays mounted from "failed" through the retry, so focus
  // has somewhere to stay when the retry button goes away.
  const rootRef = useRef<HTMLDivElement>(null);

  if (state.stage === "failed") {
    return (
      <div
        ref={rootRef}
        className="easyDetectorProgress easyDetectorFailed"
        data-testid="detector-progress"
        data-state="failed"
        role="alert"
        tabIndex={-1}
        inert={inert}
      >
        <p className="easyDetectorText">{DETECTOR_LOAD_FAILED_MESSAGE}</p>
        <button
          type="button"
          className="easyDetectorRetry"
          onClick={() => {
            rootRef.current?.focus();
            void getHandLandmarker().catch(() => {
              // The store says "failed" again, and the notice comes back.
            });
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  const view = describeDetectorLoad(state);
  if (!view.visible) return null;
  const determinate = view.announced !== null;
  return (
    <div
      ref={rootRef}
      className="easyDetectorProgress"
      data-testid="detector-progress"
      data-state="loading"
      tabIndex={-1}
      inert={inert}
    >
      <div
        className="easyDetectorBar"
        role="progressbar"
        aria-label={view.text}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(determinate
          ? {
              "aria-valuenow": view.announced,
              "aria-valuetext": `${view.announced} percent`,
            }
          : {})}
      >
        <span
          className={`easyDetectorFill${determinate ? "" : " indeterminate"}`}
          // A transform, not a width: the bar moves on the compositor and the
          // layout does not change on every chunk.
          style={
            determinate
              ? { transform: `scaleX(${(view.percent ?? 0) / 100})` }
              : undefined
          }
        />
      </div>
      <p className="easyDetectorText" aria-hidden="true">
        {view.text}
        {view.detail ? ` · ${view.detail}` : "…"}
      </p>
    </div>
  );
}
