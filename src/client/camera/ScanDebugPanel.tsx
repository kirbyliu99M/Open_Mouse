"use client";

import { useState } from "react";
import { describeAttempt } from "./attemptLog";
import { debugSnapshotJson, type ScanDebugSnapshot } from "./debugStats";

const fixed = (value: number | null, digits: number) =>
  value === null ? "–" : value.toFixed(digits);

/**
 * The scan debug panel, shown only at `/scan/easy?debug=1` and linked from
 * nowhere. It lists what the camera reported and how the live loop is doing,
 * so real-phone numbers can be read off and pasted back. Nothing leaves the
 * device from here: it draws numbers, and "Copy JSON" only writes to the
 * clipboard (and, where the browser refuses that, shows the JSON in a box to
 * copy by hand). No image is kept.
 */
export function ScanDebugPanel({
  snapshot,
}: {
  readonly snapshot: ScanDebugSnapshot;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">(
    "idle",
  );
  const json = debugSnapshotJson(snapshot);
  const {
    live,
    capture,
    track,
    capabilities,
    focusApplied,
    preview,
    attempts,
  } = snapshot;

  async function copy() {
    try {
      await navigator.clipboard.writeText(json);
      setCopyState("copied");
    } catch {
      setCopyState("manual");
    }
  }

  return (
    <aside className="easyDebug" data-testid="scan-debug-panel">
      <dl>
        <dt>Device</dt>
        <dd>{snapshot.userAgent}</dd>
        <dt>Track</dt>
        <dd>
          {track
            ? `${track.width ?? "?"}×${track.height ?? "?"} @ ${track.frameRate ?? "?"} fps · video ${track.videoWidth ?? "?"}×${track.videoHeight ?? "?"}`
            : "–"}
        </dd>
        <dt>Preview vs photo</dt>
        <dd data-testid="debug-fov">
          {preview.stillAspect === null
            ? "–"
            : `photo ${fixed(preview.stillAspect, 3)} (${preview.stillAspectSource === "photoCapabilities" ? `max ${preview.photoMax?.width}×${preview.photoMax?.height}` : "assumed"}) · preview ${fixed(preview.previewAspect, 3)} · diff ${fixed(preview.aspectDiff === null ? null : preview.aspectDiff * 100, 1)}% · ${preview.fovMismatch === null ? "?" : preview.fovMismatch ? "FOV MISMATCH" : "same field of view"}`}
          {preview.requested
            ? ` · asked ${preview.requested.width ?? "?"}×${preview.requested.height ?? "?"} (${fixed(preview.requested.aspectRatio, 3)})`
            : ""}
          {preview.reapplied
            ? preview.reapplied.applied
              ? " · re-asked yes"
              : ` · re-asked no (${preview.reapplied.reason ?? "?"})`
            : ""}
        </dd>
        <dt>Focus modes</dt>
        <dd>
          {capabilities ? capabilities.focusMode.join(", ") || "none" : "–"}
        </dd>
        <dt>Points of interest</dt>
        <dd>
          {capabilities
            ? `caps ${capabilities.pointsOfInterest.inCapabilities ? "yes" : "no"} · settings ${capabilities.pointsOfInterest.inSettings ? "yes" : "no"} · constraint ${capabilities.pointsOfInterest.inSupportedConstraints ? "yes" : "no"}`
            : "–"}
        </dd>
        <dt>Zoom</dt>
        <dd>
          {capabilities?.zoom === undefined
            ? "–"
            : JSON.stringify(capabilities.zoom)}
        </dd>
        <dt>Applied</dt>
        <dd>
          continuous{" "}
          {focusApplied.continuous
            ? focusApplied.continuous.applied
              ? "yes"
              : `no (${focusApplied.continuous.reason ?? "?"})`
            : "–"}
          {" · "}tap{" "}
          {focusApplied.lastTap
            ? focusApplied.lastTap.applied
              ? "yes"
              : `no (${focusApplied.lastTap.reason ?? "?"})`
            : "–"}
        </dd>
        <dt>Samples/s</dt>
        <dd>{fixed(live.samplesPerSecond, 1)}</dd>
        <dt>Detect ms</dt>
        <dd>
          avg {fixed(live.detectionMsAverage, 1)} · p95{" "}
          {fixed(live.detectionMsP95, 1)}
        </dd>
        <dt>Sharpness</dt>
        <dd>
          {fixed(live.laplacianVariance, 1)} (floor {live.laplacianFloor})
        </dd>
        <dt>Steady</dt>
        <dd>
          {live.steady === null ? "–" : live.steady ? "yes" : "no"} · moved{" "}
          {fixed(
            live.maxCornerMovementFractionOfDiagonal === null
              ? null
              : live.maxCornerMovementFractionOfDiagonal * 100,
            2,
          )}
          % of diagonal
        </dd>
        <dt>Corners</dt>
        <dd>{live.cornersSeen ?? "–"}</dd>
        <dt>Cue</dt>
        <dd>
          {live.cueCode ?? "–"} (shown {live.cueShown ?? "–"})
        </dd>
        <dt>Ring</dt>
        <dd>
          {fixed(live.ringFraction * 100, 0)}% · failures in a row{" "}
          {live.consecutiveFailures}
        </dd>
        <dt>Capture</dt>
        <dd>
          {capture.method ?? "–"}
          {capture.stillWidth
            ? ` · ${capture.stillWidth}×${capture.stillHeight} · ${fixed(capture.stillKb, 0)} KB`
            : ""}
        </dd>
        <dt>To frozen</dt>
        <dd>{fixed(capture.ringCompleteToFrozenMs, 0)} ms</dd>
        <dt>Attempts</dt>
        <dd data-testid="debug-attempts">
          {attempts.length === 0 ? (
            "none yet"
          ) : (
            <ol reversed className="easyDebugAttempts">
              {[...attempts].reverse().map((attempt, i) => (
                <li key={`${attempt.at}-${i}`}>{describeAttempt(attempt)}</li>
              ))}
            </ol>
          )}
        </dd>
      </dl>
      <button
        type="button"
        className="easyDebugCopy"
        onClick={() => void copy()}
      >
        Copy JSON
      </button>
      {copyState === "copied" && (
        <span role="status" className="easyDebugState">
          Copied
        </span>
      )}
      {copyState === "manual" && (
        <textarea
          className="easyDebugJson"
          readOnly
          rows={8}
          value={json}
          aria-label="Debug JSON"
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
    </aside>
  );
}
