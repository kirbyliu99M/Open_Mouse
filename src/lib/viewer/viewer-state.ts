/**
 * The viewer region's state machine.
 *
 *   idle -> loading -> ready
 *                   -> failed        (a download, decode or measurements error)
 *                   -> unsupported   (no WebGL, or the mouse has no shell)
 *   ready -> failed                  (the GL context was lost for good)
 *
 * `idle` waits for the region to scroll near the viewport; nothing is
 * downloaded before that. `failed` and `unsupported` look the same to the
 * person (one calm line, never a raw error) and differ only so tests and the
 * page can tell why. Pure: the component owns the effects.
 */

export type ViewerStatus =
  "idle" | "loading" | "ready" | "failed" | "unsupported";

export type ViewerEvent =
  | { type: "near" }
  | { type: "loaded" }
  | { type: "failed" }
  | { type: "unsupported" };

/** The state a region starts in: a mouse with no shell is `unsupported` from the first paint. */
export function initialViewerStatus(hasShell: boolean): ViewerStatus {
  return hasShell ? "idle" : "unsupported";
}

export function viewerReducer(
  status: ViewerStatus,
  event: ViewerEvent,
): ViewerStatus {
  switch (status) {
    case "idle":
      return event.type === "near" ? "loading" : status;
    case "loading":
      if (event.type === "loaded") return "ready";
      if (event.type === "failed") return "failed";
      if (event.type === "unsupported") return "unsupported";
      return status;
    case "ready":
      return event.type === "failed" ? "failed" : status;
    case "failed":
    case "unsupported":
      return status;
  }
}

/** True once the person is looking at a fallback line instead of a model. */
export function isFallback(status: ViewerStatus): boolean {
  return status === "failed" || status === "unsupported";
}
