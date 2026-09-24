"use client";

/**
 * Live camera capture (docs/design/camera-capture-2026-09-25/README.md),
 * revised 2026-09-25 for Kirby's plain-paper direction change: primer →
 * live viewfinder (lock-on brackets track the paper's 4 corners, found via
 * the injected `SheetQuadSource` — see quad-source.ts's header for why
 * this component never calls a paper-edge detector directly) → review →
 * `onUsePhoto`, which the caller (ScanClient) runs through the existing,
 * unchanged `runPhotoPipeline`.
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
  type PaperSize,
} from "./constants";
import {
  pickCue,
  computeStatusChips,
  type Cue,
  type StatusChips,
} from "./cues";
import {
  computeContainRect,
  mapMediaPointToContainer,
  type Quad,
  type Rect,
} from "./quad";
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
  type SheetQuadSource,
} from "./quad-source";
import "./camera.css";

type Hand = "left" | "right";

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
  readonly onUsePhoto: (file: File) => void;
  readonly onExit: () => void;
  /** Injectable for testing and for swapping in the real paper-edge detector later. */
  readonly quadSource?: SheetQuadSource;
}

const RING_RADIUS = 30;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function idealCorners(rect: Rect): Quad {
  const insetX = rect.width * 0.12;
  const insetY = rect.height * 0.12;
  return {
    topLeft: { x: rect.x + insetX, y: rect.y + insetY },
    topRight: { x: rect.x + rect.width - insetX, y: rect.y + insetY },
    bottomRight: {
      x: rect.x + rect.width - insetX,
      y: rect.y + rect.height - insetY,
    },
    bottomLeft: { x: rect.x + insetX, y: rect.y + rect.height - insetY },
  };
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

function cornerStyle(p: { x: number; y: number }): CSSProperties {
  return { left: p.x, top: p.y };
}

function Bracket({
  point,
  found,
}: {
  point: { x: number; y: number };
  found: boolean;
}) {
  return (
    <div
      className={`cameraBracket${found ? " found" : ""}`}
      style={cornerStyle(point)}
      aria-hidden="true"
    >
      <svg viewBox="0 0 34 34">
        <path className="bracketMark" d="M2 14 L2 2 L14 2" />
        <path className="bracketMark" d="M20 2 L32 2 L32 14" />
        <path className="bracketMark" d="M32 20 L32 32 L20 32" />
        <path className="bracketMark" d="M14 32 L2 32 L2 20" />
        <path
          className="bracketCheck"
          d="M11 17.5 L15 21.5 L23 12.5 L21 10.5 L15 17 L13 15 Z"
        />
      </svg>
    </div>
  );
}

export default function CameraCapture({
  hand,
  onUsePhoto,
  onExit,
  quadSource,
}: CameraCaptureProps) {
  const [state, setState] = useState<CamState>({ kind: "primer" });
  const [paperSize, setPaperSize] = useState<PaperSize>("a4");
  const [cue, setCue] = useState<Cue | null>(null);
  const [chips, setChips] = useState<StatusChips | null>(null);
  const [displayQuad, setDisplayQuad] = useState<Quad | null>(null);
  const [foundQuad, setFoundQuad] = useState<boolean>(false);
  const [ringFraction, setRingFraction] = useState(0);
  const [flashKey, setFlashKey] = useState(0);
  const [announced, setAnnounced] = useState("");

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
  const capturingRef = useRef(false);
  const quadSourceRef = useRef<SheetQuadSource>(
    quadSource ?? createMarkerBasedQuadSource(),
  );
  const reducedMotionRef = useRef(false);

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
  useEffect(() => stopStream, [stopStream]);

  const startCamera = useCallback(async () => {
    setState({ kind: "requesting" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 3840 },
          height: { ideal: 2160 },
        },
        audio: false,
      });
      streamRef.current = stream;
      stream.getVideoTracks().forEach((track) => {
        track.addEventListener("ended", () => {
          stopStream();
          setState({ kind: "streamEnded" });
        });
      });
      autoCaptureRef.current = resetAutoCapture();
      lastDetectionAtRef.current = performance.now();
      prevSampleQuadRef.current = null;
      setState({ kind: "live" });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : undefined;
      const message =
        name === "NotAllowedError" || name === "PermissionDeniedError"
          ? "Camera access was blocked."
          : "The camera couldn't be opened.";
      setState({ kind: "cameraError", message });
    }
  }, [stopStream]);

  // Leaving the tab or locking the phone: stop the tracks proactively
  // rather than let the OS revoke them, and show the resume state.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.hidden && state.kind === "live") {
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

  // The live loop: downscaled frame, throttled sampling, brackets/cue/chip
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

    function updateContainRectFromStage() {
      const stage = stageRef.current;
      if (!stage || !video || video.videoWidth === 0) return null;
      const box = stage.getBoundingClientRect();
      return computeContainRect(
        box.width,
        box.height,
        video.videoWidth,
        video.videoHeight,
      );
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

      const rect = updateContainRectFromStage();
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

      const detection = quadSourceRef.current(imageData, paperSize);
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
      const nextChips = computeStatusChips({
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
      setFoundQuad(sampleQuad !== null);

      if (rect) {
        const source = sampleQuad ?? idealCorners(rect);
        const mapCorner = (p: { x: number; y: number }) =>
          sampleQuad ? mapMediaPointToContainer(p, rect, width, height) : p;
        setDisplayQuad({
          topLeft: mapCorner(source.topLeft),
          topRight: mapCorner(source.topRight),
          bottomRight: mapCorner(source.bottomRight),
          bottomLeft: mapCorner(source.bottomLeft),
        });
      }

      if (
        now - lastCueChangeAtRef.current >= CAMERA_CONSTANTS.cueThrottleMs ||
        cue === null ||
        nextCue.code !== cue.code
      ) {
        lastCueChangeAtRef.current = now;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cue is read for change-detection only; re-subscribing per cue change would restart the whole loop.
  }, [state.kind, paperSize, captureNow]);

  if (state.kind === "primer") {
    return (
      <div className="cameraPrimer">
        <div className="cameraPrimerRow">
          <span className="cameraPrimerBadge" aria-hidden="true">
            1
          </span>
          <p className="cameraPrimerText">
            Blank {PAPER_SIZE_LABELS[paperSize]} paper on a darker, plain table,
            in even light with no glare.
          </p>
        </div>
        <div className="cameraPrimerRow">
          <span className="cameraPrimerBadge" aria-hidden="true">
            2
          </span>
          <p className="cameraPrimerText">
            Hand flat on the paper, fingers together, wrist at the bottom edge.
          </p>
        </div>
        <div className="cameraPrimerRow">
          <span className="cameraPrimerBadge" aria-hidden="true">
            3
          </span>
          <p className="cameraPrimerText">
            Hold the phone flat above, about 40 cm up — the whole paper in view.
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
                onClick={() => setPaperSize(size)}
              >
                {PAPER_SIZE_LABELS[size]}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          className="primaryButton"
          style={{ width: "100%" }}
          onClick={() => void startCamera()}
        >
          Turn on camera
        </button>
        <p className="cameraNotice">
          The camera view stays on this phone. Only measurements are sent.
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
        <span className="cameraStepPill">Step 2 of 2 · Photo</span>
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
        <div className="cameraStage" ref={stageRef}>
          <video
            ref={videoRef}
            className="cameraVideo"
            muted
            playsInline
            autoPlay
          />
          <div className="cameraOverlay">
            {displayQuad && (
              <>
                <Bracket point={displayQuad.topLeft} found={foundQuad} />
                <Bracket point={displayQuad.topRight} found={foundQuad} />
                <Bracket point={displayQuad.bottomRight} found={foundQuad} />
                <Bracket point={displayQuad.bottomLeft} found={foundQuad} />
                {foundQuad && (
                  <div
                    className="cameraHandGhost"
                    style={{
                      left: displayQuad.topLeft.x,
                      top:
                        (displayQuad.topLeft.y + displayQuad.bottomLeft.y) / 2,
                      width: displayQuad.topRight.x - displayQuad.topLeft.x,
                      height:
                        (displayQuad.bottomLeft.y - displayQuad.topLeft.y) / 2,
                      transform: hand === "left" ? "scaleX(-1)" : undefined,
                    }}
                  >
                    <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                      <ellipse cx="55" cy="60" rx="22" ry="34" fill="#fff" />
                      <ellipse cx="28" cy="70" rx="12" ry="18" fill="#fff" />
                    </svg>
                  </div>
                )}
              </>
            )}
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
              {cue?.message ?? "Point the camera at the paper"}
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
              <svg className="cameraShutterRing" viewBox="0 0 72 72">
                <circle
                  cx="36"
                  cy="36"
                  r={RING_RADIUS}
                  strokeDasharray={RING_CIRCUMFERENCE}
                  strokeDashoffset={RING_CIRCUMFERENCE * (1 - ringFraction)}
                />
              </svg>
            </button>
          </div>

          {flashKey > 0 && <div key={flashKey} className="cameraFlash" />}
        </div>
      )}

      {state.kind === "review" && (
        <div className="cameraReview">
          <div className="cameraReviewStage">
            {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
            <img src={state.previewUrl} alt="" className="cameraReviewImg" />
            {state.quad && (
              <svg
                className="cameraReviewSvg"
                viewBox={`0 0 ${state.fullWidth} ${state.fullHeight}`}
                preserveAspectRatio="xMidYMid meet"
                role="img"
                aria-label="Detected paper corners overlaid on your photo"
              >
                <polygon
                  className="overlayPaper"
                  points={[
                    state.quad.topLeft,
                    state.quad.topRight,
                    state.quad.bottomRight,
                    state.quad.bottomLeft,
                  ]
                    .map((p) => `${p.x},${p.y}`)
                    .join(" ")}
                />
              </svg>
            )}
          </div>
          <div className="cameraReviewActions">
            <button
              type="button"
              className="cameraRetake"
              onClick={() => {
                URL.revokeObjectURL(state.previewUrl);
                void startCamera();
              }}
            >
              Retake
            </button>
            <button
              type="button"
              className="cameraUsePhoto"
              onClick={() => onUsePhoto(state.file)}
            >
              Use this photo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
