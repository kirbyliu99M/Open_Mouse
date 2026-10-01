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
 * both harder to read. `calibrationMode` is always "paper-edge" here. The
 * printed-sheet flow keeps its own screen at `/scan`, but it shares this
 * file's pure logic, so scan v2 changed it too: the ring waits for 3
 * consecutive failed samples before it empties (`advanceAutoCapture`), blur is
 * its own cue, "out-of-focus", and "hold-still" is shake only (`pickCue`). See
 * the note in docs/design/camera-capture-2026-09-25/README.md.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
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
import {
  DETECTOR_LOAD_FAILED_MESSAGE,
  getHandLandmarker,
  HandLandmarkerLoadError,
} from "../photo/landmarks";
import {
  runPhotoPipeline,
  type PhotoOverlay,
  type PipelineIssue,
  type RunPhotoPipelineInput,
  type PipelineResult,
} from "../photo/pipeline";
import type { HandMeasurements } from "../../lib/contracts/measurement";
import { CAMERA_CONSTANTS, PAPER_SIZE_LABELS } from "./constants";
import {
  cueFromCode,
  easyCueText,
  easyHintText,
  pickCue,
  type Cue,
  type CueCode,
} from "./cues";
import { PHOTO_PRIVACY_COPY } from "@/components/privacy-copy";
import { requestCameraStream } from "./requestStream";
import {
  computeCoverRect,
  mapMediaPointToContainer,
  type Point,
  type Quad,
} from "./quad";
import { computeMeanLuma, computeClippedFraction } from "./light";
import { computeMaxCornerMovement, isSteady } from "./steadiness";
import {
  INITIAL_AUTO_CAPTURE_STATE,
  advanceAutoCapture,
  autoCaptureRingFraction,
  type AutoCaptureState,
} from "./autoCapture";
import {
  INITIAL_CUE_DEBOUNCE_STATE,
  advanceCueDebounce,
  type CueDebounceState,
} from "./cueDebounce";
import {
  INITIAL_CORNER_STATES,
  advanceCorners,
  type CornerStates,
} from "./cornerSmoother";
import {
  NO_FOCUS_SUPPORT,
  applyContinuousFocus,
  focusOnceThenContinuous,
  readFocusSupport,
  tapToVideoPoint,
  type FocusApplyResult,
  type FocusSupport,
  type FocusTrackLike,
} from "./focus";
import {
  computeFrozenPhotoLayout,
  computeGuideRect,
  computeMeasuredTransform,
  computeResultFocusRect,
  overlayUnitsPerPx,
  paperAspect,
  rectCorners,
  type Size,
} from "./photoLayout";
import { problemAreaFor } from "./problemArea";
import { FrozenPhoto, type DimensionSpec } from "./FrozenPhoto";
import { EasyCorners } from "./EasyCorners";
import { ScanDebugPanel } from "./ScanDebugPanel";
import { usePrefersReducedMotion } from "./useReducedMotion";
import {
  mean,
  percentile,
  pushWindow,
  samplesPerSecond,
  shortUserAgent,
  type ScanDebugSnapshot,
} from "./debugStats";
import { createPaperEdgeQuadSource, type SheetQuadSource } from "./quad-source";
import {
  INITIAL_HAND_CHIP_STATE,
  applyDetectedHandedness,
  canToggleHandChip,
  handChipAccessibleName,
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
import { DetectorProgress } from "./DetectorProgress";
import {
  measuredSheetNumbers,
  UNVERIFIED_MEASUREMENT_NOTE,
} from "../photo/unverified-note";
import "../../app/scan/scan.css";
import "./camera.css";
import "./easy-scan.css";

type GripStyle = "palm" | "claw" | "fingertip";

/** What the frozen photo needs to be drawn where the live frame was. */
interface PhotoInfo {
  /** The object URL this belongs to. */
  readonly url: string;
  /** The still's own size, EXIF orientation applied. */
  readonly still: Size;
  /** What the live frame's size was, or `null` for an uploaded photo. */
  readonly stream: Size | null;
}

/** The track as the focus code sees it (see focus.ts). */
function asFocusTrack(track: MediaStreamTrack): FocusTrackLike {
  return {
    getCapabilities: () => track.getCapabilities?.() ?? {},
    getSettings: () => track.getSettings?.() ?? {},
    applyConstraints: (constraints) =>
      track.applyConstraints(constraints as MediaTrackConstraints),
  };
}

/** The stream's frame size: the <video>'s own (what `object-fit: cover` cropped), else the track's settings. */
function readStreamSize(
  video: HTMLVideoElement | null,
  stream: MediaStream | null,
): Size | null {
  if (video && video.videoWidth > 0 && video.videoHeight > 0)
    return { width: video.videoWidth, height: video.videoHeight };
  let settings: MediaTrackSettings | undefined;
  try {
    settings = stream?.getVideoTracks()[0]?.getSettings?.();
  } catch {
    settings = undefined;
  }
  return settings?.width && settings.height
    ? { width: settings.width, height: settings.height }
    : null;
}

/** A photo's natural size (EXIF orientation applied), decoding it once so the browser has it ready. `null` if it will not decode. */
async function loadStillSize(url: string): Promise<Size | null> {
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image.naturalWidth > 0 && image.naturalHeight > 0
      ? { width: image.naturalWidth, height: image.naturalHeight }
      : null;
  } catch {
    return null;
  }
}

/** Live numbers for the debug panel (`?debug=1`): written by the loop, read by a timer. */
interface DebugLive {
  sampleTimes: number[];
  detectMs: number[];
  laplacian: number | null;
  steady: boolean | null;
  movement: number | null;
  cornersSeen: number | null;
  cueCode: CueCode | null;
}
interface DebugCapture {
  method: "takePhoto" | "canvas" | "upload" | null;
  stillWidth: number | null;
  stillHeight: number | null;
  stillKb: number | null;
  ringCompleteToFrozenMs: number | null;
}

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
      aria-label={handChipAccessibleName(state)}
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
  /**
   * What the server took this device for, from its user agent alone
   * (`detectDeviceFit`, the same function the client uses): only used to give
   * the pre-mount placeholder the colour of the screen that will replace it.
   */
  readonly deviceHint?: DeviceFit;
  /** Forces the first-run tip open regardless of localStorage — for
   * `/scan/easy/tip-demo` (screenshot only). */
  readonly forceTipOpen?: boolean;
}

export default function EasyScanCamera({
  runPhotoPipelineImpl = runPhotoPipeline,
  demoMeasured,
  deviceHint,
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
  const [cornerStates, setCornerStates] = useState<CornerStates>(
    INITIAL_CORNER_STATES,
  );
  const [ringFraction, setRingFraction] = useState(0);
  const [flashKey, setFlashKey] = useState(0);
  const [announced, setAnnounced] = useState("");
  // The stage is the whole screen and never changes shape (scan v2): its
  // size is measured only to place the guide and the frozen photo.
  const [stageSize, setStageSize] = useState<Size | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [focusSupport, setFocusSupport] =
    useState<FocusSupport>(NO_FOCUS_SUPPORT);
  const [reticle, setReticle] = useState<{
    x: number;
    y: number;
    n: number;
  } | null>(null);
  // What the frozen photo needs to sit where the live frame was. The demo
  // route hands over a finished photo, so it starts with one.
  const [photoInfo, setPhotoInfo] = useState<PhotoInfo | null>(
    demoMeasured
      ? {
          url: demoMeasured.previewUrl,
          still: {
            width: demoMeasured.imageWidth,
            height: demoMeasured.imageHeight,
          },
          stream: null,
        }
      : null,
  );
  // How tall the bottom sheet is once open, so the photo can clear it.
  const [sheetHeight, setSheetHeight] = useState<number | null>(null);
  // Where the top bar's controls end (they grow with the text size), so the
  // photo is kept clear of them too.
  const [barBottom, setBarBottom] = useState<number | null>(null);
  const topBarRef = useRef<HTMLDivElement | null>(null);
  const [debugOn, setDebugOn] = useState(false);
  const [debugSnapshot, setDebugSnapshot] = useState<ScanDebugSnapshot | null>(
    null,
  );
  const reducedMotion = usePrefersReducedMotion();

  const stageRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const prevSampleQuadRef = useRef<Quad | null>(null);
  const autoCaptureRef = useRef<AutoCaptureState>(INITIAL_AUTO_CAPTURE_STATE);
  const lastSampleTimeRef = useRef(0);
  const lastDetectionAtRef = useRef(0);
  const cornerStatesRef = useRef<CornerStates>(INITIAL_CORNER_STATES);
  const cueDebounceRef = useRef<CueDebounceState>(INITIAL_CUE_DEBOUNCE_STATE);
  const lastCueCodeRef = useRef<Cue["code"] | null>(null);
  const capturingRef = useRef(false);
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  const focusTrackRef = useRef<FocusTrackLike | null>(null);
  const focusSupportRef = useRef<FocusSupport>(NO_FOCUS_SUPPORT);
  // The pending return to continuous focus after a tap (focus.ts).
  const tapFocusRef = useRef<{ cancel(): void } | null>(null);
  const reticleTimerRef = useRef<number | null>(null);
  const reticleCountRef = useRef(0);
  const debugOnRef = useRef(false);
  const debugLiveRef = useRef<DebugLive>({
    sampleTimes: [],
    detectMs: [],
    laplacian: null,
    steady: null,
    movement: null,
    cornersSeen: null,
    cueCode: null,
  });
  const debugCaptureRef = useRef<DebugCapture>({
    method: null,
    stillWidth: null,
    stillHeight: null,
    stillKb: null,
    ringCompleteToFrozenMs: null,
  });
  const debugTrackRef = useRef<{
    width: number | null;
    height: number | null;
    frameRate: number | null;
  } | null>(null);
  // The <video>'s own size, last seen (the element is gone once a photo is taken).
  const debugVideoSizeRef = useRef<Size | null>(null);
  const debugFocusRef = useRef<{
    continuous: FocusApplyResult | null;
    lastTap: FocusApplyResult | null;
  }>({ continuous: null, lastTap: null });
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
      // Not swallowed: the load state goes to "failed", and DetectorProgress
      // tells the person and offers a retry. A photo taken meanwhile gets the
      // same message from the sheet below.
    });
  }, []);

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
  //
  // A layout effect, so the sheet's height is known before the first paint
  // and the photo starts moving clear of it in the same frame the sheet opens.
  //
  // The height is watched from then on: the sheet grows after it opens (the
  // submit status line, a larger system font, the phone turned), and the photo
  // has to move clear of it again each time.
  useLayoutEffect(() => {
    if (result.kind === "measured" || result.kind === "gateFailure") {
      const dialog = sheetDialogRef.current;
      dialog?.showModal();
      sheetTitleRef.current?.focus();
      const measureBar = () => {
        const bottoms = [
          ...(topBarRef.current?.querySelectorAll("button") ?? []),
        ].map((button) => button.getBoundingClientRect().bottom);
        const bottom = bottoms.length ? Math.max(...bottoms) : null;
        setBarBottom((prev) => (prev === bottom ? prev : bottom));
      };
      setSheetHeight(dialog ? dialog.offsetHeight : null);
      measureBar();
      if (!dialog) return;
      // The pinned row of buttons at the sheet's foot: its height tells the
      // sheet's scroll how far a focused control must be kept clear of it
      // (scroll-padding-bottom in easy-scan.css).
      const actionsRow =
        dialog.querySelector<HTMLElement>(".easyStickyActions");
      const measureActions = () => {
        if (actionsRow)
          dialog.style.setProperty(
            "--easy-actions-height",
            `${actionsRow.offsetHeight}px`,
          );
      };
      measureActions();
      const observer = new ResizeObserver(() => {
        setSheetHeight((prev) =>
          prev === dialog.offsetHeight ? prev : dialog.offsetHeight,
        );
        measureBar();
        measureActions();
      });
      observer.observe(dialog);
      if (actionsRow) observer.observe(actionsRow);
      if (topBarRef.current) observer.observe(topBarRef.current);
      return () => observer.disconnect();
    }
    sheetDialogRef.current?.close();
    setSheetHeight(null);
    setBarBottom(null);
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

  const clearFocusTimers = useCallback(() => {
    tapFocusRef.current?.cancel();
    tapFocusRef.current = null;
    if (reticleTimerRef.current !== null)
      window.clearTimeout(reticleTimerRef.current);
    reticleTimerRef.current = null;
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    clearFocusTimers();
    focusTrackRef.current = null;
    setReticle(null);
  }, [clearFocusTimers]);

  // Reads what the camera says about focus, and puts it in continuous focus
  // where it offers that (Android Chrome). Anything the browser refuses is
  // reported to the debug panel and otherwise ignored.
  const setUpFocus = useCallback((track: MediaStreamTrack) => {
    const focusTrack = asFocusTrack(track);
    let supported: object | undefined;
    try {
      supported = navigator.mediaDevices.getSupportedConstraints?.();
    } catch {
      supported = undefined;
    }
    const support = readFocusSupport(focusTrack, supported);
    let settings: MediaTrackSettings | undefined;
    try {
      settings = track.getSettings?.();
    } catch {
      settings = undefined;
    }
    debugTrackRef.current = {
      width: settings?.width ?? null,
      height: settings?.height ?? null,
      frameRate: settings?.frameRate ?? null,
    };
    focusTrackRef.current = focusTrack;
    focusSupportRef.current = support;
    setFocusSupport(support);
    debugFocusRef.current = { continuous: null, lastTap: null };
    void applyContinuousFocus(focusTrack, support).then((applied) => {
      debugFocusRef.current.continuous = applied;
    });
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

  // Everything the loop carries from sample to sample, and what the screen
  // shows of it (the ring, the cue, the hint under it), back to the start.
  // Used when a loop begins and whenever the camera is asked for again: a
  // camera reopened after a retake must not show the last run's full ring and
  // green "Got it" while it warms up.
  const resetLoopState = useCallback(() => {
    const fresh = freshLiveLoopSampling();
    lastSampleTimeRef.current = fresh.lastSampleAtMs;
    prevSampleQuadRef.current = fresh.prevQuad;
    autoCaptureRef.current = fresh.autoCapture;
    cornerStatesRef.current = INITIAL_CORNER_STATES;
    cueDebounceRef.current = INITIAL_CUE_DEBOUNCE_STATE;
    lastCueCodeRef.current = null;
    setCornerStates(INITIAL_CORNER_STATES);
    setRingFraction(0);
    setCue(null);
    // What a screen reader was last told ("Photo taken", the last cue) is not
    // true of a camera that is starting again.
    setAnnounced("");
  }, []);

  const startCamera = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    camKindRef.current = "requesting";
    resetLoopState();
    setCamState({ kind: "requesting" });
    try {
      const stream = await requestCameraStream(
        navigator.mediaDevices,
        {
          video: {
            facingMode: "environment",
            // The preview only needs to be smooth to analyse; the photo itself
            // comes from takePhoto(), at the sensor's full size.
            width: { ideal: CAMERA_CONSTANTS.focus.previewIdealWidth },
            height: { ideal: CAMERA_CONSTANTS.focus.previewIdealHeight },
            // Prefer the camera's own frame sizes over a browser crop-and-
            // scale to the requested shape: a crop would quietly narrow the
            // field of view and could cut the paper's corners off.
            resizeMode: { ideal: "none" },
          } as MediaTrackConstraints & { resizeMode: { ideal: string } },
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
      });
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) setUpFocus(videoTrack);
      setVideoReady(false);
      resetLoopState();
      lastDetectionAtRef.current = performance.now();
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
  }, [stopStream, setUpFocus, resetLoopState]);

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
      } catch (error) {
        if (runId !== runIdRef.current) return;
        // Only a genuine detector load failure says so; anything else keeps
        // the message that does not claim a cause it does not know.
        const detectorFailed = error instanceof HandLandmarkerLoadError;
        setResult({
          kind: "gateFailure",
          previewUrl,
          overlay: null,
          errors: [
            detectorFailed
              ? {
                  code: "DETECTOR_LOAD_FAILED",
                  message: DETECTOR_LOAD_FAILED_MESSAGE,
                }
              : {
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
    const firedAt = performance.now();
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    const video = videoRef.current;
    // What the live frame was, read before the stream stops: the photo is
    // drawn with the same crop.
    const streamSize = readStreamSize(video, streamRef.current);
    let file: File;
    let method: "takePhoto" | "canvas" = "takePhoto";
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
      method = "canvas";
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

    const previewUrl = URL.createObjectURL(file);
    // The camera keeps running while the photo is decoded, so the swap from
    // live picture to frozen picture happens in one step, under the flash.
    const still = await loadStillSize(previewUrl);
    stopStream();
    if (typeof navigator.vibrate === "function") {
      navigator.vibrate(CAMERA_CONSTANTS.autoCapture.vibrateMs);
    }
    if (!reducedMotionRef.current) setFlashKey((k) => k + 1);
    setAnnounced("Photo taken");
    fileRef.current = file;
    setPhotoInfo(still ? { url: previewUrl, still, stream: streamSize } : null);
    debugCaptureRef.current = {
      method,
      stillWidth: still?.width ?? null,
      stillHeight: still?.height ?? null,
      stillKb: file.size / 1024,
      ringCompleteToFrozenMs: null,
    };
    capturingRef.current = false;
    void runPipeline(file, previewUrl);
    // Two frames on, the frozen picture has been painted.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        debugCaptureRef.current.ringCompleteToFrozenMs =
          performance.now() - firedAt;
      }),
    );
  }, [stopStream, runPipeline]);

  const onFilePicked = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      stopStream();
      fileRef.current = file;
      const previewUrl = URL.createObjectURL(file);
      setPhotoInfo(null);
      debugCaptureRef.current = {
        method: "upload",
        stillWidth: null,
        stillHeight: null,
        stillKb: file.size / 1024,
        ringCompleteToFrozenMs: null,
      };
      void loadStillSize(previewUrl).then((still) => {
        if (still) setPhotoInfo({ url: previewUrl, still, stream: null });
      });
      void runPipeline(file, previewUrl);
    },
    [stopStream, runPipeline],
  );

  const retake = useCallback(() => {
    if (result.kind !== "none") URL.revokeObjectURL(result.previewUrl);
    setResult({ kind: "none" });
    setPhotoInfo(null);
    // Also where no camera starts again (an upload-only screen).
    setAnnounced("");
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
      return { coverRect };
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
        setCue(null);
        setAnnounced("Hand flat, fingers together, phone straight above");
        return;
      }

      let detection;
      const detectStartedAt = performance.now();
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
      const detectMs = performance.now() - detectStartedAt;
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

      // The ring reads the raw sample: one or two failures pause it, the
      // third in a row empties it (autoCapture.ts).
      autoCaptureRef.current = advanceAutoCapture(
        autoCaptureRef.current,
        nextCue.allPass,
        dtMs,
      );
      setRingFraction(autoCaptureRingFraction(autoCaptureRef.current));

      if (debugOnRef.current) {
        const live = debugLiveRef.current;
        live.sampleTimes = pushWindow(live.sampleTimes, now);
        live.detectMs = pushWindow(live.detectMs, detectMs);
        live.laplacian = laplacianVariance;
        live.steady = sampleQuad ? steady : null;
        live.movement =
          sampleQuad && prevSampleQuadRef.current
            ? computeMaxCornerMovement(prevSampleQuadRef.current, sampleQuad) /
              frameDiagonal
            : null;
        live.cornersSeen = detection.cornersSeen;
        live.cueCode = nextCue.code;
        debugVideoSizeRef.current = {
          width: video.videoWidth,
          height: video.videoHeight,
        };
      }
      prevSampleQuadRef.current = sampleQuad;

      // The dots: each corner filtered on its own, in stage pixels. One that
      // was not found keeps its last position (cornerSmoother.ts).
      if (stageInfo) {
        const { coverRect } = stageInfo;
        const observe = (i: 0 | 1 | 2 | 3): Point | null => {
          const p = detection.partialCorners[i];
          return p && detection.cornersFound[i]
            ? mapMediaPointToContainer(p, coverRect, width, height)
            : null;
        };
        cornerStatesRef.current = advanceCorners(
          cornerStatesRef.current,
          [observe(0), observe(1), observe(2), observe(3)],
          dtMs,
        );
        setCornerStates(cornerStatesRef.current);
      }

      // The words are debounced (cueDebounce.ts): the cue on screen changes
      // only when the debounce says so.
      cueDebounceRef.current = advanceCueDebounce(
        cueDebounceRef.current,
        nextCue.code,
        now,
      );
      const shownCode = cueDebounceRef.current.shown;
      if (shownCode !== null && shownCode !== lastCueCodeRef.current) {
        lastCueCodeRef.current = shownCode;
        const shownCue =
          shownCode === nextCue.code ? nextCue : cueFromCode(shownCode);
        setCue(shownCue);
        setAnnounced(
          easyCueText(shownCue, {
            tapToFocus: focusSupportRef.current.tapToFocus,
          }),
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

  // The stage exists on the phone's camera screen and behind the bottom
  // sheet; it is never resized (scan v2), only measured.
  const showStage =
    (deviceFit !== null || Boolean(demoMeasured)) &&
    (result.kind !== "none" ||
      (!lengthStep &&
        (camState.kind === "live" || camState.kind === "requesting")));
  useLayoutEffect(() => {
    if (!showStage) return;
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const box = el.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return;
      setStageSize((prev) =>
        prev && prev.width === box.width && prev.height === box.height
          ? prev
          : { width: box.width, height: box.height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [showStage]);

  // Tap to focus (Android Chrome and others that report it; nowhere else does
  // a tap do anything): single-shot focus at the tapped point, the reticle
  // there, and continuous focus again shortly after.
  const onStageTap = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const support = focusSupportRef.current;
      const focusTrack = focusTrackRef.current;
      const video = videoRef.current;
      if (
        !support.tapToFocus ||
        !focusTrack ||
        !video ||
        resultRef.current.kind !== "none" ||
        camKindRef.current !== "live"
      )
        return;
      const box = e.currentTarget.getBoundingClientRect();
      const tap = { x: e.clientX - box.left, y: e.clientY - box.top };
      const point = tapToVideoPoint(tap, box, {
        width: video.videoWidth,
        height: video.videoHeight,
      });
      if (!point) return;
      clearFocusTimers();
      reticleCountRef.current += 1;
      setReticle({ ...tap, n: reticleCountRef.current });
      reticleTimerRef.current = window.setTimeout(
        () => setReticle(null),
        CAMERA_CONSTANTS.focus.tapRefocusMs + 300,
      );
      tapFocusRef.current = focusOnceThenContinuous(
        focusTrack,
        support,
        point,
        CAMERA_CONSTANTS.focus.tapRefocusMs,
        {
          onTap: (applied) => {
            debugFocusRef.current.lastTap = applied;
          },
          onContinuous: (applied) => {
            debugFocusRef.current.continuous = applied;
          },
        },
      );
    },
    [clearFocusTimers],
  );

  // The debug panel (`/scan/easy?debug=1`): numbers only, kept in refs by the
  // loop and copied to state four times a second while the panel is shown.
  const buildDebugSnapshot = useCallback((): ScanDebugSnapshot => {
    const live = debugLiveRef.current;
    const capture = debugCaptureRef.current;
    const support = focusSupportRef.current;
    const videoSize = debugVideoSizeRef.current;
    const trackInfo = debugTrackRef.current;
    return {
      userAgent: shortUserAgent(navigator.userAgent),
      track: trackInfo
        ? {
            ...trackInfo,
            videoWidth: videoSize?.width ?? null,
            videoHeight: videoSize?.height ?? null,
          }
        : null,
      capabilities: trackInfo
        ? {
            focusMode: support.focusModes,
            pointsOfInterest: {
              inCapabilities: support.pointsOfInterestIn.capabilities,
              inSettings: support.pointsOfInterestIn.settings,
              inSupportedConstraints:
                support.pointsOfInterestIn.supportedConstraints,
            },
            zoom: support.zoom,
            tapToFocus: support.tapToFocus,
          }
        : null,
      focusApplied: {
        continuous: debugFocusRef.current.continuous,
        lastTap: debugFocusRef.current.lastTap,
      },
      live: {
        samplesPerSecond: samplesPerSecond(live.sampleTimes),
        detectionMsAverage: mean(live.detectMs),
        detectionMsP95: percentile(live.detectMs, 95),
        laplacianVariance: live.laplacian,
        laplacianFloor: CAMERA_CONSTANTS.steadiness.minLiveLaplacianVariance,
        steady: live.steady,
        maxCornerMovementFractionOfDiagonal: live.movement,
        cornersSeen: live.cornersSeen,
        cueCode: live.cueCode,
        cueShown: cueDebounceRef.current.shown,
        ringFraction: autoCaptureRingFraction(autoCaptureRef.current),
        consecutiveFailures: autoCaptureRef.current.failStreak,
      },
      capture: {
        method: capture.method,
        stillWidth: capture.stillWidth,
        stillHeight: capture.stillHeight,
        stillKb: capture.stillKb,
        ringCompleteToFrozenMs: capture.ringCompleteToFrozenMs,
      },
    };
  }, []);
  useEffect(() => {
    const on = new URLSearchParams(window.location.search).get("debug") === "1";
    debugOnRef.current = on;
    setDebugOn(on);
    if (!on) return;
    setDebugSnapshot(buildDebugSnapshot());
    const timer = window.setInterval(
      () => setDebugSnapshot(buildDebugSnapshot()),
      400,
    );
    return () => window.clearInterval(timer);
  }, [buildDebugSnapshot]);

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

  const cueLabel = cue
    ? easyCueText(cue, { tapToFocus: focusSupport.tapToFocus })
    : "Point the camera at the paper";
  const hintText =
    userLengthMm !== null
      ? ""
      : easyHintText({
          cueCode: cue?.code ?? null,
          ringFraction,
          tapToFocus: focusSupport.tapToFocus,
        });

  // Null while the typed-hand-length feature flag is off: every "no paper"
  // entry below renders only when this is non-null.
  const noPaperLabel = noPaperEntryLabel(userLengthMm !== null);
  const noPaperMode = userLengthMm !== null;

  // The device is only known after mount. Until then show a neutral screen
  // rather than the dark camera UI, which a desktop or in-app browser would
  // see flash before its own entry screen replaces it.
  if (deviceFit === null && !demoMeasured)
    return (
      <main
        className="easyDevicePlaceholder"
        data-device-hint={deviceHint}
        aria-busy="true"
      >
        <h1 className="visuallyHidden">Scan your hand</h1>
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

  // Derived values for the frozen photo: where it is drawn, and where it goes once measured.
  const photoForResult =
    result.kind !== "none" && photoInfo?.url === result.previewUrl
      ? photoInfo
      : null;
  const stillSize: Size | null =
    photoForResult?.still ??
    (result.kind !== "none" &&
    result.kind !== "processing" &&
    result.imageWidth > 0 &&
    result.imageHeight > 0
      ? { width: result.imageWidth, height: result.imageHeight }
      : null);
  const frozenLayout =
    result.kind !== "none" && stillSize && stageSize
      ? computeFrozenPhotoLayout({
          stage: stageSize,
          stream: photoForResult?.stream ?? null,
          still: stillSize,
        })
      : null;
  const resultOverlay =
    result.kind === "measured" || result.kind === "gateFailure"
      ? result.overlay
      : null;
  const overlayToStill =
    resultOverlay && resultOverlay.imageWidth > 0 && stillSize
      ? stillSize.width / resultOverlay.imageWidth
      : 1;
  // Once measured (or failed) the photo scales down and moves up, by a
  // transform, until nothing is under the bottom sheet.
  const measuredTransform =
    (result.kind === "measured" || result.kind === "gateFailure") &&
    frozenLayout &&
    stageSize &&
    sheetHeight !== null
      ? computeMeasuredTransform({
          stage: stageSize,
          focus: computeResultFocusRect({
            stage: stageSize,
            layout: frozenLayout,
            overlayToStill,
            overlay: resultOverlay,
            // The labels sit inside the paper; without a paper they hang off
            // the hand, which needs more room.
            labelAllowancePx: resultOverlay?.paperCorners?.length ? 20 : 48,
          }),
          sheetTop: stageSize.height - sheetHeight,
          barBottom: barBottom ?? undefined,
        })
      : null;
  const layerScale = measuredTransform?.scale ?? 1;
  const unitsPerPx = frozenLayout
    ? overlayUnitsPerPx(frozenLayout, overlayToStill, layerScale)
    : 1;
  const dimensions: readonly DimensionSpec[] | null =
    result.kind === "measured" && result.overlay.landmarksPx
      ? [
          {
            a: result.overlay.landmarksPx[0],
            b: result.overlay.landmarksPx[LANDMARK.middle[3]],
            label:
              "method" in result.submission.calibration &&
              result.submission.calibration.method === "user-length"
                ? `Entered ${result.submission.calibration.referenceMm} mm`
                : `Hand ${result.measurements.handLengthMm.toFixed(0)} mm`,
            side: 1,
          },
          {
            a: result.overlay.landmarksPx[LANDMARK.index[0]],
            b: result.overlay.landmarksPx[LANDMARK.pinky[0]],
            label: `Palm ${result.measurements.palmWidthMm.toFixed(0)} mm`,
            side: 1,
          },
        ]
      : null;
  const problem =
    result.kind === "gateFailure"
      ? problemAreaFor(result.errors[0]?.code, result.overlay, 18 * unitsPerPx)
      : null;
  const guide = stageSize
    ? rectCorners(computeGuideRect(stageSize, paperAspect(paperSize)))
    : null;
  // The dots stay through processing on a camera photo (the paper is where
  // they are); an uploaded photo never had them.
  const showCorners =
    userLengthMm === null &&
    stageSize !== null &&
    (result.kind === "none" || photoForResult?.stream != null);

  // Under reduced motion the photo does not slide: the moved picture fades in
  // over the unmoved one, which stays fully visible until it is covered, so
  // there is never a moment with the picture transparent.
  const crossFade =
    reducedMotion &&
    measuredTransform !== null &&
    (result.kind === "measured" || result.kind === "gateFailure");
  const moveStyle =
    measuredTransform && stageSize
      ? {
          // Scale about the middle of the stage (the layer itself has no
          // height: see .easyStageContent in the CSS).
          transformOrigin: `50% ${stageSize.height / 2}px`,
          transform: `translateY(${measuredTransform.translateY}px) scale(${measuredTransform.scale})`,
        }
      : undefined;
  // `measuredView` false draws the photo as it was while processing (nothing
  // drawn on it yet, at full size): the layer the moved one fades in over.
  const renderPhoto = (measuredView: boolean) =>
    result.kind !== "none" && frozenLayout && stillSize ? (
      <FrozenPhoto
        previewUrl={result.previewUrl}
        still={stillSize}
        layout={frozenLayout}
        phase={measuredView ? result.kind : "processing"}
        overlay={measuredView ? resultOverlay : null}
        overlayToStill={overlayToStill}
        layerScale={measuredView ? layerScale : 1}
        dimensions={measuredView ? dimensions : null}
        problem={measuredView ? problem : null}
        ariaLabel={
          noPaperMode
            ? "Your photo with, once measured, the hand-length and palm-width lines"
            : "Your photo with the paper corners and, once measured, the hand-length and palm-width lines"
        }
      />
    ) : null;

  return (
    <main
      className={`cameraViewfinder easyScanShell${showStage ? " easyScanStaged" : ""}`}
    >
      <h1 className="visuallyHidden">Scan your hand</h1>
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
      {showStage && (
        <div
          className="cameraFrame easyStage"
          ref={stageRef}
          data-phase={result.kind}
          onClick={onStageTap}
        >
          <div
            key="base"
            className={`easyStageContent${crossFade ? " leaving" : measuredTransform ? " moved" : ""}`}
            style={crossFade ? undefined : moveStyle}
          >
            {result.kind === "none" ? (
              <video
                ref={videoRef}
                className={`cameraVideo${videoReady ? " ready" : ""}`}
                muted
                playsInline
                autoPlay
                onPlaying={() => setVideoReady(true)}
              />
            ) : (
              renderPhoto(!crossFade)
            )}
            {showCorners && guide && (
              <div className="cameraOverlay">
                <EasyCorners
                  states={cornerStates}
                  guide={guide}
                  hidden={
                    (result.kind === "measured" ||
                      result.kind === "gateFailure") &&
                    !crossFade
                  }
                />
              </div>
            )}
          </div>
          {crossFade && (
            <div
              key="moved"
              className="easyStageContent moved"
              style={moveStyle}
            >
              {renderPhoto(true)}
            </div>
          )}
          {result.kind === "processing" && <div className="easyStageDim" />}
          {result.kind === "processing" && !reducedMotion && (
            <div className="easyScanLine" data-testid="easy-scan-line" />
          )}
          {flashKey > 0 && !reducedMotion && (
            <div
              key={flashKey}
              className="easyFlash"
              data-testid="easy-flash"
            />
          )}
          {reticle && (
            <div
              key={reticle.n}
              className="easyReticle"
              data-testid="focus-reticle"
              aria-hidden="true"
              style={{
                transform: `translate3d(${reticle.x - 44}px, ${reticle.y - 44}px, 0)`,
              }}
            >
              <span className="easyReticleBox" />
            </div>
          )}
        </div>
      )}
      <div className="cameraTopBar" ref={topBarRef} inert={lengthStep}>
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
      {/* After the top bar, so where a card is laid out in flow (refused or
          no camera) the notice joins that flow above it. */}
      <DetectorProgress inert={lengthStep} />

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
          <h2 id="easy-length-title" ref={lengthHeadingRef} tabIndex={-1}>
            Hand length
          </h2>
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
            <div className="easyBottomDock">
              {hintText && (
                <p className="easyHint" data-testid="easy-hint">
                  {hintText}
                </p>
              )}

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
                >
                  <span className="visuallyHidden">Upload a photo instead</span>
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
            </div>
          </>
        )}

      <input
        id="easy-scan-upload"
        type="file"
        accept="image/*"
        onChange={onFilePicked}
        className="visuallyHidden"
        inert={lengthStep}
        // Matches the visible label of whichever upload control is on screen
        // ("Upload a photo" on the no-camera screen, "Upload a photo instead"
        // beside a camera), and stays right in the states with none.
        aria-label={
          camState.kind === "noCamera"
            ? "Upload a photo"
            : "Upload a photo instead"
        }
      />

      {result.kind === "processing" && (
        <p className="easyProcessingPill" aria-live="polite">
          Measuring your hand…
        </p>
      )}

      {(result.kind === "measured" || result.kind === "gateFailure") && (
        <dialog
          ref={sheetDialogRef}
          className="easySheet easyResultSheet"
          // Not a stop of its own: a scrolling dialog is otherwise a focusable
          // scroller, and Tab after the last button landed on the dialog.
          tabIndex={-1}
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
              <p className="easySheetNumbers" data-testid="easy-sheet-numbers">
                {measuredSheetNumbers(
                  result.measurements,
                  result.submission.calibration,
                )}
              </p>
              <p className="easySheetNote">{UNVERIFIED_MEASUREMENT_NOTE}</p>
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
              <div className="easySheetActions easyStickyActions">
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
              <div className="easyStickyActions">
                <button
                  type="button"
                  className="primaryButton easyTryAgainButton"
                  ref={tryAgainRef}
                  onClick={retake}
                >
                  Try again
                </button>
                {noPaperLabel &&
                  failureOffersLengthEdit(
                    noPaperMode,
                    result.errors[0]?.code,
                  ) && (
                    <button
                      type="button"
                      className="easyEditLengthButton"
                      onClick={editLengthFromFailure}
                    >
                      {EDIT_HAND_LENGTH_LABEL}
                    </button>
                  )}
              </div>
            </>
          )}
          {/* A modal sheet makes the rest of the page inert, so the debug
              numbers (and their copy button) are also reachable from here. */}
          {debugOn && debugSnapshot && (
            <details className="easyDebugDetails">
              <summary>Debug</summary>
              <ScanDebugPanel snapshot={debugSnapshot} />
            </details>
          )}
        </dialog>
      )}

      <dialog
        ref={tipDialogRef}
        className="easySheet easyTipSheet"
        tabIndex={-1}
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
      {debugOn &&
        debugSnapshot &&
        result.kind !== "measured" &&
        result.kind !== "gateFailure" && (
          <ScanDebugPanel snapshot={debugSnapshot} />
        )}
    </main>
  );
}
