"use client";

/**
 * The easy-scan camera (docs/design/easy-scan-shell-2026-09-25/README.md,
 * screens 14-16): "Scan my hand" on the main page lands here directly — no
 * setup page, no separate review page. The camera opens immediately; hand
 * is inferred (a small, tappable chip, default right); paper size is a
 * toggle on the viewfinder remembered in `localStorage`; a first-run tip
 * bottom sheet replaces the old primer, shown once; capture runs the same
 * paper-edge pipeline `/scan/paper-edge-preview` uses and slides a bottom
 * sheet up over the frozen photo with the result — measured (dimension
 * lines + optional grip + "See my matches") or a gate failure (its one fix
 * + "Try again", which goes back to the live camera for a new photo).
 *
 * Reuses the same pure live-loop building blocks as CameraCapture.tsx
 * (constants/cues/quad/quad-source/light/steadiness/autoCapture) — this
 * file is its own component rather than a CameraCapture mode because the
 * chrome around the loop (no primer, no review page, the hand chip, the
 * bottom sheets) differs enough that sharing one state machine would make
 * both harder to read. `calibrationMode` is always "paper-edge" here — the
 * printed-sheet flow stays exactly as shipped at `/scan`.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import type {
  PaperSize,
  ScanSubmission,
} from "../../lib/contracts/measurement";
import {
  LANDMARK,
  scanSubmissionSchema,
} from "../../lib/contracts/measurement";
import { computeDownscaleSize } from "../photo/decode";
import { rgbaToGrayscale, computeLaplacianVariance } from "../photo/sharpness";
import { getHandLandmarker } from "../photo/landmarks";
import {
  runPhotoPipeline,
  type PhotoOverlay,
  type PipelineIssue,
  type RunPhotoPipelineInput,
  type PipelineResult,
} from "../photo/pipeline";
import type { HandMeasurements } from "../../lib/contracts/measurement";
import { CAMERA_CONSTANTS, PAPER_SIZE_LABELS } from "./constants";
import { pickCue, type Cue } from "./cues";
import { PHOTO_PRIVACY_COPY } from "@/components/privacy-copy";
import { requestCameraStream } from "./requestStream";
import {
  computeCoverRect,
  mapMediaPointToContainer,
  type Point,
  type Quad,
} from "./quad";
import { computeMeanLuma, computeClippedFraction } from "./light";
import { isSteady } from "./steadiness";
import {
  INITIAL_AUTO_CAPTURE_STATE,
  advanceAutoCapture,
  autoCaptureRingFraction,
  resetAutoCapture,
  type AutoCaptureState,
} from "./autoCapture";
import { createPaperEdgeQuadSource, type SheetQuadSource } from "./quad-source";
import {
  INITIAL_HAND_CHIP_STATE,
  applyDetectedHandedness,
  canToggleHandChip,
  handChipLabel,
  toggleHandChip,
  type HandChipState,
} from "./handInference";
import {
  getBrowserStorage,
  readStoredPaperSize,
  writeStoredPaperSize,
  readFirstRunTipSeen,
  markFirstRunTipSeen,
} from "./easyScanPreferences";
import {
  computeDimensionLine,
  separateLabelBoxes,
  type Box,
} from "../geometry/handSilhouette";
import ScanSubmitPanel from "../../app/scan/ScanSubmitPanel";
import { HandIcon, CheckIcon, HelpCircleIcon } from "./icons";
import { detectDeviceFit, type DeviceFit } from "./deviceFit";
import { DeviceEntry } from "./DeviceEntry";
import {
  parseUserLength,
  USER_LENGTH_RANGE_MM,
  userLengthRangeMessage,
} from "../photo/user-length";
import {
  EDIT_HAND_LENGTH_LABEL,
  failureOffersLengthEdit,
  noPaperEntryLabel,
} from "./noPaperEntry";
import { freshLiveLoopSampling, sampleElapsedMs } from "./liveLoop";
import "../../app/scan/scan.css";
import "./camera.css";
import "./easy-scan.css";

type CornerTuple<T> = readonly [T, T, T, T];
type GripStyle = "palm" | "claw" | "fingertip";

interface ImageCaptureLike {
  takePhoto(): Promise<Blob>;
}
interface ImageCaptureConstructor {
  new (track: MediaStreamTrack): ImageCaptureLike;
}
function getImageCaptureCtor(): ImageCaptureConstructor | null {
  return (
    (window as unknown as { ImageCapture?: ImageCaptureConstructor })
      .ImageCapture ?? null
  );
}

type CamState =
  | { kind: "requesting" }
  | { kind: "live" }
  | { kind: "cameraError"; message: string }
  | { kind: "streamEnded" }
  /** No usable camera at all (insecure context, no getUserMedia, desktop) — upload only, no error styling. */
  | { kind: "noCamera" };

type ResultState =
  | { kind: "none" }
  | { kind: "processing"; previewUrl: string }
  | {
      kind: "measured";
      previewUrl: string;
      overlay: PhotoOverlay;
      measurements: HandMeasurements;
      submission: ScanSubmission;
      imageWidth: number;
      imageHeight: number;
    }
  | {
      kind: "gateFailure";
      previewUrl: string;
      overlay: PhotoOverlay | null;
      errors: readonly PipelineIssue[];
      imageWidth: number;
      imageHeight: number;
    };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function idealCorners(containerWidth: number, containerHeight: number): Quad {
  const insetX = containerWidth * 0.12;
  const insetY = containerHeight * 0.12;
  return {
    topLeft: { x: insetX, y: insetY },
    topRight: { x: containerWidth - insetX, y: insetY },
    bottomRight: { x: containerWidth - insetX, y: containerHeight - insetY },
    bottomLeft: { x: insetX, y: containerHeight - insetY },
  };
}
function quadToTuple(quad: Quad): CornerTuple<Point> {
  return [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
}
function quadBoundingBox(quad: Quad) {
  const xs = [
    quad.topLeft.x,
    quad.topRight.x,
    quad.bottomRight.x,
    quad.bottomLeft.x,
  ];
  const ys = [
    quad.topLeft.y,
    quad.topRight.y,
    quad.bottomRight.y,
    quad.bottomLeft.y,
  ];
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}
function sampleLuma(
  gray: Float64Array,
  width: number,
  height: number,
  quad: Quad | null,
): Float64Array {
  if (!quad) return gray;
  const box = quadBoundingBox(quad);
  const minX = Math.max(0, Math.floor(box.minX));
  const maxX = Math.min(width, Math.ceil(box.maxX));
  const minY = Math.max(0, Math.floor(box.minY));
  const maxY = Math.min(height, Math.ceil(box.maxY));
  if (maxX <= minX || maxY <= minY) return gray;
  const out = new Float64Array((maxX - minX) * (maxY - minY));
  let i = 0;
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) out[i++] = gray[y * width + x];
  }
  return out;
}
function dotStyle(p: { x: number; y: number }): CSSProperties {
  return { left: p.x, top: p.y };
}

function CornerDot({ point, found }: { point: Point; found: boolean }) {
  return (
    <div
      className={`cameraCornerDot${found ? " found" : ""}`}
      style={dotStyle(point)}
      aria-hidden="true"
    >
      {found && (
        <svg viewBox="0 0 20 20">
          <path d="M5 10.3 L8.4 13.7 L15 6.3" />
        </svg>
      )}
    </div>
  );
}

interface DimensionSpec {
  readonly a: Point;
  readonly b: Point;
  readonly label: string;
  readonly side: 1 | -1;
}

/** The measured sheet's two dimension lines (hand length, palm width) — a
 * simpler cousin of ScanClient's DimensionLinesOverlay (no skeleton dots,
 * matching screen 16's plain white lines), built on the same tested pure
 * geometry (computeDimensionLine, separateLabelBoxes). */
function DimensionLinesOverlay({
  specs,
  scale,
}: {
  specs: readonly DimensionSpec[];
  /** User-space units per on-screen pixel (imageWidth / the frame's actual
   * rendered CSS width) — an SVG `viewBox` spanning a multi-thousand-pixel
   * photo makes any FIXED user-unit font-size/offset render at wildly
   * different on-screen sizes depending on the photo's own resolution and
   * how big the frame is drawn; `vector-effect: non-scaling-stroke` solves
   * this for line widths but has no text equivalent, so every screen-space
   * size below is converted through this measured scale instead. */
  scale: number;
}) {
  const offsetPx = 22 * scale;
  const tickLengthPx = 8 * scale;
  const labelOffsetPx = 14 * scale;
  const fontSize = 13 * scale;
  const paddingX = 8 * scale;
  const labelHeight = 22 * scale;

  const geometries = specs.map((s) =>
    computeDimensionLine(
      s.a,
      s.b,
      offsetPx,
      s.side,
      tickLengthPx,
      labelOffsetPx,
    ),
  );
  const rawBoxes: Box[] = geometries.map((g, i) => ({
    x: g.labelAnchor.x,
    y: g.labelAnchor.y,
    width: specs[i].label.length * fontSize * 0.62 + paddingX * 2,
    height: labelHeight,
  }));
  const boxes =
    rawBoxes.length === 2
      ? separateLabelBoxes(rawBoxes[0], rawBoxes[1])
      : rawBoxes;

  return (
    <>
      {geometries.map((g, i) => (
        <g key={i} className="easyDim">
          <line
            x1={g.startConnector[0].x}
            y1={g.startConnector[0].y}
            x2={g.startConnector[1].x}
            y2={g.startConnector[1].y}
            className="easyDimExtension"
          />
          <line
            x1={g.endConnector[0].x}
            y1={g.endConnector[0].y}
            x2={g.endConnector[1].x}
            y2={g.endConnector[1].y}
            className="easyDimExtension"
          />
          <line
            x1={g.offsetStart.x}
            y1={g.offsetStart.y}
            x2={g.offsetEnd.x}
            y2={g.offsetEnd.y}
            className="easyDimLine"
          />
        </g>
      ))}
      {boxes.map((box, i) => (
        <g key={i} transform={`translate(${box.x} ${box.y})`}>
          <rect
            x={-box.width / 2}
            y={-box.height / 2}
            width={box.width}
            height={box.height}
            rx={box.height / 2}
            className="easyDimLabelBg"
          />
          <text
            x={0}
            y={fontSize * 0.32}
            textAnchor="middle"
            fontSize={fontSize}
            className="easyDimLabelText"
          >
            {specs[i].label}
          </text>
        </g>
      ))}
    </>
  );
}

const GRIP_OPTIONS: readonly { value: GripStyle | undefined; label: string }[] =
  [
    { value: "palm", label: "Palm" },
    { value: "claw", label: "Claw" },
    { value: "fingertip", label: "Fingertip" },
    { value: undefined, label: "Not sure" },
  ];

function HandToggle({
  state,
  onClick,
  disabled = false,
  inSheet = false,
}: {
  readonly state: HandChipState;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly inSheet?: boolean;
}) {
  return (
    <button
      type="button"
      className={`easyHandChip${inSheet ? " easyHandChipInSheet" : ""}`}
      aria-pressed={state.locked}
      disabled={disabled}
      onClick={onClick}
    >
      <HandIcon width={16} height={16} /> {handChipLabel(state)}
    </button>
  );
}

export interface EasyScanCameraProps {
  /** Test/demo injection point — real pages never pass this. */
  readonly runPhotoPipelineImpl?: (
    input: RunPhotoPipelineInput,
  ) => Promise<PipelineResult>;
  /** Seeds the measured bottom sheet directly, skipping the camera and
   * pipeline entirely — for `/scan/easy/measured-demo` (screenshots and
   * e2e; no synthetic photo makes MediaPipe detect a hand, same reason
   * `/scan/measured-demo` exists). */
  readonly demoMeasured?: {
    readonly previewUrl: string;
    readonly overlay: PhotoOverlay;
    readonly measurements: HandMeasurements;
    readonly submission: ScanSubmission;
    readonly imageWidth: number;
    readonly imageHeight: number;
  };
  /** Forces the first-run tip open regardless of localStorage — for
   * `/scan/easy/tip-demo` (screenshot only). */
  readonly forceTipOpen?: boolean;
}

export default function EasyScanCamera({
  runPhotoPipelineImpl = runPhotoPipeline,
  demoMeasured,
  forceTipOpen,
}: EasyScanCameraProps) {
  const router = useRouter();
  const [camState, setCamState] = useState<CamState>({ kind: "requesting" });
  const [result, setResult] = useState<ResultState>(
    demoMeasured
      ? {
          kind: "measured",
          previewUrl: demoMeasured.previewUrl,
          overlay: demoMeasured.overlay,
          measurements: demoMeasured.measurements,
          submission: demoMeasured.submission,
          imageWidth: demoMeasured.imageWidth,
          imageHeight: demoMeasured.imageHeight,
        }
      : { kind: "none" },
  );
  const [handChip, setHandChip] = useState<HandChipState>(
    INITIAL_HAND_CHIP_STATE,
  );
  const [paperSize, setPaperSize] = useState<PaperSize>("a4");
  const [deviceFit, setDeviceFit] = useState<DeviceFit | null>(null);
  const [pageUrl, setPageUrl] = useState("");
  const [userLengthMm, setUserLengthMm] = useState<number | null>(null);
  const [lengthStep, setLengthStep] = useState(false);
  const [lengthValue, setLengthValue] = useState("");
  const [lengthError, setLengthError] = useState("");
  const lengthHeadingRef = useRef<HTMLHeadingElement>(null);
  // Whichever "no paper" entry is on screen, so focus can return to it.
  const noPaperEntryRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);
  // Set when the user leaves no-paper mode from a button that is about to
  // disappear: focus then goes to the entry instead of falling to <body>.
  const focusEntryAfterSwitchRef = useRef(false);
  // Read by screen readers when the mode changes. A new `n` replaces the
  // message node so a repeat of the same text is announced again.
  const [modeAnnouncement, setModeAnnouncement] = useState({ n: 0, text: "" });
  const [gripStyle, setGripStyle] = useState<GripStyle | undefined>(undefined);
  const [tipOpen, setTipOpen] = useState(Boolean(forceTipOpen));
  const [cue, setCue] = useState<Cue | null>(null);
  const [displayCorners, setDisplayCorners] =
    useState<CornerTuple<Point> | null>(null);
  const [foundPerCorner, setFoundPerCorner] = useState<CornerTuple<boolean>>([
    false,
    false,
    false,
    false,
  ]);
  const [ringFraction, setRingFraction] = useState(0);
  const [flashKey, setFlashKey] = useState(0);
  const [announced, setAnnounced] = useState("");
  const [frameAspect, setFrameAspect] = useState(210 / 297);
  // The frozen photo's actual on-screen width — measured so the overlay
  // drawn on top of it (corner checks, dimension lines/labels) can convert
  // fixed screen-pixel sizes into the SVG's image-pixel viewBox units. See
  // DimensionLinesOverlay's own comment on why this can't be a constant.
  const [frozenFrameWidthPx, setFrozenFrameWidthPx] = useState(0);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const frozenFrameRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const prevSampleQuadRef = useRef<Quad | null>(null);
  const autoCaptureRef = useRef<AutoCaptureState>(INITIAL_AUTO_CAPTURE_STATE);
  const lastSampleTimeRef = useRef(0);
  const lastDetectionAtRef = useRef(0);
  const lastCueChangeAtRef = useRef(0);
  const lastCueCodeRef = useRef<Cue["code"] | null>(null);
  const capturingRef = useRef(false);
  const reducedMotionRef = useRef(false);
  const runIdRef = useRef(0);
  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);
  const camKindRef = useRef<CamState["kind"]>(camState.kind);
  camKindRef.current = camState.kind;
  const resultRef = useRef(result);
  resultRef.current = result;
  const fileRef = useRef<File | null>(null);
  const quadSourceRef = useRef<SheetQuadSource>(createPaperEdgeQuadSource());
  const handChipRef = useRef(handChip);
  handChipRef.current = handChip;
  const userLengthRef = useRef(userLengthMm);
  userLengthRef.current = userLengthMm;
  const paperSizeRef = useRef(paperSize);
  paperSizeRef.current = paperSize;
  const gripStyleRef = useRef(gripStyle);
  gripStyleRef.current = gripStyle;

  const sheetDialogRef = useRef<HTMLDialogElement>(null);
  const sheetTitleRef = useRef<HTMLParagraphElement>(null);
  const tipDialogRef = useRef<HTMLDialogElement>(null);
  const helpTriggerRef = useRef<HTMLButtonElement>(null);
  const gotItRef = useRef<HTMLButtonElement>(null);
  const tryAgainRef = useRef<HTMLButtonElement>(null);

  // Load persisted paper size + first-run-tip flag once, client-side only
  // (no hydration mismatch: both start at their SSR-safe defaults above).
  useEffect(() => {
    if (demoMeasured) return;
    const storage = getBrowserStorage();
    setPaperSize(readStoredPaperSize(storage));
    if (!forceTipOpen && !readFirstRunTipSeen(storage)) setTipOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Warm the MediaPipe HandLandmarker (its model + WASM fetch) as soon as
  // this page mounts, same as ScanClient does — so that same-origin asset
  // load happens well before a capture, not while the camera is "open"
  // (hard rule 5: no network request may fire while the camera is open,
  // except the single submit).
  useEffect(() => {
    void getHandLandmarker().catch(() => {
      // The measured/gate-failure sheet's own error state owns recovery.
    });
  }, []);

  // Measures the frozen photo's rendered width whenever it's showing, so
  // the overlay drawn on it can convert fixed screen-pixel sizes into the
  // photo's own (often much larger) pixel space.
  useEffect(() => {
    if (result.kind !== "measured" && result.kind !== "gateFailure") return;
    const el = frozenFrameRef.current;
    if (!el) return;
    setFrozenFrameWidthPx(el.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setFrozenFrameWidthPx(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [result.kind]);

  useEffect(() => {
    if (tipOpen && deviceFit === "phone" && !lengthStep) {
      tipDialogRef.current?.showModal();
      gotItRef.current?.focus();
    }
  }, [tipOpen, deviceFit, lengthStep]);

  useEffect(() => {
    if (userLengthMm !== null || !focusEntryAfterSwitchRef.current) return;
    focusEntryAfterSwitchRef.current = false;
    (noPaperEntryRef.current ?? helpTriggerRef.current)?.focus();
  }, [userLengthMm]);

  // The hand-length step replaces the screen: focus moves to its heading on
  // the way in and back to the "no paper" entry on the way out.
  useEffect(() => {
    if (lengthStep) {
      lengthHeadingRef.current?.focus();
      return;
    }
    if (restoreFocusRef.current) {
      restoreFocusRef.current = false;
      (noPaperEntryRef.current ?? helpTriggerRef.current)?.focus();
    }
  }, [lengthStep]);

  // The measured / gate-failure bottom sheet: a native <dialog> for the
  // focus trap + Escape handling, opened the moment the pipeline settles
  // and closed again on retake. Focus goes to the sheet's own heading, not
  // whichever button happens to be first in DOM order (the browser's
  // showModal() default) — for the measured sheet that would otherwise be
  // the "Palm" grip chip, misleadingly outlined even though "Not sure" is
  // the one actually selected.
  useEffect(() => {
    if (result.kind === "measured" || result.kind === "gateFailure") {
      sheetDialogRef.current?.showModal();
      sheetTitleRef.current?.focus();
    } else {
      sheetDialogRef.current?.close();
    }
  }, [result.kind]);

  const dismissTip = useCallback(() => {
    setTipOpen(false);
    tipDialogRef.current?.close();
    markFirstRunTipSeen(getBrowserStorage());
    // No explicit focus() to the "?" trigger here: the tip auto-opens on
    // mount (nothing "opened" it the way a click opens the nav menu), and
    // Chromium's :focus-visible heuristic treats a script-triggered focus
    // like this as keyboard-like, drawing a ring on a button nothing
    // pointed at — native <dialog> close() already restores focus to
    // whatever had it before showModal(), which is enough here.
  }, []);

  const openTip = useCallback(() => setTipOpen(true), []);

  useEffect(() => {
    reducedMotionRef.current =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      stopStream();
      if (resultRef.current.kind !== "none")
        URL.revokeObjectURL(resultRef.current.previewUrl);
    };
  }, [stopStream]);

  const startCamera = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    camKindRef.current = "requesting";
    setCamState({ kind: "requesting" });
    try {
      const stream = await requestCameraStream(
        navigator.mediaDevices,
        {
          video: {
            facingMode: "environment",
            width: { ideal: 3840 },
            height: { ideal: 2160 },
          },
          audio: false,
        },
        () =>
          mountedRef.current &&
          requestId === requestIdRef.current &&
          camKindRef.current === "requesting",
      );
      if (!stream) return;
      streamRef.current = stream;
      stream.getVideoTracks().forEach((track) => {
        track.addEventListener("ended", () => {
          stopStream();
          setCamState({ kind: "streamEnded" });
        });
        const settings = track.getSettings?.();
        if (settings?.width && settings.height) {
          setFrameAspect(settings.width / settings.height);
        }
      });
      autoCaptureRef.current = resetAutoCapture();
      lastDetectionAtRef.current = performance.now();
      prevSampleQuadRef.current = null;
      lastCueCodeRef.current = null;
      lastCueChangeAtRef.current = 0;
      setCamState({ kind: "live" });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : undefined;
      const message =
        name === "NotAllowedError" || name === "PermissionDeniedError"
          ? "Camera access was blocked."
          : "The camera couldn't be opened.";
      if (
        mountedRef.current &&
        requestId === requestIdRef.current &&
        camKindRef.current === "requesting"
      )
        setCamState({ kind: "cameraError", message });
    }
  }, [stopStream]);

  // No setup page: open the camera the moment this device can plausibly
  // use one — go straight to the upload path otherwise (no error styling).
  useEffect(() => {
    if (demoMeasured) return;
    const fit = detectDeviceFit({
      userAgent: navigator.userAgent,
      coarsePointer: window.matchMedia("(pointer: coarse)").matches,
    });
    setDeviceFit(fit);
    setPageUrl(window.location.origin + window.location.pathname);
    if (fit !== "phone") {
      setCamState({ kind: "noCamera" });
      return;
    }
    const canUseCamera =
      typeof window !== "undefined" &&
      window.isSecureContext &&
      typeof navigator.mediaDevices?.getUserMedia === "function";
    if (!canUseCamera) {
      setCamState({ kind: "noCamera" });
      return;
    }
    void startCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onVisibilityChange() {
      if (
        document.hidden &&
        (camState.kind === "live" || camState.kind === "requesting")
      ) {
        requestIdRef.current += 1;
        stopStream();
        setCamState({ kind: "streamEnded" });
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [camState.kind, stopStream]);

  const runPipeline = useCallback(
    async (file: File, previewUrl: string) => {
      const runId = ++runIdRef.current;
      setResult({ kind: "processing", previewUrl });
      try {
        const pipelineResult = await runPhotoPipelineImpl({
          file,
          hand: handChipRef.current.hand,
          handExplicit: handChipRef.current.locked,
          handednessFixInstruction: "tap the hand button below",
          gripStyleStated: gripStyleRef.current,
          calibration:
            userLengthRef.current !== null
              ? { method: "user-length", handLengthMm: userLengthRef.current }
              : { method: "paper-edge", paperSize: paperSizeRef.current },
        });
        if (runId !== runIdRef.current) return;
        if (pipelineResult.status === "ok") {
          setHandChip((prev) =>
            applyDetectedHandedness(prev, pipelineResult.overlay.handedness),
          );
          setResult({
            kind: "measured",
            previewUrl,
            overlay: pipelineResult.overlay,
            measurements: pipelineResult.measurements,
            submission: pipelineResult.submission,
            imageWidth: pipelineResult.overlay.imageWidth,
            imageHeight: pipelineResult.overlay.imageHeight,
          });
        } else if (pipelineResult.status === "error") {
          setHandChip((prev) =>
            applyDetectedHandedness(prev, pipelineResult.overlay.handedness),
          );
          setResult({
            kind: "gateFailure",
            previewUrl,
            overlay: pipelineResult.overlay,
            errors: pipelineResult.errors,
            imageWidth: pipelineResult.overlay.imageWidth,
            imageHeight: pipelineResult.overlay.imageHeight,
          });
        } else {
          // "needsManualCard" never happens in paper-edge mode.
          setResult({
            kind: "gateFailure",
            previewUrl,
            overlay: pipelineResult.overlay,
            errors: [
              {
                code: "UNEXPECTED",
                message: "Something went wrong. Try again.",
              },
            ],
            imageWidth: pipelineResult.overlay.imageWidth,
            imageHeight: pipelineResult.overlay.imageHeight,
          });
        }
      } catch {
        if (runId !== runIdRef.current) return;
        setResult({
          kind: "gateFailure",
          previewUrl,
          overlay: null,
          errors: [
            {
              code: "PROCESSING_FAILED",
              message:
                "Something went wrong while measuring that photo. Try again.",
            },
          ],
          imageWidth: 0,
          imageHeight: 0,
        });
      }
    },
    [runPhotoPipelineImpl],
  );

  const captureNow = useCallback(async () => {
    if (capturingRef.current) return;
    capturingRef.current = true;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    const video = videoRef.current;
    let file: File;
    try {
      const track = streamRef.current?.getVideoTracks()[0];
      const ImageCaptureCtor = getImageCaptureCtor();
      if (!track || !ImageCaptureCtor) throw new Error("no-image-capture");
      const capture = new ImageCaptureCtor(track);
      const blob = await capture.takePhoto();
      file = new File([blob], `capture-${Date.now()}.jpg`, {
        type: blob.type || "image/jpeg",
      });
    } catch {
      if (!video || video.videoWidth === 0) {
        capturingRef.current = false;
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        capturingRef.current = false;
        return;
      }
      ctx.drawImage(video, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.92),
      );
      if (!blob) {
        capturingRef.current = false;
        return;
      }
      file = new File([blob], `capture-${Date.now()}.jpg`, {
        type: "image/jpeg",
      });
    }

    stopStream();
    if (typeof navigator.vibrate === "function") {
      navigator.vibrate(CAMERA_CONSTANTS.autoCapture.vibrateMs);
    }
    if (!reducedMotionRef.current) setFlashKey((k) => k + 1);
    setAnnounced("Photo taken");
    fileRef.current = file;
    const previewUrl = URL.createObjectURL(file);
    capturingRef.current = false;
    void runPipeline(file, previewUrl);
  }, [stopStream, runPipeline]);

  const onFilePicked = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      stopStream();
      fileRef.current = file;
      const previewUrl = URL.createObjectURL(file);
      void runPipeline(file, previewUrl);
    },
    [stopStream, runPipeline],
  );

  const retake = useCallback(() => {
    if (result.kind !== "none") URL.revokeObjectURL(result.previewUrl);
    setResult({ kind: "none" });
    const canUseCamera =
      typeof window !== "undefined" &&
      window.isSecureContext &&
      typeof navigator.mediaDevices?.getUserMedia === "function";
    if (canUseCamera && deviceFit === "phone") void startCamera();
  }, [result, startCamera, deviceFit]);

  const changePaperSize = useCallback((size: PaperSize) => {
    setPaperSize(size);
    writeStoredPaperSize(getBrowserStorage(), size);
  }, []);

  const changeGrip = useCallback((next: GripStyle | undefined) => {
    setGripStyle(next);
    setResult((prev) => {
      if (prev.kind !== "measured") return prev;
      const submission = scanSubmissionSchema.parse({
        hand: prev.submission.hand,
        measurements: prev.submission.measurements,
        calibration: prev.submission.calibration,
        measurementModelVersion: prev.submission.measurementModelVersion,
        ...(next !== undefined ? { gripStyleStated: next } : {}),
      });
      return { ...prev, submission };
    });
  }, []);

  const toggleHand = useCallback(() => {
    if (!canToggleHandChip(resultRef.current.kind)) return;
    const next = toggleHandChip(handChipRef.current);
    handChipRef.current = next;
    setHandChip(next);
    if (
      resultRef.current.kind === "gateFailure" &&
      resultRef.current.errors[0]?.code === "HANDEDNESS_MISMATCH" &&
      fileRef.current
    ) {
      void runPipeline(fileRef.current, resultRef.current.previewUrl);
    }
  }, [runPipeline]);

  const resetLoopState = useCallback(() => {
    const fresh = freshLiveLoopSampling();
    lastSampleTimeRef.current = fresh.lastSampleAtMs;
    prevSampleQuadRef.current = fresh.prevQuad;
    autoCaptureRef.current = fresh.autoCapture;
    setRingFraction(0);
  }, []);

  // The live loop — identical shape to CameraCapture's, minus the hand
  // ghost and the redundant status-chips row (screen 14 shows only the
  // corner dots and one cue line).
  useEffect(() => {
    if (camState.kind !== "live" || tipOpen) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    video.play().catch(() => {});
    // A loop resumed after the tip closed starts from a clean slate: a stale
    // last-sample time, ring timer or previous quad would let the very first
    // sample fire an auto-capture.
    resetLoopState();

    let cancelled = false;
    const minIntervalMs = 1000 / CAMERA_CONSTANTS.liveLoop.maxSamplesPerSecond;

    function updateCoverRectFromStage() {
      const stage = stageRef.current;
      if (!stage || !video || video.videoWidth === 0) return null;
      const box = stage.getBoundingClientRect();
      const coverRect = computeCoverRect(
        box.width,
        box.height,
        video.videoWidth,
        video.videoHeight,
      );
      return {
        coverRect,
        containerWidth: box.width,
        containerHeight: box.height,
      };
    }

    function tick(now: number) {
      if (cancelled) return;
      rafRef.current = requestAnimationFrame(tick);
      if (now - lastSampleTimeRef.current < minIntervalMs) return;
      if (!video || video.readyState < 2 || video.videoWidth === 0) return;
      const dtMs = sampleElapsedMs(
        lastSampleTimeRef.current,
        now,
        minIntervalMs,
      );
      lastSampleTimeRef.current = now;

      const stageInfo = updateCoverRectFromStage();
      const { width, height } = computeDownscaleSize(
        video.videoWidth,
        video.videoHeight,
        CAMERA_CONSTANTS.liveLoop.downscaleLongEdgePx,
      );
      let canvas = offscreenRef.current;
      if (!canvas) {
        canvas = document.createElement("canvas");
        offscreenRef.current = canvas;
      }
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);

      if (userLengthRef.current !== null) {
        setDisplayCorners(null);
        setCue(null);
        setAnnounced("Hand flat, fingers together, phone straight above");
        return;
      }

      let detection;
      try {
        detection = quadSourceRef.current(imageData, paperSizeRef.current);
      } catch {
        detection = {
          corners: null,
          cornersSeen: 0 as const,
          cornersFound: [false, false, false, false] as const,
          partialCorners: [null, null, null, null] as const,
          minSideCoverage: 0,
          edgeFitResidualPx: 0,
        };
      }
      const sampleQuad: Quad | null = detection.corners
        ? {
            topLeft: detection.corners[0],
            topRight: detection.corners[1],
            bottomRight: detection.corners[2],
            bottomLeft: detection.corners[3],
          }
        : null;

      const gray = rgbaToGrayscale(imageData.data, width * height);
      let laplacianVariance = 0;
      try {
        laplacianVariance = computeLaplacianVariance(gray, width, height);
      } catch {
        laplacianVariance = 0;
      }
      const lumaSample = sampleLuma(gray, width, height, sampleQuad);
      const meanLuma = computeMeanLuma(lumaSample);
      const clippedFraction = computeClippedFraction(lumaSample);

      const frameDiagonal = Math.hypot(width, height);
      const steady = sampleQuad
        ? isSteady(prevSampleQuadRef.current, sampleQuad, frameDiagonal)
        : false;
      const sharpEnough =
        laplacianVariance >=
        CAMERA_CONSTANTS.steadiness.minLiveLaplacianVariance;

      if (detection.cornersSeen > 0) lastDetectionAtRef.current = now;
      const msSinceLastDetection =
        detection.cornersSeen > 0 ? 0 : now - lastDetectionAtRef.current;

      const nextCue = pickCue({
        cornersSeen: detection.cornersSeen,
        quad: sampleQuad,
        frameWidth: width,
        meanLuma,
        clippedFraction,
        steady,
        sharpEnough,
        msSinceLastDetection,
      });

      autoCaptureRef.current = advanceAutoCapture(
        autoCaptureRef.current,
        nextCue.allPass,
        dtMs,
      );
      setRingFraction(autoCaptureRingFraction(autoCaptureRef.current));
      prevSampleQuadRef.current = sampleQuad;

      if (stageInfo) {
        const { coverRect, containerWidth, containerHeight } = stageInfo;
        const ideal = quadToTuple(
          idealCorners(containerWidth, containerHeight),
        );
        const mapPartial = (p: Point | null): Point | null =>
          p ? mapMediaPointToContainer(p, coverRect, width, height) : null;
        const mappedPartial: CornerTuple<Point | null> = [
          mapPartial(detection.partialCorners[0]),
          mapPartial(detection.partialCorners[1]),
          mapPartial(detection.partialCorners[2]),
          mapPartial(detection.partialCorners[3]),
        ];
        setDisplayCorners([
          mappedPartial[0] ?? ideal[0],
          mappedPartial[1] ?? ideal[1],
          mappedPartial[2] ?? ideal[2],
          mappedPartial[3] ?? ideal[3],
        ]);
        setFoundPerCorner(detection.cornersFound);
      }

      if (
        now - lastCueChangeAtRef.current >= CAMERA_CONSTANTS.cueThrottleMs ||
        lastCueCodeRef.current === null ||
        nextCue.code !== lastCueCodeRef.current
      ) {
        lastCueChangeAtRef.current = now;
        lastCueCodeRef.current = nextCue.code;
        setCue(nextCue);
        setAnnounced(
          nextCue.code === "perfect" ? "Got it — hold still" : nextCue.message,
        );
      }

      if (autoCaptureRef.current.fired) void captureNow();
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [camState.kind, captureNow, tipOpen, resetLoopState]);

  const exitToHome = useCallback(() => {
    stopStream();
    router.push("/");
  }, [stopStream, router]);

  // Only a phone in a secure context with getUserMedia can open a camera;
  // everywhere else the upload fallback is the whole screen.
  const cameraAvailable = () =>
    deviceFit === "phone" &&
    window.isSecureContext &&
    typeof navigator.mediaDevices?.getUserMedia === "function";
  const announceMode = (text: string) =>
    setModeAnnouncement((prev) => ({ n: prev.n + 1, text }));
  const startLengthStep = () => {
    restoreFocusRef.current = true;
    dismissTip();
    stopStream();
    setCamState({ kind: "noCamera" });
    setLengthStep(true);
  };
  const leaveLengthStep = () => {
    setLengthStep(false);
    // startLengthStep parked the camera state on "noCamera": restart the
    // camera only where one can open, else that fallback screen is right.
    if (cameraAvailable()) void startCamera();
  };
  const continueWithLength = () => {
    const value = parseUserLength(lengthValue);
    if (value === null) {
      setLengthError(userLengthRangeMessage());
      return;
    }
    setLengthError("");
    setUserLengthMm(value);
    announceMode(
      `No-paper mode: using your hand length of ${value} mm. No sheet needed.`,
    );
    leaveLengthStep();
  };
  const switchToPaper = () => {
    focusEntryAfterSwitchRef.current = true;
    setUserLengthMm(null);
    userLengthRef.current = null;
    resetLoopState();
    announceMode("Paper mode: place your hand on a blank sheet of paper.");
  };
  // The failure sheet's edit-length button: the sheet closes first, so the
  // browser's focus restore cannot land after the heading takes focus.
  const editLengthFromFailure = () => {
    sheetDialogRef.current?.close();
    if (result.kind !== "none") URL.revokeObjectURL(result.previewUrl);
    setResult({ kind: "none" });
    startLengthStep();
  };

  const cueLabel =
    cue?.code === "perfect"
      ? "Got it — hold still"
      : (cue?.message ?? "Point the camera at the paper");

  // Null while the typed-hand-length feature flag is off: every "no paper"
  // entry below renders only when this is non-null.
  const noPaperLabel = noPaperEntryLabel(userLengthMm !== null);
  const noPaperMode = userLengthMm !== null;

  // The device is only known after mount. Until then show a neutral screen
  // rather than the dark camera UI, which a desktop or in-app browser would
  // see flash before its own entry screen replaces it.
  if (deviceFit === null && !demoMeasured)
    return (
      <main className="easyDevicePlaceholder" aria-busy="true">
        <p className="visuallyHidden">Loading the scanner…</p>
      </main>
    );

  if (
    (deviceFit === "desktop" || deviceFit === "in-app") &&
    result.kind === "none"
  )
    return (
      <DeviceEntry kind={deviceFit} url={pageUrl} onFilePicked={onFilePicked} />
    );

  return (
    <div className="cameraViewfinder easyScanShell">
      <p
        className="visuallyHiddenLive"
        role="status"
        aria-live="polite"
        data-testid="mode-announcement"
      >
        {modeAnnouncement.text && (
          <span key={modeAnnouncement.n}>{modeAnnouncement.text}</span>
        )}
      </p>
      <div className="cameraTopBar" inert={lengthStep}>
        <button
          type="button"
          className="cameraCloseButton"
          aria-label="Close camera, back to Home"
          onClick={exitToHome}
        >
          ×
        </button>
        <div className="easyScanTopRight">
          <button
            type="button"
            className="easyHelpButton"
            ref={helpTriggerRef}
            aria-label="Show the first-run tip"
            onClick={openTip}
          >
            <HelpCircleIcon width={20} height={20} />
          </button>
          <HandToggle
            state={handChip}
            onClick={toggleHand}
            disabled={!canToggleHandChip(result.kind)}
          />
        </div>
      </div>

      {lengthStep && (
        <section className="easyLengthStep" aria-labelledby="easy-length-title">
          <button
            type="button"
            className="easyLengthBack"
            onClick={leaveLengthStep}
          >
            {cameraAvailable() ? "Back to camera" : "Back to upload"}
          </button>
          <svg
            className="easyHandDrawing"
            viewBox="0 0 240 290"
            role="img"
            aria-label="Line drawing showing wrist crease to middle fingertip"
          >
            <path
              d="M76 261 C71 233 54 216 44 195 L23 151 Q17 135 27 131 Q36 128 44 144 L61 171 L52 89 Q50 75 60 73 Q70 72 73 87 L81 147 L78 46 Q78 31 89 31 Q100 32 100 47 L103 139 L108 28 Q110 15 121 17 Q131 19 130 33 L127 139 L141 53 Q144 40 155 43 Q165 46 161 59 L148 155 Q171 136 184 141 Q199 148 186 161 L166 184 Q151 202 149 232 L150 261 Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              className="easyHandDrawingMeasure"
              d="M75 247 Q110 240 150 247 M202 22 V247 M194 22 H210 M194 247 H210"
              fill="none"
              strokeWidth="2"
            />
          </svg>
          <h1 id="easy-length-title" ref={lengthHeadingRef} tabIndex={-1}>
            Hand length
          </h1>
          <p>Wrist crease to the tip of your middle finger</p>
          <form
            className="easyLengthForm"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              continueWithLength();
            }}
          >
            <label htmlFor="easy-hand-length">Hand length (mm)</label>
            <input
              id="easy-hand-length"
              type="number"
              inputMode="decimal"
              enterKeyHint="go"
              min={USER_LENGTH_RANGE_MM.min}
              max={USER_LENGTH_RANGE_MM.max}
              step="any"
              placeholder="e.g. 186 mm"
              value={lengthValue}
              aria-invalid={Boolean(lengthError)}
              aria-describedby={
                lengthError
                  ? "easy-length-hint easy-length-error"
                  : "easy-length-hint"
              }
              onChange={(e) => {
                setLengthValue(e.target.value);
                setLengthError("");
              }}
            />
            <p id="easy-length-hint" className="easyLengthHint">
              18.6 cm = 186 mm. Enter millimetres, from{" "}
              {USER_LENGTH_RANGE_MM.min} to {USER_LENGTH_RANGE_MM.max}.
            </p>
            {lengthError && (
              <p id="easy-length-error" role="alert">
                {lengthError}
              </p>
            )}
            <button type="submit" className="primaryButton">
              Continue
            </button>
          </form>
        </section>
      )}
      {!lengthStep &&
        camState.kind === "streamEnded" &&
        result.kind === "none" && (
          <div className="cameraResumeCard">
            <p>The camera turned off.</p>
            <button
              type="button"
              className="cameraResumeButton"
              onClick={() => void startCamera()}
            >
              Tap to resume camera
            </button>
          </div>
        )}

      {!lengthStep &&
        camState.kind === "cameraError" &&
        result.kind === "none" && (
          <div className="cameraErrorCard" role="alert">
            <p>{camState.message}</p>
            <p>To use the camera:</p>
            <ol>
              <li>Open your browser&apos;s site settings for this page.</li>
              <li>Allow camera access.</li>
              <li>Reload and try again.</li>
            </ol>
            <p>Or upload a photo instead using the button below.</p>
            <label
              className="easyUploadFallbackButton"
              htmlFor="easy-scan-upload"
            >
              Upload a photo instead
            </label>
          </div>
        )}

      {!lengthStep &&
        camState.kind === "noCamera" &&
        result.kind === "none" && (
          <div className="easyScanNoCamera">
            <p>
              {noPaperMode
                ? "Upload a top-down photo of your hand, flat on a plain surface, with your whole hand in view."
                : "Upload a top-down photo of your hand on a blank sheet of paper."}
            </p>
            <label
              className="easyUploadFallbackButton"
              htmlFor="easy-scan-upload"
            >
              Upload a photo
            </label>
            {noPaperLabel && (
              <button
                type="button"
                className="easyNoPaperLink"
                ref={noPaperEntryRef}
                onClick={startLengthStep}
              >
                {noPaperLabel}
              </button>
            )}
            {noPaperLabel && noPaperMode && (
              <button
                type="button"
                className="easyNoPaperLink"
                onClick={switchToPaper}
              >
                Use paper instead
              </button>
            )}
          </div>
        )}

      {!lengthStep &&
        (camState.kind === "live" || camState.kind === "requesting") &&
        result.kind === "none" && (
          <>
            <div className="cameraFrameWrap">
              <div
                className="cameraFrame"
                ref={stageRef}
                style={{ aspectRatio: frameAspect }}
              >
                <video
                  ref={videoRef}
                  className="cameraVideo"
                  muted
                  playsInline
                  autoPlay
                />
                <div className="cameraOverlay">
                  {userLengthMm === null && displayCorners && (
                    <>
                      <CornerDot
                        point={displayCorners[0]}
                        found={foundPerCorner[0]}
                      />
                      <CornerDot
                        point={displayCorners[1]}
                        found={foundPerCorner[1]}
                      />
                      <CornerDot
                        point={displayCorners[2]}
                        found={foundPerCorner[2]}
                      />
                      <CornerDot
                        point={displayCorners[3]}
                        found={foundPerCorner[3]}
                      />
                    </>
                  )}
                </div>
                {flashKey > 0 && <div key={flashKey} className="cameraFlash" />}
              </div>
            </div>

            <div className="cameraCueWrap">
              <div
                className={`cameraCue${cue?.allPass ? " perfect" : ""}`}
                aria-live="polite"
                data-testid="camera-cue"
              >
                {userLengthMm !== null ? (
                  "Hand flat, fingers together, phone straight above"
                ) : cue?.allPass ? (
                  <>
                    <CheckIcon width={16} height={16} /> {cueLabel}
                  </>
                ) : (
                  cueLabel
                )}
              </div>
            </div>
            <p className="visuallyHiddenLive" aria-live="polite">
              {announced}
            </p>

            <div className="easyBottomRow">
              {userLengthMm === null ? (
                <button
                  type="button"
                  className="easyPaperToggle"
                  onClick={() =>
                    changePaperSize(paperSize === "a4" ? "letter" : "a4")
                  }
                >
                  {PAPER_SIZE_LABELS[paperSize]}
                </button>
              ) : (
                <span className="easyLengthChip">
                  {userLengthMm} mm entered
                </span>
              )}
              <button
                type="button"
                className="cameraShutter"
                aria-label="Take photo"
                onClick={() => void captureNow()}
              >
                <div className="cameraShutterInner" />
                {userLengthMm === null && (
                  <svg className="cameraShutterRing" viewBox="0 0 96 96">
                    <circle
                      cx="48"
                      cy="48"
                      r={40}
                      strokeDasharray={2 * Math.PI * 40}
                      strokeDashoffset={2 * Math.PI * 40 * (1 - ringFraction)}
                    />
                  </svg>
                )}
              </button>
              <label
                className="easyUploadIconButton"
                htmlFor="easy-scan-upload"
                aria-label="Upload a photo instead"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="22"
                  height="22"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    d="M4 16.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5M8 8l4-4 4 4M12 4v12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </label>
            </div>
            {noPaperLabel && (
              <div className="easyNoPaperRow">
                <button
                  type="button"
                  className="easyNoPaperLink"
                  ref={noPaperEntryRef}
                  onClick={startLengthStep}
                >
                  {noPaperLabel}
                </button>
                {noPaperMode && (
                  <button
                    type="button"
                    className="easyNoPaperLink"
                    onClick={switchToPaper}
                  >
                    Use paper instead
                  </button>
                )}
              </div>
            )}
          </>
        )}

      <input
        id="easy-scan-upload"
        type="file"
        accept="image/*"
        onChange={onFilePicked}
        className="visuallyHidden"
        inert={lengthStep}
      />

      {(result.kind === "processing" ||
        result.kind === "measured" ||
        result.kind === "gateFailure") && (
        <div className="cameraFrameWrap">
          <div
            ref={frozenFrameRef}
            className="cameraFrame easyFrozenFrame"
            style={{
              aspectRatio:
                result.kind === "processing"
                  ? frameAspect
                  : (result.imageWidth || 1) / (result.imageHeight || 1),
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
            <img src={result.previewUrl} alt="" className="easyFrozenImg" />
            {result.kind !== "processing" && (
              <svg
                className="easyFrozenSvg"
                viewBox={`0 0 ${result.imageWidth || 1} ${result.imageHeight || 1}`}
                preserveAspectRatio="xMidYMid slice"
                role="img"
                aria-label={
                  noPaperMode
                    ? "Your photo with, once measured, the hand-length and palm-width lines"
                    : "Your photo with the paper corners and, once measured, the hand-length and palm-width lines"
                }
              >
                {(() => {
                  // User-units per on-screen pixel — see
                  // DimensionLinesOverlay's own comment. Falls back to a
                  // typical mobile content width before the first
                  // ResizeObserver measurement lands.
                  const scale =
                    result.imageWidth /
                    (frozenFrameWidthPx || Math.min(result.imageWidth, 350));
                  const cornerRadius = 11 * scale;
                  return (
                    <>
                      {result.overlay?.paperCorners?.map((p, i) => {
                        const cx = clamp(
                          p.x,
                          cornerRadius,
                          result.imageWidth - cornerRadius,
                        );
                        const cy = clamp(
                          p.y,
                          cornerRadius,
                          result.imageHeight - cornerRadius,
                        );
                        return (
                          <g
                            key={i}
                            className="easyCornerCheck"
                            transform={`translate(${cx} ${cy})`}
                          >
                            <circle r={cornerRadius} />
                            <path
                              d="M-6 0 L-1.5 5 L7 -6"
                              transform={`scale(${cornerRadius / 14})`}
                            />
                          </g>
                        );
                      })}
                      {result.kind === "measured" &&
                        result.overlay.landmarksPx && (
                          <DimensionLinesOverlay
                            scale={scale}
                            specs={[
                              {
                                a: result.overlay.landmarksPx[0],
                                b: result.overlay.landmarksPx[
                                  LANDMARK.middle[3]
                                ],
                                label:
                                  "method" in result.submission.calibration &&
                                  result.submission.calibration.method ===
                                    "user-length"
                                    ? `Entered ${result.submission.calibration.referenceMm} mm`
                                    : `Hand ${result.measurements.handLengthMm.toFixed(0)} mm`,
                                side: 1,
                              },
                              {
                                a: result.overlay.landmarksPx[
                                  LANDMARK.index[0]
                                ],
                                b: result.overlay.landmarksPx[
                                  LANDMARK.pinky[0]
                                ],
                                label: `Palm ${result.measurements.palmWidthMm.toFixed(0)} mm`,
                                side: 1,
                              },
                            ]}
                          />
                        )}
                    </>
                  );
                })()}
              </svg>
            )}
            {result.kind === "processing" && (
              <p className="easyProcessingPill" aria-live="polite">
                Measuring your hand…
              </p>
            )}
          </div>
        </div>
      )}

      {(result.kind === "measured" || result.kind === "gateFailure") && (
        <dialog
          ref={sheetDialogRef}
          className="easySheet"
          aria-label={
            result.kind === "measured" ? "Hand measured" : "Retake needed"
          }
          onCancel={(e) => {
            e.preventDefault();
            retake();
          }}
        >
          {result.kind === "measured" ? (
            <>
              <p className="easySheetTitle" ref={sheetTitleRef} tabIndex={-1}>
                <CheckIcon width={20} height={20} /> Hand measured
              </p>
              {"method" in result.submission.calibration &&
                result.submission.calibration.method === "user-length" && (
                  <div className="easyLengthDisclosure">
                    <p>
                      Based on the hand length you entered (
                      {result.submission.calibration.referenceMm} mm)
                    </p>
                    <p>
                      Measured without paper — less precise than a scan on A4.
                    </p>
                  </div>
                )}
              <p className="easySheetGripLabel">
                How do you hold a mouse? (optional)
              </p>
              <div
                className="easyGripChips"
                role="group"
                aria-label="Grip style, optional"
              >
                {GRIP_OPTIONS.map((opt) => {
                  const selected =
                    opt.value === undefined
                      ? gripStyle === undefined
                      : gripStyle === opt.value;
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      className={`easyGripChip${selected ? " selected" : ""}`}
                      aria-pressed={selected}
                      onClick={() => changeGrip(opt.value)}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <div className="easySheetActions">
                <button
                  type="button"
                  className="easyRetakeButton"
                  aria-label="Retake photo"
                  onClick={retake}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      d="M4 12a8 8 0 1 1 2.5 5.8M4 12V7M4 12h5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <div className="easySeeMatches">
                  <ScanSubmitPanel submission={result.submission} />
                </div>
              </div>
            </>
          ) : (
            <>
              <p
                className="easySheetTitle easySheetTitleError"
                ref={sheetTitleRef}
                tabIndex={-1}
              >
                Retake needed
              </p>
              <p className="easySheetErrorMessage" role="alert">
                {result.errors[0]?.message}
              </p>
              {result.errors[0]?.code === "HANDEDNESS_MISMATCH" && (
                <HandToggle state={handChip} onClick={toggleHand} inSheet />
              )}
              <button
                type="button"
                className="primaryButton easyTryAgainButton"
                ref={tryAgainRef}
                onClick={retake}
              >
                Try again
              </button>
              {failureOffersLengthEdit(noPaperMode, result.errors[0]?.code) && (
                <button
                  type="button"
                  className="easyEditLengthButton"
                  onClick={editLengthFromFailure}
                >
                  {EDIT_HAND_LENGTH_LABEL}
                </button>
              )}
            </>
          )}
        </dialog>
      )}

      <dialog
        ref={tipDialogRef}
        className="easySheet easyTipSheet"
        aria-label={
          noPaperMode
            ? "Your hand length is the ruler"
            : "One blank sheet is all you need"
        }
        onCancel={(e) => {
          e.preventDefault();
          dismissTip();
        }}
      >
        <p className="easySheetTitle">
          {noPaperMode
            ? "Your hand length is the ruler"
            : "One blank sheet is all you need"}
        </p>
        <ul className="easyTipList">
          {noPaperMode ? (
            <>
              <li>
                <span aria-hidden="true">🟫</span> A plain, darker surface
              </li>
              <li>
                <HandIcon width={18} height={18} /> Hand flat, fingers together
              </li>
              <li>
                <span aria-hidden="true">📱</span> Phone flat above — your whole
                hand in view
              </li>
            </>
          ) : (
            <>
              <li>
                <span aria-hidden="true">📄</span>{" "}
                {PAPER_SIZE_LABELS[paperSize]} paper on a darker table
              </li>
              <li>
                <HandIcon width={18} height={18} /> Hand flat, fingers together
              </li>
              <li>
                <span aria-hidden="true">📱</span> Phone flat above — the whole
                sheet in view
              </li>
            </>
          )}
        </ul>
        <button
          type="button"
          className="primaryButton easyTipGotIt"
          ref={gotItRef}
          onClick={dismissTip}
        >
          Got it
        </button>
        {noPaperLabel && (
          <button
            type="button"
            className="easyTipNoPaper"
            onClick={startLengthStep}
          >
            {noPaperLabel}
          </button>
        )}
        {noPaperLabel && noPaperMode && (
          <button
            type="button"
            className="easyTipNoPaper"
            onClick={() => {
              dismissTip();
              switchToPaper();
            }}
          >
            Use paper instead
          </button>
        )}
        <p className="easyTipFinePrint">
          Shown once. {PHOTO_PRIVACY_COPY} The camera view stays on your phone.
        </p>
      </dialog>
    </div>
  );
}
