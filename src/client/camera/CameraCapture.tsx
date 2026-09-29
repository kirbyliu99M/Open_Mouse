"use client";

/**
 * Live camera capture (docs/design/camera-capture-2026-09-25/README.md;
 * visual details matched 2026-09-25 to Codex's product-shell design, PR
 * #60 — docs/design/product-shell-2026-09-25/README.md and its
 * 03-camera.png/04-review.png): primer → live viewfinder (an inset,
 * bordered frame — not full-bleed edge-to-edge — with corner check-dots
 * that lock on individually, chips below the frame, one cue line, a big
 * ring shutter) → review (full photo, corner dots, "Use this photo" /
 * "Retake photo") → `onUsePhoto`, which the caller (ScanClient) runs
 * through the existing, unchanged `runPhotoPipeline`.
 *
 * `calibrationMode` picks which quad source (and primer copy) applies:
 * "printed-sheet" locks onto the existing ArUco markers
 * (`createMarkerBasedQuadSource`, still what real users hit today);
 * "paper-edge" locks onto a blank sheet's own edges via the real detector
 * (`createPaperEdgeQuadSource`, wrapping `detectPaperQuad` — every call
 * wrapped in try/catch so a detector throw can never crash the live loop,
 * which calls it up to 8×/s).
 *
 * Everything under 640px-long-edge/≤8 samples-per-second in the live loop
 * is the *only* per-frame analysis (reusing `computeLaplacianVariance`);
 * no MediaPipe here. The full-resolution capture happens once, on
 * shutter/auto-capture, via `ImageCapture.takePhoto()` where available or a
 * full-size canvas fallback — never the live loop's downscaled frame.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { computeDownscaleSize } from "../photo/decode";
import { rgbaToGrayscale, computeLaplacianVariance } from "../photo/sharpness";
import {
  CAMERA_CONSTANTS,
  PAPER_SIZE_LABELS,
  PAPER_SIZES_MM,
} from "./constants";
import type { PaperSize } from "../../lib/contracts/measurement";
import {
  pickCue,
  computeStatusChips,
  type Cue,
  type StatusChips,
} from "./cues";
import {
  computeCoverRect,
  mapMediaPointToContainer,
  type Point,
  type Quad,
} from "./quad";
import { computeHandGhostGeometry } from "./handGhost";
import type { HandSilhouetteGeometry } from "../geometry/handSilhouette";
import { isSteady } from "./steadiness";
import { computeMeanLuma, computeClippedFraction } from "./light";
import {
  INITIAL_AUTO_CAPTURE_STATE,
  advanceAutoCapture,
  autoCaptureRingFraction,
  resetAutoCapture,
  type AutoCaptureState,
} from "./autoCapture";
import {
  createMarkerBasedQuadSource,
  createPaperEdgeQuadSource,
  type SheetQuadSource,
} from "./quad-source";
import "./camera.css";
import { PHOTO_PRIVACY_COPY } from "@/components/privacy-copy";
import { requestCameraStream } from "./requestStream";

/** TL, TR, BR, BL — the order every per-corner array in this file uses. */
type CornerTuple<T> = readonly [T, T, T, T];

type Hand = "left" | "right";
export type CalibrationMode = "printed-sheet" | "paper-edge";

/** Printed sheet's own aspect (docs/PLAN.md §M2: 210 × 265mm content column) — the live frame's aspect-ratio hint before/without a paper-size toggle. */
const PRINTED_SHEET_ASPECT = 210 / 265;

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
  | { kind: "primer" }
  | { kind: "requesting" }
  | { kind: "live" }
  | { kind: "cameraError"; message: string }
  | { kind: "streamEnded" }
  | {
      kind: "review";
      file: File;
      previewUrl: string;
      quad: Quad | null;
      fullWidth: number;
      fullHeight: number;
    };

export interface CameraCaptureProps {
  readonly hand: Hand;
  readonly calibrationMode: CalibrationMode;
  /** Only meaningful (and only shown as a toggle) in "paper-edge" mode. */
  readonly paperSize: PaperSize;
  readonly onPaperSizeChange: (size: PaperSize) => void;
  readonly onUsePhoto: (file: File) => void;
  readonly onExit: () => void;
  /** Injectable for testing and to override the mode-selected default source. */
  readonly quadSource?: SheetQuadSource;
}

const RING_RADIUS = 40;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * Placeholder corner-dot positions for a corner not yet found — inset
 * from the *container's own* visible bounds (the bordered frame element),
 * not from the cover rect, which can extend past it on one axis.
 */
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

function tupleToQuad(t: CornerTuple<Point>): Quad {
  return { topLeft: t[0], topRight: t[1], bottomRight: t[2], bottomLeft: t[3] };
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

/** Grayscale samples inside `quad`'s axis-aligned bounding box (clamped to the frame), or the whole frame when there's no quad yet. */
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
    for (let x = minX; x < maxX; x++) {
      out[i++] = gray[y * width + x];
    }
  }
  return out;
}

function dotStyle(p: { x: number; y: number }): CSSProperties {
  return { left: p.x, top: p.y };
}

/** A corner check-dot (Codex's product-shell design, PR #60): a plain circle, white outline until found, filled green with a check once locked on — no bracket frame. */
function CornerDot({
  point,
  found,
}: {
  point: { x: number; y: number };
  found: boolean;
}) {
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

export default function CameraCapture({
  hand,
  calibrationMode,
  paperSize,
  onPaperSizeChange,
  onUsePhoto,
  onExit,
  quadSource,
}: CameraCaptureProps) {
  const [state, setState] = useState<CamState>({ kind: "primer" });
  const [cue, setCue] = useState<Cue | null>(null);
  const [chips, setChips] = useState<StatusChips | null>(null);
  // One entry per corner (TL, TR, BR, BL) — each is the ideal placeholder
  // position until *that specific* corner locks on, independent of the
  // other three.
  const [displayCorners, setDisplayCorners] =
    useState<CornerTuple<Point> | null>(null);
  const [foundPerCorner, setFoundPerCorner] = useState<CornerTuple<boolean>>([
    false,
    false,
    false,
    false,
  ]);
  const [handGhost, setHandGhost] = useState<HandSilhouetteGeometry | null>(
    null,
  );
  const [ringFraction, setRingFraction] = useState(0);
  const [flashKey, setFlashKey] = useState(0);
  const [announced, setAnnounced] = useState("");
  const [frameAspect, setFrameAspect] = useState(
    calibrationMode === "paper-edge"
      ? PAPER_SIZES_MM[paperSize].width / PAPER_SIZES_MM[paperSize].height
      : PRINTED_SHEET_ASPECT,
  );

  const stageRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const prevSampleQuadRef = useRef<Quad | null>(null);
  const autoCaptureRef = useRef<AutoCaptureState>(INITIAL_AUTO_CAPTURE_STATE);
  const lastSampleTimeRef = useRef(0);
  const lastDetectionAtRef = useRef<number>(0);
  const lastCueChangeAtRef = useRef(0);
  // A ref, not the `cue` state itself: `tick` is one long-lived closure for
  // the whole "live" session (recreated only when state.kind/paperSize/
  // hand/calibrationMode change), so reading the `cue` *state* here would
  // always see whatever it was when the closure was created, never this
  // session's own later updates — silently defeating the "one change per
  // 1.5s" throttle below.
  const lastCueCodeRef = useRef<Cue["code"] | null>(null);
  const capturingRef = useRef(false);
  const reducedMotionRef = useRef(false);
  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);
  const stateKindRef = useRef<CamState["kind"]>(state.kind);
  stateKindRef.current = state.kind;
  const reviewUrlRef = useRef<string | null>(null);
  reviewUrlRef.current = state.kind === "review" ? state.previewUrl : null;

  const defaultQuadSource = useCallback(
    () =>
      calibrationMode === "paper-edge"
        ? createPaperEdgeQuadSource()
        : createMarkerBasedQuadSource(),
    [calibrationMode],
  );
  const quadSourceRef = useRef<SheetQuadSource>(
    quadSource ?? defaultQuadSource(),
  );
  useEffect(() => {
    quadSourceRef.current = quadSource ?? defaultQuadSource();
  }, [quadSource, defaultQuadSource]);

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

  // Hard rule: stop every media track on unmount, no matter which state we
  // were in when the component went away.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      stopStream();
      if (reviewUrlRef.current) URL.revokeObjectURL(reviewUrlRef.current);
    };
  }, [stopStream]);

  const startCamera = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    stateKindRef.current = "requesting";
    setState({ kind: "requesting" });
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
          stateKindRef.current === "requesting",
      );
      if (!stream) return;
      streamRef.current = stream;
      stream.getVideoTracks().forEach((track) => {
        track.addEventListener("ended", () => {
          stopStream();
          setState({ kind: "streamEnded" });
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
      setState({ kind: "live" });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : undefined;
      const message =
        name === "NotAllowedError" || name === "PermissionDeniedError"
          ? "Camera access was blocked."
          : "The camera couldn't be opened.";
      if (
        mountedRef.current &&
        requestId === requestIdRef.current &&
        stateKindRef.current === "requesting"
      )
        setState({ kind: "cameraError", message });
    }
  }, [stopStream]);

  // Leaving the tab or locking the phone: stop the tracks proactively
  // rather than let the OS revoke them, and show the resume state.
  useEffect(() => {
    function onVisibilityChange() {
      if (
        document.hidden &&
        (state.kind === "live" || state.kind === "requesting")
      ) {
        requestIdRef.current += 1;
        stopStream();
        setState({ kind: "streamEnded" });
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [state.kind, stopStream]);

  const captureNow = useCallback(async () => {
    if (capturingRef.current) return;
    capturingRef.current = true;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    const video = videoRef.current;
    const quadAtCapture = prevSampleQuadRef.current;
    const downscaled = offscreenRef.current;
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

    // Scale the last live-loop quad (downscaled-frame coordinates) up to
    // the full-resolution capture's own pixel space, for the review
    // overlay — a second detection pass on the full photo isn't needed
    // just to draw where we already saw the corners.
    const fullWidth = video?.videoWidth || 1;
    const fullHeight = video?.videoHeight || 1;
    let reviewQuad: Quad | null = null;
    if (quadAtCapture && downscaled && video) {
      const scaleX = fullWidth / downscaled.width;
      const scaleY = fullHeight / downscaled.height;
      const scale = (p: { x: number; y: number }) => ({
        x: p.x * scaleX,
        y: p.y * scaleY,
      });
      reviewQuad = {
        topLeft: scale(quadAtCapture.topLeft),
        topRight: scale(quadAtCapture.topRight),
        bottomRight: scale(quadAtCapture.bottomRight),
        bottomLeft: scale(quadAtCapture.bottomLeft),
      };
    }

    stopStream();
    if (typeof navigator.vibrate === "function") {
      navigator.vibrate(CAMERA_CONSTANTS.autoCapture.vibrateMs);
    }
    if (!reducedMotionRef.current) setFlashKey((k) => k + 1);
    setAnnounced("Photo taken");
    const previewUrl = URL.createObjectURL(file);
    setState({
      kind: "review",
      file,
      previewUrl,
      quad: reviewQuad,
      fullWidth,
      fullHeight,
    });
    capturingRef.current = false;
  }, [stopStream]);

  // The live loop: downscaled frame, throttled sampling, corner-dot/cue/chip
  // state, and the auto-capture ring — see the module doc comment.
  useEffect(() => {
    if (state.kind !== "live") return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    video.play().catch(() => {});

    let cancelled = false;
    const minIntervalMs = 1000 / CAMERA_CONSTANTS.liveLoop.maxSamplesPerSecond;

    function updateCoverRectFromStage() {
      const stage = stageRef.current;
      if (!stage || !video || video.videoWidth === 0) return null;
      const box = stage.getBoundingClientRect();
      // The bordered frame's own aspect already closely tracks the video's
      // real aspect (see `frameAspect`, set from the track's own
      // settings), so "cover" here is a safety net against a residual
      // mismatch, not a crop — mapping through the exact same fit function
      // the video itself uses keeps the overlay aligned either way.
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
      const previousSampleAt = lastSampleTimeRef.current;
      const dtMs =
        previousSampleAt === 0 ? minIntervalMs : now - previousSampleAt;
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

      let detection;
      try {
        detection = quadSourceRef.current(imageData, paperSize);
      } catch {
        // Defence in depth: quad-source.ts's own wrappers already catch a
        // detector throw, but this loop runs up to 8×/s for as long as the
        // camera is open and must never be the thing that crashes it.
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

      const nextCue = pickCue(
        {
          cornersSeen: detection.cornersSeen,
          quad: sampleQuad,
          frameWidth: width,
          meanLuma,
          clippedFraction,
          steady,
          sharpEnough,
          msSinceLastDetection,
        },
        calibrationMode,
      );
      const nextChips = computeStatusChips(
        {
          cornersSeen: detection.cornersSeen,
          quad: sampleQuad,
          frameWidth: width,
          meanLuma,
          clippedFraction,
          steady,
          sharpEnough,
          msSinceLastDetection,
        },
        calibrationMode,
      );

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
        // Per-corner lock-on: each of the 4 corners independently uses its
        // own detected position (mapped into container/CSS-pixel space)
        // once found, and only falls back to the ideal placeholder while
        // that specific corner is still missing — not an all-or-nothing
        // quad.
        const mapPartial = (p: Point | null): Point | null =>
          p ? mapMediaPointToContainer(p, coverRect, width, height) : null;
        const mappedPartial: CornerTuple<Point | null> = [
          mapPartial(detection.partialCorners[0]),
          mapPartial(detection.partialCorners[1]),
          mapPartial(detection.partialCorners[2]),
          mapPartial(detection.partialCorners[3]),
        ];
        const nextDisplayCorners: CornerTuple<Point> = [
          mappedPartial[0] ?? ideal[0],
          mappedPartial[1] ?? ideal[1],
          mappedPartial[2] ?? ideal[2],
          mappedPartial[3] ?? ideal[3],
        ];
        setDisplayCorners(nextDisplayCorners);
        setFoundPerCorner(detection.cornersFound);

        if (
          sampleQuad &&
          mappedPartial[0] &&
          mappedPartial[1] &&
          mappedPartial[2] &&
          mappedPartial[3]
        ) {
          const containerQuad = tupleToQuad([
            mappedPartial[0],
            mappedPartial[1],
            mappedPartial[2],
            mappedPartial[3],
          ]);
          setHandGhost(computeHandGhostGeometry(containerQuad, hand));
        } else {
          setHandGhost(null);
        }
      }

      if (
        now - lastCueChangeAtRef.current >= CAMERA_CONSTANTS.cueThrottleMs ||
        lastCueCodeRef.current === null ||
        nextCue.code !== lastCueCodeRef.current
      ) {
        lastCueChangeAtRef.current = now;
        lastCueCodeRef.current = nextCue.code;
        setCue(nextCue);
        setAnnounced(nextCue.message);
      }
      setChips(nextChips);

      if (autoCaptureRef.current.fired) {
        void captureNow();
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [state.kind, paperSize, captureNow, hand, calibrationMode]);

  if (state.kind === "primer") {
    return (
      <div className="cameraPrimer">
        {calibrationMode === "paper-edge" ? (
          <>
            <div className="cameraPrimerRow">
              <span className="cameraPrimerBadge" aria-hidden="true">
                1
              </span>
              <p className="cameraPrimerText">
                Blank {PAPER_SIZE_LABELS[paperSize]} paper on a darker, plain
                table, in even light with no glare.
              </p>
            </div>
            <div className="cameraPrimerRow">
              <span className="cameraPrimerBadge" aria-hidden="true">
                2
              </span>
              <p className="cameraPrimerText">
                Hand flat on the paper, fingers together, wrist at the bottom
                edge.
              </p>
            </div>
            <div className="cameraPrimerRow">
              <span className="cameraPrimerBadge" aria-hidden="true">
                3
              </span>
              <p className="cameraPrimerText">
                Hold the phone flat above, about 40 cm up — the whole paper in
                view.
              </p>
            </div>

            <div className="cameraPaperToggle">
              <span id="camera-paper-size-label">Paper size</span>
              <div
                className="cameraPaperToggleButtons"
                role="group"
                aria-labelledby="camera-paper-size-label"
              >
                {(Object.keys(PAPER_SIZES_MM) as PaperSize[]).map((size) => (
                  <button
                    key={size}
                    type="button"
                    className={`cameraPaperToggleButton${
                      paperSize === size ? " selected" : ""
                    }`}
                    aria-pressed={paperSize === size}
                    onClick={() => onPaperSizeChange(size)}
                  >
                    {PAPER_SIZE_LABELS[size]}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="cameraPrimerRow">
              <span className="cameraPrimerBadge" aria-hidden="true">
                1
              </span>
              <p className="cameraPrimerText">
                Sheet flat on a table, printed at 100%, good even light, no
                glare.
              </p>
            </div>
            <div className="cameraPrimerRow">
              <span className="cameraPrimerBadge" aria-hidden="true">
                2
              </span>
              <p className="cameraPrimerText">
                Bank card in the card outline; hand flat, fingers together,
                wrist at the line.
              </p>
            </div>
            <div className="cameraPrimerRow">
              <span className="cameraPrimerBadge" aria-hidden="true">
                3
              </span>
              <p className="cameraPrimerText">
                Hold the phone flat above, about 40 cm up — the whole sheet in
                view.
              </p>
            </div>
          </>
        )}

        <button
          type="button"
          className="primaryButton"
          style={{ width: "100%" }}
          onClick={() => void startCamera()}
        >
          Turn on camera
        </button>
        <p className="cameraNotice">
          {PHOTO_PRIVACY_COPY} The camera view stays on your phone.
        </p>
      </div>
    );
  }

  if (state.kind === "requesting") {
    return (
      <div className="cameraPrimer" aria-live="polite">
        <p className="cameraPrimerText">Starting the camera…</p>
      </div>
    );
  }

  if (state.kind === "cameraError") {
    return (
      <div className="cameraErrorCard" role="alert">
        <p>{state.message}</p>
        <p>To use the camera:</p>
        <ol>
          <li>Open your browser&apos;s site settings for this page.</li>
          <li>Allow camera access.</li>
          <li>Reload and tap &quot;Turn on camera&quot; again.</li>
        </ol>
        <p>Or upload a photo instead using the button below.</p>
        <button type="button" className="primaryButton" onClick={onExit}>
          Upload a photo instead
        </button>
      </div>
    );
  }

  const cornerNoun = calibrationMode === "paper-edge" ? "paper" : "sheet";

  if (state.kind === "review") {
    const allCornersFound = state.quad !== null;
    return (
      <div className="cameraReviewPage">
        <div className="cameraReviewTopBar">
          <button
            type="button"
            className="cameraReviewBack"
            onClick={() => {
              URL.revokeObjectURL(state.previewUrl);
              void startCamera();
            }}
          >
            <span aria-hidden="true">‹</span> Camera
          </button>
          <span className="cameraReviewStepLabel">
            {calibrationMode === "paper-edge"
              ? "Review"
              : "Step 2 of 2 · Review"}
          </span>
        </div>

        <h1 className="cameraReviewHeading">Check your photo</h1>
        <p className="cameraReviewSubtitle">
          Make sure your whole hand and all four {cornerNoun} corners are
          visible.
        </p>

        <div className="cameraReviewCard">
          {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
          <img src={state.previewUrl} alt="" className="cameraReviewImg" />
          {state.quad && (
            <svg
              className="cameraReviewSvg"
              viewBox={`0 0 ${state.fullWidth} ${state.fullHeight}`}
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label={`Detected ${cornerNoun} corners overlaid on your photo`}
            >
              {[
                state.quad.topLeft,
                state.quad.topRight,
                state.quad.bottomRight,
                state.quad.bottomLeft,
              ].map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={Math.max(10, state.fullWidth * 0.012)}
                  className="reviewCornerDot"
                />
              ))}
            </svg>
          )}
        </div>

        {allCornersFound && (
          <p className="cameraReviewStatus">
            <span aria-hidden="true">✓</span> All four {cornerNoun} corners
            found
          </p>
        )}

        <div className="cameraReviewActions">
          <button
            type="button"
            className="cameraUsePhoto"
            onClick={() => onUsePhoto(state.file)}
          >
            Use this photo
          </button>
          <button
            type="button"
            className="cameraRetake"
            onClick={() => {
              URL.revokeObjectURL(state.previewUrl);
              void startCamera();
            }}
          >
            Retake photo
          </button>
        </div>
        <p className="cameraNotice">{PHOTO_PRIVACY_COPY}</p>
      </div>
    );
  }

  const showViewfinder = state.kind === "live";

  return (
    <div className="cameraViewfinder">
      <div className="cameraTopBar">
        <button
          type="button"
          className="cameraCloseButton"
          aria-label="Close camera, back to Scan"
          onClick={() => {
            stopStream();
            onExit();
          }}
        >
          ×
        </button>
        <span className="cameraStepLabel">
          {calibrationMode === "paper-edge" ? "Photo" : "Step 2 of 2 · Photo"}
        </span>
      </div>

      {state.kind === "streamEnded" && (
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

      {showViewfinder && (
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
                {displayCorners && (
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
                {handGhost && (
                  <svg className="cameraHandGhostSvg" aria-hidden="true">
                    {/* One silhouette: every part is drawn twice — first a
                        slightly wider outline layer, then the fill layer on
                        top — so palm, fingers and thumb merge into a single
                        hand shape with no inner seams. The group's opacity
                        keeps it a hint, not a detection. */}
                    <g className="cameraHandGhost">
                      <path
                        className="cameraHandGhostOutline"
                        d={handGhost.palmPathD}
                        strokeWidth={3}
                      />
                      {[...handGhost.fingers, handGhost.thumb].map((f, i) => (
                        <line
                          key={i}
                          x1={f.from.x}
                          y1={f.from.y}
                          x2={f.to.x}
                          y2={f.to.y}
                          strokeWidth={f.widthPx + 3}
                          className="cameraHandGhostOutline"
                        />
                      ))}
                      <path
                        className="cameraHandGhostFill"
                        d={handGhost.palmPathD}
                        strokeWidth={0}
                      />
                      {[...handGhost.fingers, handGhost.thumb].map((f, i) => (
                        <line
                          key={i}
                          x1={f.from.x}
                          y1={f.from.y}
                          x2={f.to.x}
                          y2={f.to.y}
                          strokeWidth={f.widthPx}
                          className="cameraHandGhostFill"
                        />
                      ))}
                    </g>
                  </svg>
                )}
              </div>
              {flashKey > 0 && <div key={flashKey} className="cameraFlash" />}
            </div>
          </div>

          {chips && (
            <div className="cameraChips" aria-hidden="true">
              <span className={`cameraChip${chips.paper.pass ? " pass" : ""}`}>
                {chips.paper.label}
              </span>
              <span className={`cameraChip${chips.steady.pass ? " pass" : ""}`}>
                {chips.steady.label}
              </span>
              <span className={`cameraChip${chips.light.pass ? " pass" : ""}`}>
                {chips.light.label}
              </span>
            </div>
          )}

          <div className="cameraCueWrap">
            <div
              className={`cameraCue${cue?.allPass ? " perfect" : ""}`}
              aria-live="polite"
              data-testid="camera-cue"
            >
              {cue?.message ?? `Point the camera at the ${cornerNoun}`}
            </div>
          </div>
          <p className="visuallyHiddenLive" aria-live="polite">
            {announced}
          </p>

          <div className="cameraShutterRow">
            <button
              type="button"
              className="cameraShutter"
              aria-label="Take photo"
              onClick={() => void captureNow()}
            >
              <div className="cameraShutterInner" />
              <svg className="cameraShutterRing" viewBox="0 0 96 96">
                <circle
                  cx="48"
                  cy="48"
                  r={RING_RADIUS}
                  strokeDasharray={RING_CIRCUMFERENCE}
                  strokeDashoffset={RING_CIRCUMFERENCE * (1 - ringFraction)}
                />
              </svg>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
