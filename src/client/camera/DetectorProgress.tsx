"use client";

import { useSyncExternalStore } from "react";
import {
  getDetectorLoadState,
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
 * Assistive technology gets a `progressbar` whose value moves in 10% steps
 * (not once per chunk); the visible megabyte count is hidden from it as a
 * duplicate.
 */
export function DetectorProgress() {
  const state = useSyncExternalStore(
    subscribeDetectorLoadState,
    getDetectorLoadState,
    () => IDLE,
  );
  const view = describeDetectorLoad(state);
  if (!view.visible) return null;
  const determinate = view.announced !== null;
  return (
    <div className="easyDetectorProgress" data-testid="detector-progress">
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
          style={determinate ? { width: `${view.percent}%` } : undefined}
        />
      </div>
      <p className="easyDetectorText" aria-hidden="true">
        {view.text}
        {view.detail ? ` · ${view.detail}` : "…"}
      </p>
    </div>
  );
}
