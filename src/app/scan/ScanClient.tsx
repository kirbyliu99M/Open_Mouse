"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import type {
  HandMeasurements,
  ScanSubmission,
} from "@/lib/contracts/measurement";
import type { Point2 } from "@/client/geometry/homography";
import type { CardCorners } from "@/client/geometry/card-scale";
import {
  runPhotoPipeline,
  type PhotoOverlay,
  type PipelineIssue,
} from "@/client/photo/pipeline";
import { getHandLandmarker } from "@/client/photo/landmarks";

type Hand = "left" | "right";
type GripStyle = "palm" | "claw" | "fingertip";

type ScanState =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "processing" }
  | { kind: "needsManualCard"; overlay: PhotoOverlay }
  | {
      kind: "ok";
      measurements: HandMeasurements;
      submission: ScanSubmission;
      warnings: readonly PipelineIssue[];
      overlay: PhotoOverlay;
    }
  | { kind: "error"; errors: readonly PipelineIssue[]; overlay: PhotoOverlay };

const MEASUREMENT_LABELS: Record<keyof HandMeasurements, string> = {
  handLengthMm: "Hand length",
  palmLengthMm: "Palm length",
  palmWidthMm: "Palm width",
  thumbLengthMm: "Thumb length",
  indexLengthMm: "Index finger length",
  middleLengthMm: "Middle finger length",
  ringLengthMm: "Ring finger length",
  pinkyLengthMm: "Pinky length",
  palmThicknessMm: "Palm thickness",
  knuckleHeightMm: "Knuckle height",
  gripApertureMm: "Grip aperture",
  thumbAngleDeg: "Thumb angle",
};

function defaultManualCorners(overlay: PhotoOverlay): CardCorners {
  const w = overlay.imageWidth;
  const h = overlay.imageHeight;
  const cardW = w * 0.28;
  const cardH = cardW * (53.98 / 85.6);
  const cx = w / 2;
  const cy = h * 0.7;
  return [
    { x: cx - cardW / 2, y: cy - cardH / 2 },
    { x: cx + cardW / 2, y: cy - cardH / 2 },
    { x: cx + cardW / 2, y: cy + cardH / 2 },
    { x: cx - cardW / 2, y: cy + cardH / 2 },
  ];
}

function toSvgPoint(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): Point2 {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const transformed = pt.matrixTransform(ctm.inverse());
  return { x: transformed.x, y: transformed.y };
}

function cornersToPoints(corners: readonly Point2[]): string {
  return corners.map((p) => `${p.x},${p.y}`).join(" ");
}

export default function ScanClient() {
  const [hand, setHand] = useState<Hand>("right");
  const [gripStyle, setGripStyle] = useState<GripStyle | undefined>(undefined);
  const [state, setState] = useState<ScanState>({ kind: "idle" });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [manualCorners, setManualCorners] = useState<CardCorners | null>(null);
  const fileRef = useRef<File | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragIndexRef = useRef<number | null>(null);

  // Warm the MediaPipe HandLandmarker (fetches its model + WASM) as soon as
  // the page mounts, so those same-origin asset loads happen well before
  // any photo is processed — see tests/e2e/scan.spec.ts's zero-network
  // assertion, which only starts recording after the page has settled.
  useEffect(() => {
    void getHandLandmarker();
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const runPipeline = useCallback(
    async (file: File, corners: CardCorners | undefined) => {
      setState({ kind: "processing" });
      const result = await runPhotoPipeline({
        file,
        hand,
        gripStyleStated: gripStyle,
        manualCardCorners: corners,
      });
      if (result.status === "ok") {
        setState({
          kind: "ok",
          measurements: result.measurements,
          submission: result.submission,
          warnings: result.warnings,
          overlay: result.overlay,
        });
      } else if (result.status === "needsManualCard") {
        setManualCorners(defaultManualCorners(result.overlay));
        setState({ kind: "needsManualCard", overlay: result.overlay });
      } else {
        setState({
          kind: "error",
          errors: result.errors,
          overlay: result.overlay,
        });
      }
    },
    [hand, gripStyle],
  );

  const onFileChosen = useCallback(
    (file: File) => {
      fileRef.current = file;
      setManualCorners(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(file));
      setState({ kind: "reading" });
      // Yield one tick so "Reading photo…" actually paints before the
      // (synchronous, CPU-bound) detection work below begins.
      window.setTimeout(() => {
        void runPipeline(file, undefined);
      }, 0);
    },
    [previewUrl, runPipeline],
  );

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onFileChosen(file);
      e.target.value = "";
    },
    [onFileChosen],
  );

  const onConfirmManualCard = useCallback(() => {
    const file = fileRef.current;
    if (!file || !manualCorners) return;
    void runPipeline(file, manualCorners);
  }, [manualCorners, runPipeline]);

  const beginDrag = useCallback(
    (index: number) => (e: ReactPointerEvent<SVGCircleElement>) => {
      dragIndexRef.current = index;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [],
  );

  const onDragMove = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
    const index = dragIndexRef.current;
    if (index === null || !svgRef.current) return;
    const p = toSvgPoint(svgRef.current, e.clientX, e.clientY);
    setManualCorners((prev) => {
      if (!prev) return prev;
      const next = [...prev] as [Point2, Point2, Point2, Point2];
      next[index] = p;
      return next;
    });
  }, []);

  const endDrag = useCallback(() => {
    dragIndexRef.current = null;
  }, []);

  const nudgeCorner = useCallback(
    (index: number) => (e: React.KeyboardEvent<SVGCircleElement>) => {
      const step = e.shiftKey ? 10 : 2;
      let dx = 0;
      let dy = 0;
      if (e.key === "ArrowLeft") dx = -step;
      else if (e.key === "ArrowRight") dx = step;
      else if (e.key === "ArrowUp") dy = -step;
      else if (e.key === "ArrowDown") dy = step;
      else return;
      e.preventDefault();
      setManualCorners((prev) => {
        if (!prev) return prev;
        const next = [...prev] as [Point2, Point2, Point2, Point2];
        next[index] = { x: next[index].x + dx, y: next[index].y + dy };
        return next;
      });
    },
    [],
  );

  const overlay =
    state.kind === "ok" ||
    state.kind === "error" ||
    state.kind === "needsManualCard"
      ? state.overlay
      : null;

  const statusText =
    state.kind === "reading"
      ? "Reading photo…"
      : state.kind === "processing"
        ? "Looking for the sheet markers and your hand…"
        : state.kind === "needsManualCard"
          ? "We couldn't find the card automatically — drag its four corners to match your card."
          : state.kind === "ok"
            ? "Measured."
            : state.kind === "error"
              ? state.errors[0]?.message
              : "";

  return (
    <main className="scanMain">
      <nav className="wayfinding" aria-label="Scan progress">
        <Link href="/" className="wayOut">
          ‹ Home
        </Link>
        <p className="stepLabel">Step 1 of 3 · Top-down photo</p>
      </nav>

      <h1>Photograph your hand on the sheet</h1>
      <p className="hint">
        Lay your hand flat on the sheet next to a bank card, fingers together,
        and photograph both from directly above. Side and grip photos come
        later.
      </p>

      <fieldset className="picker">
        <legend>Which hand?</legend>
        <div className="pickerButtons" role="group" aria-label="Which hand">
          {(["left", "right"] as const).map((h) => (
            <button
              key={h}
              type="button"
              className={`pickerButton${hand === h ? " selected" : ""}`}
              aria-pressed={hand === h}
              onClick={() => setHand(h)}
            >
              {h === "left" ? "Left hand" : "Right hand"}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="picker">
        <legend>Grip style (optional)</legend>
        <div
          className="pickerButtons"
          role="group"
          aria-label="Grip style, optional"
        >
          {(["palm", "claw", "fingertip"] as const).map((g) => (
            <button
              key={g}
              type="button"
              className={`pickerButton${gripStyle === g ? " selected" : ""}`}
              aria-pressed={gripStyle === g}
              onClick={() =>
                setGripStyle((prev) => (prev === g ? undefined : g))
              }
            >
              {g[0].toUpperCase() + g.slice(1)}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="uploadSlot">
        <label className="uploadButton" htmlFor="top-down-photo">
          {previewUrl ? "Replace photo" : "Choose photo"}
        </label>
        <input
          id="top-down-photo"
          type="file"
          accept="image/*"
          onChange={onInputChange}
          className="visuallyHidden"
        />
        <p className="deviceNotice">
          Processed on this device — the photo is never uploaded.
        </p>
      </div>

      <div
        aria-live="polite"
        className={`statusBanner status-${state.kind}`}
        data-testid="scan-status"
      >
        {statusText}
      </div>

      {previewUrl && (
        <div
          className="photoStage"
          style={
            overlay
              ? {
                  aspectRatio: `${overlay.imageWidth} / ${overlay.imageHeight}`,
                }
              : undefined
          }
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- local object URL, not an optimizable remote asset */}
          <img src={previewUrl} alt="" className="photoImg" />
          {overlay && (
            <svg
              ref={svgRef}
              viewBox={`0 0 ${overlay.imageWidth} ${overlay.imageHeight}`}
              className="photoOverlaySvg"
              onPointerMove={onDragMove}
              onPointerUp={endDrag}
              role="img"
              aria-label="Detected markers, card and hand landmarks overlaid on your photo"
            >
              {overlay.markers.map((m) => (
                <polygon
                  key={m.id}
                  points={cornersToPoints(m.corners)}
                  className="overlayMarker"
                />
              ))}
              {overlay.card && (
                <polygon
                  points={cornersToPoints(overlay.card)}
                  className="overlayCard"
                />
              )}
              {overlay.landmarksPx?.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={Math.max(4, overlay.imageWidth * 0.004)}
                  className="overlayLandmark"
                />
              ))}
              {state.kind === "needsManualCard" &&
                manualCorners?.map((p, i) => (
                  <circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={Math.max(10, overlay.imageWidth * 0.012)}
                    tabIndex={0}
                    role="slider"
                    aria-label={`Card corner ${i + 1}. Use arrow keys to adjust.`}
                    aria-valuetext={`x ${Math.round(p.x)}, y ${Math.round(p.y)}`}
                    className="overlayHandle"
                    onPointerDown={beginDrag(i)}
                    onKeyDown={nudgeCorner(i)}
                  />
                ))}
            </svg>
          )}
        </div>
      )}

      {state.kind === "needsManualCard" && (
        <button
          type="button"
          className="primaryButton"
          onClick={onConfirmManualCard}
        >
          Use these corners
        </button>
      )}

      {state.kind === "error" && (
        <div className="feedback feedback-error" role="alert">
          <p className="feedbackTitle">Retake needed</p>
          <ul>
            {state.errors.map((err, i) => (
              <li key={i}>{err.message}</li>
            ))}
          </ul>
        </div>
      )}

      {state.kind === "ok" && (
        <div className="feedback feedback-ok">
          <p className="feedbackTitle">✓ Measured</p>
          {state.warnings.length > 0 && (
            <div className="feedback feedback-warning">
              {state.warnings.map((w, i) => (
                <p key={i}>{w.message}</p>
              ))}
            </div>
          )}
          <dl className="measurements" data-testid="scan-measurements">
            {Object.entries(state.measurements).map(([key, value]) => (
              <div className="measurementRow" key={key}>
                <dt>{MEASUREMENT_LABELS[key as keyof HandMeasurements]}</dt>
                <dd className="tabularNum">
                  {typeof value === "number" ? value.toFixed(1) : String(value)}
                  {key.endsWith("Deg") ? "°" : " mm"}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </main>
  );
}
