"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import type {
  HandMeasurements,
  ScanSubmission,
} from "@/lib/contracts/measurement";
import { scanSubmissionSchema, LANDMARK } from "@/lib/contracts/measurement";
import type { Point2 } from "@/client/geometry/homography";
import type { CardCorners } from "@/client/geometry/card-scale";
import {
  runPhotoPipeline,
  type PhotoOverlay,
  type PipelineIssue,
  type RunPhotoPipelineInput,
  type PipelineResult,
} from "@/client/photo/pipeline";
import {
  getHandLandmarker,
  HandLandmarkerLoadError,
} from "@/client/photo/landmarks";
import ScanSubmitPanel from "./ScanSubmitPanel";
import { TopBar } from "@/components/nav/TopBar";
import CameraCapture from "@/client/camera/CameraCapture";

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
      /** Whether the card corners came from automatic detection or a
       * manual drag-to-correct (issue: the completion card's "all four
       * markers... found" line was claiming auto-detection happened even
       * when the user had just placed the corners by hand). */
      cardSource: "auto" | "manual";
    }
  | {
      kind: "error";
      errors: readonly PipelineIssue[];
      overlay: PhotoOverlay | null;
      retryable?: boolean;
    };

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

/** The four MCP (knuckle) joints — the first landmark of each non-thumb
 * finger's chain — emphasised in the measured-state overlay per Kirby's
 * request to draw the measured result over the photo. */
const KNUCKLE_LANDMARK_IDS: readonly number[] = [
  LANDMARK.index[0],
  LANDMARK.middle[0],
  LANDMARK.ring[0],
  LANDMARK.pinky[0],
];

/**
 * A labelled measurement line for the "ok" state's photo overlay — plain
 * geometry only (the two endpoints and the value are already computed by
 * runPhotoPipeline/computeHandMeasurements; this just draws a line between
 * them and a legible label near its midpoint, never its own math).
 */
function MeasurementLine({
  a,
  b,
  label,
  imageWidth,
}: {
  a: Point2;
  b: Point2;
  label: string;
  imageWidth: number;
}) {
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  const fontSize = Math.max(14, imageWidth * 0.018);
  const paddingX = fontSize * 0.6;
  const labelWidth = label.length * fontSize * 0.56 + paddingX * 2;
  const labelHeight = fontSize * 1.8;
  return (
    <>
      <line
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        className="overlayMeasureLine"
      />
      <g transform={`translate(${midX} ${midY})`}>
        <rect
          x={-labelWidth / 2}
          y={-labelHeight / 2}
          width={labelWidth}
          height={labelHeight}
          rx={labelHeight / 2}
          className="overlayMeasureLabelBg"
        />
        <text
          x={0}
          y={fontSize * 0.32}
          textAnchor="middle"
          fontSize={fontSize}
          className="overlayMeasureLabelText"
        >
          {label}
        </text>
      </g>
    </>
  );
}

/** A plain circled checkmark for the "Hand measured" completion state —
 * decorative only, the text next to it already says what it means. */
function CheckIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      className="checkIcon"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="10"
        cy="10"
        r="8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M6 10.2l2.6 2.6L14 7.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Seeds the "ok" (measured) state directly, bypassing the photo pipeline —
 * for `/scan/measured-demo` only. No synthetic e2e photo gets MediaPipe to
 * detect a hand (see tests/e2e/scan.spec.ts's own comment on this), so this
 * is the only deterministic way to reach and screenshot the measured layout
 * in CI. Mirrors how `/scan/submit-demo` exercises `ScanSubmitPanel`.
 */
export interface ScanDemoMeasuredState {
  readonly hand: Hand;
  readonly gripStyle?: GripStyle;
  readonly measurements: HandMeasurements;
  readonly submission: ScanSubmission;
}

const EMPTY_OVERLAY: PhotoOverlay = {
  imageWidth: 1,
  imageHeight: 1,
  markers: [],
  card: null,
  landmarksPx: null,
};

export default function ScanClient({
  demoMeasured,
  demoLabel,
  runPhotoPipelineImpl = runPhotoPipeline,
}: {
  demoMeasured?: ScanDemoMeasuredState;
  /** Visible "this is fixture data" banner for `/scan/measured-demo` —
   * mirrors `/scan/submit-demo`'s own "(mock data)" heading, which that
   * route can say for itself since it doesn't render this component's own
   * `<h1>`. */
  demoLabel?: string;
  /** Test-only injection point (defaults to the real pipeline). No
   * synthetic e2e photo makes MediaPipe detect a hand, so this is the only
   * way to reach "ok" with a *controllable* delay — needed to reliably
   * exercise the grip-change-during-processing race from
   * `/scan/grip-race-demo`. Real pages never pass this. */
  runPhotoPipelineImpl?: (
    input: RunPhotoPipelineInput,
  ) => Promise<PipelineResult>;
} = {}) {
  const [hand, setHand] = useState<Hand>(demoMeasured?.hand ?? "right");
  const [gripStyle, setGripStyle] = useState<GripStyle | undefined>(
    demoMeasured?.gripStyle,
  );
  const [state, setState] = useState<ScanState>(
    demoMeasured
      ? {
          kind: "ok",
          measurements: demoMeasured.measurements,
          submission: demoMeasured.submission,
          warnings: [],
          overlay: EMPTY_OVERLAY,
          cardSource: "auto",
        }
      : { kind: "idle" },
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [manualCorners, setManualCorners] = useState<CardCorners | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  // Defaults false on both the server render and the client's first render
  // (no hydration mismatch), then flips true after mount if this device can
  // actually open the camera — per docs/design/camera-capture-2026-09-25/
  // README.md: "No rear camera / getUserMedia missing / insecure context →
  // go straight to the upload path, no error styling", i.e. the camera
  // button simply never appears rather than appearing and failing.
  const [cameraAvailable, setCameraAvailable] = useState(false);
  useEffect(() => {
    setCameraAvailable(
      typeof window !== "undefined" &&
        window.isSecureContext &&
        typeof navigator.mediaDevices?.getUserMedia === "function",
    );
  }, []);
  const fileRef = useRef<File | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const runIdRef = useRef(0);
  // The single source of truth for "what grip is currently shown" — a
  // pipeline run started before the user switched grip captures the OLD
  // value as `runPipeline`'s `selectedGrip` default parameter (evaluated
  // once, at call time) and can still be in flight when it resolves to
  // "ok". Reading this ref at resolution time (rather than trusting
  // whatever the in-flight call captured) means the "ok" submission
  // always matches the grip button the user is actually looking at,
  // regardless of when they tapped it relative to the pipeline finishing.
  const latestGripRef = useRef<GripStyle | undefined>(demoMeasured?.gripStyle);

  // Warm the MediaPipe HandLandmarker (fetches its model + WASM) as soon as
  // the page mounts, so those same-origin asset loads happen well before
  // any photo is processed — see tests/e2e/scan.spec.ts's zero-network
  // assertion, which only starts recording after the page has settled.
  useEffect(() => {
    void getHandLandmarker().catch(() => {
      // A chosen photo owns the visible recovery state.
    });
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Grip never reaches a gate or the measurement math (see
  // src/client/photo/submission.ts) — it only ends up in the submission
  // object — so no matter which `gripStyleStated` a given pipeline run was
  // started with, the submission it produces is rebuilt here using
  // whatever grip is *currently* shown, not whatever was current when that
  // run began.
  const applyLatestGrip = useCallback(
    (submission: ScanSubmission): ScanSubmission => {
      const grip = latestGripRef.current;
      return scanSubmissionSchema.parse({
        hand: submission.hand,
        measurements: submission.measurements,
        calibration: submission.calibration,
        measurementModelVersion: submission.measurementModelVersion,
        ...(grip !== undefined ? { gripStyleStated: grip } : {}),
      });
    },
    [],
  );

  const runPipeline = useCallback(
    async (
      file: File,
      corners: CardCorners | undefined,
      selectedHand = hand,
      selectedGrip = gripStyle,
    ) => {
      const runId = ++runIdRef.current;
      const cardSource: "auto" | "manual" = corners ? "manual" : "auto";
      setState({ kind: "processing" });
      try {
        const result = await runPhotoPipelineImpl({
          file,
          hand: selectedHand,
          gripStyleStated: selectedGrip,
          manualCardCorners: corners,
        });
        if (runId !== runIdRef.current) return;
        if (result.status === "ok") {
          setState({
            kind: "ok",
            measurements: result.measurements,
            submission: applyLatestGrip(result.submission),
            warnings: result.warnings,
            overlay: result.overlay,
            cardSource,
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
      } catch (err) {
        if (runId !== runIdRef.current) return;
        // Only a genuine HandLandmarker load failure gets to say so —
        // anything else escaping the pipeline (a bug, an unexpected
        // Canvas/DOM error) gets a message that doesn't claim a specific
        // cause it doesn't know is true.
        const isLoadFailure = err instanceof HandLandmarkerLoadError;
        setState({
          kind: "error",
          errors: [
            {
              code: isLoadFailure
                ? "detector_load_failed"
                : "processing_failed",
              message: isLoadFailure
                ? "We couldn't load the hand detector. Check your connection and try again."
                : "Something went wrong while processing that photo. Try again.",
            } as PipelineIssue,
          ],
          overlay: null,
          retryable: true,
        });
      }
    },
    [hand, gripStyle, applyLatestGrip, runPhotoPipelineImpl],
  );

  const onFileChosen = useCallback(
    (file: File) => {
      fileRef.current = file;
      ++runIdRef.current;
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

  const retryPhoto = useCallback(() => {
    if (fileRef.current)
      void runPipeline(fileRef.current, manualCorners ?? undefined);
  }, [manualCorners, runPipeline]);

  const changeHand = useCallback(
    (next: Hand) => {
      setHand(next);
      // Unlike grip, the stated hand feeds a real gate (checkHandedness
      // against MediaPipe's own detected handedness) — a change here can
      // flip the result from "ok" to an error, so it re-runs detection on
      // the photo still in memory rather than only patching the
      // submission.
      if (fileRef.current) {
        void runPipeline(fileRef.current, manualCorners ?? undefined, next);
        return;
      }
      // No photo in memory: only possible on /scan/measured-demo (a real
      // flow always has fileRef.current set once "ok" is reached). Without
      // this, the hand picker there would show the new hand while the
      // submission silently kept the old one.
      setState((prev) => {
        if (prev.kind !== "ok") return prev;
        const submission = scanSubmissionSchema.parse({
          hand: next,
          measurements: prev.submission.measurements,
          calibration: prev.submission.calibration,
          measurementModelVersion: prev.submission.measurementModelVersion,
        });
        return { ...prev, submission: applyLatestGrip(submission) };
      });
    },
    [manualCorners, runPipeline, applyLatestGrip],
  );

  const changeGrip = useCallback(
    (next: GripStyle | undefined) => {
      latestGripRef.current = next;
      setGripStyle(next);
      setState((prev) => {
        if (prev.kind !== "ok") return prev;
        // Grip style never reaches a gate or the measurement math (see
        // src/client/photo/submission.ts) — it only ends up in the
        // submission object, so changing it after "ok" just rebuilds that
        // one object instead of re-running detection on the photo. (If a
        // pipeline run is still in flight from *before* this click, its
        // eventual "ok" result goes through `applyLatestGrip` too, so it
        // can't clobber this with a stale grip.)
        return { ...prev, submission: applyLatestGrip(prev.submission) };
      });
    },
    [applyLatestGrip],
  );

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
      {demoLabel && <p className="demoLabel">{demoLabel}</p>}
      <TopBar
        backHref="/sheet"
        backLabel="Sheet"
        stepLabel="Step 2 of 2 · Photo"
      />

      <h1>Photograph your hand on the sheet</h1>
      <p className="hint">
        Lay your hand flat on the sheet next to a bank card, fingers together,
        and photograph both from directly above.
      </p>

      {/* Always interactive, including once measured (item 2 fix): grip
          never needs a re-measure, and changing hand re-runs detection on
          the photo still in memory rather than losing it. */}
      <fieldset className="picker">
        <legend>Which hand?</legend>
        <div className="pickerButtons" role="group" aria-label="Which hand">
          {(["left", "right"] as const).map((h) => (
            <button
              key={h}
              type="button"
              className={`pickerButton${hand === h ? " selected" : ""}`}
              aria-pressed={hand === h}
              onClick={() => changeHand(h)}
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
              onClick={() => changeGrip(gripStyle === g ? undefined : g)}
            >
              {g[0].toUpperCase() + g.slice(1)}
            </button>
          ))}
        </div>
      </fieldset>

      {/* The choose/replace-photo control only exists before "ok" — once
          measured it reappears further down, after the primary action, in
          its own DOM position (no CSS `order` — item 4). Camera-capable
          devices get "Open camera" as the primary action here; devices
          without a usable camera (no getUserMedia, or an insecure context)
          fall straight back to today's plain upload button, unchanged, per
          docs/design/camera-capture-2026-09-25/README.md. */}
      {state.kind !== "ok" && !cameraOpen && (
        <div className="uploadSlot">
          {cameraAvailable && (
            <button
              type="button"
              className="primaryButton"
              style={{ width: "100%", marginBottom: "0.75rem" }}
              onClick={() => setCameraOpen(true)}
            >
              Open camera
            </button>
          )}
          <label className="uploadButton" htmlFor="top-down-photo">
            {cameraAvailable
              ? "Upload a photo instead"
              : previewUrl
                ? "Replace photo"
                : "Choose photo"}
          </label>
          <input
            id="top-down-photo"
            type="file"
            accept="image/*"
            {...(!cameraAvailable ? { capture: "environment" } : {})}
            onChange={onInputChange}
            className="visuallyHidden"
          />
          <p className="deviceNotice">
            Processed on this device — the photo is never uploaded.
          </p>
        </div>
      )}

      {cameraOpen && (
        <CameraCapture
          hand={hand}
          onExit={() => setCameraOpen(false)}
          onUsePhoto={(file) => {
            setCameraOpen(false);
            onFileChosen(file);
          }}
        />
      )}

      <div
        aria-live="polite"
        className={`statusBanner status-${state.kind}`}
        data-testid="scan-status"
      >
        {statusText}
      </div>

      {overlay && (
        <p className="visuallyHidden" data-testid="photo-dimensions">
          {overlay.imageWidth}x{overlay.imageHeight}
        </p>
      )}

      {previewUrl && state.kind !== "ok" && (
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
          {state.retryable && (
            <button
              type="button"
              className="primaryButton"
              onClick={retryPhoto}
            >
              Try again
            </button>
          )}
        </div>
      )}

      {state.kind === "ok" && (
        <>
          {previewUrl && state.overlay.landmarksPx && (
            <div
              className="photoStage"
              style={{
                aspectRatio: `${state.overlay.imageWidth} / ${state.overlay.imageHeight}`,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URL, not an optimizable remote asset */}
              <img src={previewUrl} alt="" className="photoImg" />
              <svg
                viewBox={`0 0 ${state.overlay.imageWidth} ${state.overlay.imageHeight}`}
                className="photoOverlaySvg"
                role="img"
                aria-label="Your measured hand: the sheet markers, card and hand landmarks, with hand length and palm width labelled"
              >
                {state.overlay.markers.map((m) => (
                  <polygon
                    key={m.id}
                    points={cornersToPoints(m.corners)}
                    className="overlayMarker"
                  />
                ))}
                {state.overlay.card && (
                  <polygon
                    points={cornersToPoints(state.overlay.card)}
                    className="overlayCard"
                  />
                )}
                {state.overlay.landmarksPx.map((p, i) => (
                  <circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={
                      KNUCKLE_LANDMARK_IDS.includes(i)
                        ? Math.max(7, state.overlay.imageWidth * 0.007)
                        : Math.max(4, state.overlay.imageWidth * 0.004)
                    }
                    className={
                      KNUCKLE_LANDMARK_IDS.includes(i)
                        ? "overlayKnuckle"
                        : "overlayLandmark"
                    }
                  />
                ))}
                <MeasurementLine
                  a={state.overlay.landmarksPx[0]}
                  b={state.overlay.landmarksPx[LANDMARK.middle[3]]}
                  label={`Hand length ${state.measurements.handLengthMm.toFixed(1)} mm`}
                  imageWidth={state.overlay.imageWidth}
                />
                <MeasurementLine
                  a={state.overlay.landmarksPx[LANDMARK.index[0]]}
                  b={state.overlay.landmarksPx[LANDMARK.pinky[0]]}
                  label={`Palm width ${state.measurements.palmWidthMm.toFixed(1)} mm`}
                  imageWidth={state.overlay.imageWidth}
                />
              </svg>
            </div>
          )}

          <div className="feedback feedback-ok">
            <p className="feedbackTitle">
              <CheckIcon /> Hand measured
            </p>
            {state.warnings.length > 0 && (
              <div className="feedback feedback-warning">
                {state.warnings.map((w, i) => (
                  <p key={i}>{w.message}</p>
                ))}
              </div>
            )}
            {/* Raw JSON, for scripts/m2-gate-replay.ts to parse exact values
                from — the visible dl below is for people, formatted/rounded. */}
            <p hidden data-testid="scan-measurements-json">
              {JSON.stringify(state.measurements)}
            </p>
            <dl className="measurements" data-testid="scan-measurements">
              {Object.entries(state.measurements).map(([key, value]) => (
                <div className="measurementRow" key={key}>
                  <dt>{MEASUREMENT_LABELS[key as keyof HandMeasurements]}</dt>
                  <dd className="tabularNum">
                    {typeof value === "number"
                      ? value.toFixed(1)
                      : String(value)}
                    {key.endsWith("Deg") ? "°" : " mm"}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="feedbackCaption">
              {state.cardSource === "auto"
                ? "All four sheet markers and the card were found, so the scale is checked."
                : "All four sheet markers were found; the card corners you placed set the scale."}
            </p>
          </div>

          <ScanSubmitPanel submission={state.submission} />

          <div className="uploadSlot uploadSlot-measured">
            <label className="uploadButton" htmlFor="top-down-photo">
              Use a different photo
            </label>
            <input
              id="top-down-photo"
              type="file"
              accept="image/*"
              onChange={onInputChange}
              className="visuallyHidden"
            />
            <p className="deviceNotice">
              Processed on this device — only measurements are sent, never the
              photo.
            </p>
          </div>
        </>
      )}

      <Link href="/sheet" className="scanSheetLink">
        Don&apos;t have the sheet? Print it
      </Link>
    </main>
  );
}
