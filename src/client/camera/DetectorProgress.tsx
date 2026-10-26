"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocale } from "@/client/i18n/LocaleProvider";
import { scanCommonCopy } from "../../lib/copy/scan-common";
import {
  getDetectorLoadState,
  getHandLandmarker,
  subscribeDetectorLoadState,
  type DetectorLoadState,
} from "../photo/landmarks";
import { describeDetectorLoad } from "../photo/model-download";
import { fadeMs } from "./scanMotion";
import { useLeaving } from "./useLeaving";
import { LeaveShield } from "./LeaveShield";
import { usePrefersReducedMotion } from "./useReducedMotion";

const IDLE: DetectorLoadState = { stage: "idle" };

/**
 * A load still going this long after the scan screen opened is slow: only
 * then does a faint bar appear (Kirby 2026-10-26, "transparent loading",
 * candidate / 未拍板). A load from the warmed cache is done well before.
 */
export const DETECTOR_QUIET_AFTER_MS = 2000;

/**
 * The hand detector's model is 7.8 MB, fetched in the background while the
 * camera opens (and warmed from the landing page, preloadDetector.ts). Since
 * 2026-10-26 the loading says nothing (Kirby: "don't say it's loading, make
 * it background"): only a load slower than `DETECTOR_QUIET_AFTER_MS` gets a
 * faint bar with no words (screen readers still get the progress bar's name
 * and value), which fades out when the detector is ready.
 *
 * If the detector could not be loaded at all, it says so and offers a retry:
 * without this the failure was invisible until a photo was taken. `inert`
 * takes it out while a full-screen step covers the shell.
 */
export function DetectorProgress({ inert = false }: { inert?: boolean }) {
  const state = useSyncExternalStore(
    subscribeDetectorLoadState,
    getDetectorLoadState,
    () => IDLE,
  );
  const locale = useLocale();
  const words = scanCommonCopy(locale);
  // The same element stays mounted from "failed" through the retry, so focus
  // has somewhere to stay when the retry button goes away.
  const rootRef = useRef<HTMLDivElement>(null);
  // A retry the person asked for (「再試一次」): until it ends, the notice stays
  // and says it is loading, so the press has an answer and focus keeps its
  // place. The first load says nothing.
  const [retrying, setRetrying] = useState(false);
  if (retrying && state.stage === "ready") setRetrying(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setSlow(true), DETECTOR_QUIET_AFTER_MS);
    return () => window.clearTimeout(id);
  }, []);
  const reducedMotion = usePrefersReducedMotion();
  const quietView =
    slow && !retrying && state.stage !== "failed"
      ? describeDetectorLoad(state, locale)
      : null;
  const quiet = useLeaving(
    quietView?.visible ? quietView : null,
    fadeMs("out", reducedMotion),
  );
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
        <p className="easyDetectorText">{words.detectorLoadFailed}</p>
        <button
          type="button"
          className="easyDetectorRetry"
          onClick={() => {
            rootRef.current?.focus();
            setRetrying(true);
            void getHandLandmarker().catch(() => {
              // The store says "failed" again, and the notice comes back.
            });
          }}
        >
          {words.detectorTryAgain}
        </button>
      </div>
    );
  }

  if (retrying && state.stage !== "ready") {
    // The same element as the failure notice (same type, same place), so
    // React keeps it and focus stays on it.
    return (
      <div
        ref={rootRef}
        className="easyDetectorProgress"
        data-testid="detector-progress"
        data-state="retrying"
        role="status"
        tabIndex={-1}
        inert={inert}
      >
        <p className="easyDetectorText">{words.detectorLoading}…</p>
      </div>
    );
  }

  // Loading is silent (Kirby 2026-10-26, candidate / 未拍板): the files are
  // warmed from the landing page (preloadDetector.ts) and the detector loads
  // in the background; a photo taken before it is ready waits under the
  // 「量測中」 pill. A slow load gets the faint bar below; a failure, and a
  // retry the person asked for, are said in words.
  const view = quiet.shown;
  if (!view) return null;
  const determinate = view.announced !== null;
  return (
    <>
      <div
        ref={rootRef}
        className="easyDetectorProgress easyDetectorQuiet"
        data-testid="detector-progress"
        data-state="loading"
        data-leaving={quiet.leaving ? "true" : undefined}
        tabIndex={-1}
        inert={inert || quiet.leaving}
        aria-hidden={quiet.leaving || undefined}
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
                "aria-valuetext": words.detectorPercent(
                  view.announced as number,
                ),
              }
            : {})}
        >
          <span
            className={`easyDetectorFill${determinate ? "" : " indeterminate"}`}
            style={
              determinate
                ? { transform: `scaleX(${(view.percent ?? 0) / 100})` }
                : undefined
            }
          />
        </div>
      </div>
      {/* Leaving: a transparent layer takes the taps over it (LeaveShield). */}
      {quiet.leaving && <LeaveShield target={rootRef} />}
    </>
  );
}
