"use client";

import { useEffect, useId, useReducer, useRef } from "react";
import shellIndex from "@/lib/viewer/shell-index.generated.json";
import { shellUrl } from "@/lib/viewer/shells";
import {
  initialViewerStatus,
  isFallback,
  viewerReducer,
} from "@/lib/viewer/viewer-state";
import { VIEWER_CAPTION, VIEWER_FALLBACK, viewerLabel } from "./copy";
import "./viewer.css";

/** How far outside the viewport the region may be when the download starts. */
const NEAR_MARGIN = "300px 0px";

/**
 * The 3D size illustration's region on the results page: a box of reserved
 * size, a caption, and, once the region is near the viewport, the viewer
 * itself.
 *
 * Everything heavy is loaded from here and only when it is wanted. `three`,
 * its loaders, the model files, the Draco decoder and the measurements request
 * all wait for the box to scroll within `NEAR_MARGIN` of the viewport, and the
 * code arrives as one dynamic chunk (`./mouse-viewer`), so no other route's
 * bundle carries any of it. A mouse with no shell (`shellUrl` is null) never
 * downloads anything.
 *
 * The box has a fixed size in every state, and the caption keeps its space
 * when it is hidden, so nothing below moves when a state changes. A failure of
 * any kind (no WebGL, a missing or undecodable model, the measurements not
 * found) ends in the one calm line, never a raw error, and the rest of the
 * page is unaffected.
 */
export function ViewerRegion({
  scanId,
  mouseSlug,
  mouseName,
}: {
  scanId: string;
  mouseSlug: string;
  mouseName: string;
}) {
  const url = shellUrl(mouseSlug, shellIndex);
  const [status, dispatch] = useReducer(
    viewerReducer,
    url !== null,
    initialViewerStatus,
  );
  const boxRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const captionId = useId();

  // idle -> loading: when the box is near the viewport.
  useEffect(() => {
    if (status !== "idle") return;
    const box = boxRef.current;
    if (!box) return;
    if (typeof IntersectionObserver === "undefined") {
      dispatch({ type: "near" });
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          dispatch({ type: "near" });
        }
      },
      { rootMargin: NEAR_MARGIN },
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, [status]);

  // loading -> ready | failed | unsupported: the viewer module reports back.
  // `running` stays true across loading -> ready, so the viewer is neither
  // restarted nor disposed by that change; leaving it (a failure, or the page
  // unmounting) disposes everything.
  const running = status === "loading" || status === "ready";
  useEffect(() => {
    if (!running || url === null) return;
    const box = boxRef.current;
    const host = hostRef.current;
    if (!box || !host) return;
    let disposed = false;
    let handle: { dispose: () => void } | null = null;
    import("./mouse-viewer").then(
      ({ startViewer }) => {
        if (disposed) return;
        handle = startViewer({
          box,
          host,
          scanId,
          shellUrl: url,
          onReady: () => dispatch({ type: "loaded" }),
          onFailed: () => dispatch({ type: "failed" }),
          onUnsupported: () => dispatch({ type: "unsupported" }),
        });
      },
      () => {
        if (!disposed) dispatch({ type: "failed" });
      },
    );
    return () => {
      disposed = true;
      handle?.dispose();
    };
  }, [running, url, scanId]);

  const interactive = status === "ready";
  return (
    <div className="viewer" data-viewer-state={status}>
      <div
        ref={boxRef}
        className="viewer-box"
        aria-busy={status === "loading" ? true : undefined}
        {...(interactive
          ? {
              role: "group",
              tabIndex: 0,
              "aria-label": viewerLabel(mouseName),
              "aria-describedby": captionId,
              "aria-keyshortcuts": "ArrowLeft ArrowRight ArrowUp ArrowDown",
            }
          : {})}
      >
        <div ref={hostRef} className="viewer-host" />
        {isFallback(status) && (
          <p className="viewer-fallback">{VIEWER_FALLBACK}</p>
        )}
      </div>
      {url !== null && (
        <p id={captionId} className="viewer-caption">
          {VIEWER_CAPTION}
        </p>
      )}
    </div>
  );
}
