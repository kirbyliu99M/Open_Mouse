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
 * lines + "Continue", which opens the two optional question pages, grip
 * and palm thickness, and the scan is sent from the last one) or a gate
 * failure (its one fix
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
  useReducer,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/client/i18n/LocaleProvider";
import { cameraCuesCopy } from "../../lib/copy/camera-cues";
import { easyScanCopy } from "../../lib/copy/easy-scan";
import { scanCommonCopy } from "../../lib/copy/scan-common";
import { issueText } from "../photo/issueText";
import { HAND_BUTTON_FIX_INSTRUCTION } from "../photo/issue-detail";
import type {
  PaperSize,
  ScanSubmission,
} from "../../lib/contracts/measurement";
import { LANDMARK } from "../../lib/contracts/measurement";
import { computeDownscaleSize } from "../photo/decode";
import { rgbaToGrayscale, computeLaplacianVariance } from "../photo/sharpness";
import {
  DETECTOR_LOAD_FAILED_MESSAGE,
  getHandLandmarker,
  HandLandmarkerLoadError,
  isHandLandmarkerReady,
  readLiveHandPoints,
} from "../photo/landmarks";
import {
  runPhotoPipeline,
  type PhotoOverlay,
  type PipelineIssue,
  type RunPhotoPipelineInput,
  type PipelineResult,
} from "../photo/pipeline";
import type { HandMeasurements } from "../../lib/contracts/measurement";
import {
  CAMERA_CONSTANTS,
  PAPER_SIZE_LABELS,
  captureSource,
} from "./constants";
import {
  cueFromCode,
  easyCueText,
  easyHintText,
  pickCue,
  type Cue,
  type CueCode,
} from "./cues";
import { requestCameraStream } from "./requestStream";
import {
  isCameraPermissionDenial,
  reportCaught,
} from "@/lib/observability/report";
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
  resetAutoCapture,
  autoCaptureRingFraction,
  type AutoCaptureState,
} from "./autoCapture";
import {
  EMPTY_HAND_READINGS,
  INITIAL_NO_SHEET_CAPTURE_STATE,
  advanceNoSheetCapture,
  liveHandSignal,
  livePalmHint,
  liveHandHint,
  recordHandReading,
  sheetFoundByCue,
  shouldSampleHand,
  type HandReadings,
  type NoSheetCaptureState,
} from "./noSheetCapture";
import {
  advanceCaptureFailures,
  captureFailureHintText,
  hintUnderViewfinder,
  shouldShowCaptureFailureHint,
  type CaptureFailureEvent,
} from "./captureFailure";
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
  computeOverlayToStill,
  computeResultFocusRect,
  overlayUnitsPerPx,
  paperAspect,
  rectCorners,
  type Size,
} from "./photoLayout";
import { problemAreaFor } from "./problemArea";
import { FrozenPhoto, type DimensionSpec } from "./FrozenPhoto";
import { EasyCorners } from "./EasyCorners";
import {
  advanceOutline,
  INITIAL_OUTLINE_HYSTERESIS_STATE,
  type OutlineHysteresisState,
} from "./outlineHysteresis";
import { PaperAdjust, type PaperAdjustConfirm } from "./PaperAdjust";
import type { ReusedFocal } from "../geometry/parallax";
import {
  adjustConfirmAction,
  adjustEntryFor,
  adjustOpensDirectly,
  adjustWarningFor,
  confirmCornerCheck,
  paperCurledNoteFor,
  reusableFocal,
  reusedFocalFor,
  pipelinePaperInput,
  type AdjustEntry,
  type PlacedFrame,
} from "./paperAdjustState";
import { paperAdjustCopy } from "../../lib/copy/paper-adjust";
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
import {
  assumedSampleFocalPx,
  frameDrawArgs,
  frameFocalReferenceWidthPx,
  frameNominalReferenceLongEdgePx,
  visibleRegionInStream,
  type PixelRect,
} from "./visibleView";
import {
  alignAndSettle,
  framePreviewConstraints,
  isPortraitViewport,
  previewConstraintsFor,
  type PreviewAlignment,
  type PreviewTrackLike,
} from "./previewConstraints";
import {
  buildAttemptRecord,
  readAttempts,
  recordAttempt,
  type AttemptCapture,
  type AttemptCaptureSource,
  type AttemptOutcome,
  type AttemptRecord,
} from "./attemptLog";
import {
  createPaperEdgeQuadSource,
  NO_QUAD_DETECTION,
  type SheetQuadDetection,
  type SheetQuadSource,
} from "./quad-source";
import { evaluateLivePaperGate } from "./paperGate";
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
import { GripPage, ThicknessPage } from "../scan/AnswerPages";
import {
  INITIAL_ANSWERS,
  answersReducer,
  buildManualAnswersSubmission,
  buildSubmission,
} from "../scan/answers";
import {
  ManualEntryHandle,
  ManualEntrySheet,
  type ManualEntryValues,
} from "../../components/scan/ManualEntrySheet";
import { manualEntryCopy } from "../../lib/copy/manualEntry";
import { EMPTY_DRAFT, type ManualEntryDraft } from "../../lib/scan/manualEntry";
import { useScanSubmit } from "../scan/useScanSubmit";
import { scanAnswersCopy } from "../../lib/copy/scan-answers";
import { HandIcon, CheckIcon, HelpCircleIcon } from "./icons";
import { track } from "../analytics/track";
import { clampAttempt } from "../analytics/props";
import {
  buildScanQuality,
  buildScanRejected,
  liveWaitBucket,
} from "../analytics/scanQuality";
import { detectDeviceFit, type DeviceFit } from "./deviceFit";
import { DeviceEntry } from "./DeviceEntry";
import {
  parseUserLength,
  USER_LENGTH_RANGE_MM,
  userLengthRangeMessage,
} from "../photo/user-length";
import { failureOffersLengthEdit, noPaperEntryLabel } from "./noPaperEntry";
import { freshLiveLoopSampling, sampleElapsedMs } from "./liveLoop";
import { DetectorProgress } from "./DetectorProgress";
import { measuredSheetNumbers } from "../photo/unverified-note";
import { shownScanMeasurements } from "../../lib/fit/fit-scale";
import { measuringShown } from "./measuringIndicator";
import "../../app/scan/scan.css";
import "./camera.css";
import "./easy-scan.css";

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

/** The track as the preview alignment sees it (previewConstraints.ts). */
function asPreviewTrack(track: MediaStreamTrack): PreviewTrackLike {
  return {
    getSettings: () => track.getSettings?.() ?? {},
    applyConstraints: (constraints) =>
      track.applyConstraints(constraints as MediaTrackConstraints),
  };
}

/**
 * What a capture or an upload knew about itself when it was made, kept for the
 * attempt log (attemptLog.ts). An uploaded file's size arrives when the
 * browser has decoded it, which can be after the analysis starts, so that part
 * is a promise the log waits for.
 */
interface CaptureInfo extends AttemptCapture {
  stillSize?: Promise<Size | null>;
  /**
   * What the person saw: the stream's size and the part of it that was on
   * screen. Set for a camera capture (`takePhoto` or a canvas frame), absent for
   * an upload, which has no viewfinder.
   */
  previewView?: { stream: Size; visibleInStream: PixelRect };
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
  /** The part of the stream the live loop sampled (the part on screen), and the sample's size. */
  visibleInStream: PixelRect | null;
  sample: Size | null;
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
  source: AttemptCaptureSource | null;
  stillWidth: number | null;
  stillHeight: number | null;
  stillKb: number | null;
  ringCompleteToFrozenMs: number | null;
}

interface ImageCaptureLike {
  takePhoto(): Promise<Blob>;
  getPhotoCapabilities(): Promise<unknown>;
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
  | { kind: "cameraError"; blocked: boolean }
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
      /**
       * The frame the person placed for this run, if any (F7): the
       * adjustment opens again with it after the run was turned back.
       */
      placedFrame?: PlacedFrame | null;
    };

/** The screen with no photo and no result: the live camera (or the entry screen). */
const NO_RESULT: ResultState = { kind: "none" };

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
  const locale = useLocale();
  return (
    <button
      type="button"
      className={`easyHandChip${inSheet ? " easyHandChipInSheet" : ""}`}
      aria-label={handChipAccessibleName(state, locale)}
      disabled={disabled}
      onClick={onClick}
    >
      <HandIcon width={16} height={16} /> {handChipLabel(state, locale)}
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
  const locale = useLocale();
  // The live loop and the capture callbacks outlive a render: they read the
  // locale through a ref, so they need not be rebuilt when it changes.
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const common = scanCommonCopy(locale);
  const easy = easyScanCopy(locale);
  // The shutter has a photo that `runPipeline` has not taken on yet (F10,
  // Kirby's second phone test 2026-10-21/22: "拍照掃描不需要 loading 畫面"):
  // the small 測量中… line is already on the frozen photo, from the frame the
  // photo exists; the analysis keeps it there (`processing`) until the answer
  // replaces it. No full-screen loader and no minimum time (`measuringShown`).
  const [shutterMeasuring, setShutterMeasuring] = useState(false);
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
  // The two optional questions after the measured sheet (grip, palm
  // thickness): which page is open and what was answered. The scan is sent
  // from the last page, once both answers are in place (answers.ts).
  const [answers, dispatchAnswers] = useReducer(
    answersReducer,
    INITIAL_ANSWERS,
  );
  const {
    state: submitState,
    submit: submitScanNow,
    busy: submitBusy,
    clearError: clearSubmitError,
  } = useScanSubmit(demoMeasured ? undefined : "easy");
  // Typing the hand length and width instead of scanning (manual entry,
  // candidate, 2026-10-12). The draft outlives the form, so a sheet closed by
  // accident, or 返回 from the grip page, finds what was typed. `manualValues`
  // is the confirmed pair while the grip and thickness pages are open over it
  // (it is null on the form itself and in every scan flow).
  // A ref, not state: the form tells it after every keystroke, and nothing
  // here draws it (the sheet and the panel read it once, when they mount).
  const manualDraftRef = useRef<ManualEntryDraft>(EMPTY_DRAFT);
  const keepManualDraft = useCallback((draft: ManualEntryDraft) => {
    manualDraftRef.current = draft;
  }, []);
  const [manualValues, setManualValues] = useState<ManualEntryValues | null>(
    null,
  );
  const [manualSheetOpen, setManualSheetOpen] = useState(false);
  const manualHandleRef = useRef<HTMLButtonElement>(null);
  const manualMode = manualValues !== null;
  // The form or the question pages are over the camera: its loop (and the
  // auto-shutter) waits, so a photo is never taken behind them.
  const manualActive = manualSheetOpen || manualMode;
  // Read by the capture and the pipeline, which outlive a render: once the
  // form (or the pages after it) is open, no photo is taken and no late result
  // is taken in.
  const manualActiveRef = useRef(false);
  manualActiveRef.current = manualActive;
  const [tipOpen, setTipOpen] = useState(Boolean(forceTipOpen));
  const [cue, setCue] = useState<Cue | null>(null);
  const [cornerStates, setCornerStates] = useState<CornerStates>(
    INITIAL_CORNER_STATES,
  );
  const [ringFraction, setRingFraction] = useState(0);
  const [flashKey, setFlashKey] = useState(0);
  const [announced, setAnnounced] = useState("");
  // Consecutive failed frame captures (captureFailure.ts): the number lives in
  // the ref for the capture callback, and in state for the cue line.
  const captureFailuresRef = useRef(0);
  const [captureFailures, setCaptureFailures] = useState(0);
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
  // F14 (candidate): the second way the shutter fires by itself, when the
  // paper checks do not pass but a hand is held still (noSheetCapture.ts),
  // and the two readings of the hand it goes by.
  const noSheetCaptureRef = useRef<NoSheetCaptureState>(
    INITIAL_NO_SHEET_CAPTURE_STATE,
  );
  const handReadingsRef = useRef<HandReadings>(EMPTY_HAND_READINGS);
  const lastSampleTimeRef = useRef(0);
  const lastDetectionAtRef = useRef(0);
  const cornerStatesRef = useRef<CornerStates>(INITIAL_CORNER_STATES);
  // V3.2 F16: the outline's hysteresis, in front of the corner smoother.
  const outlineRef = useRef<OutlineHysteresisState>(
    INITIAL_OUTLINE_HYSTERESIS_STATE,
  );
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
    visibleInStream: null,
    sample: null,
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
    source: null,
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
  // What the preview was asked for and what the camera gave against the
  // photo's shape (previewConstraints.ts), and the attempts kept on this device.
  const previewAlignmentRef = useRef<PreviewAlignment | null>(null);
  // False from the moment a stream starts until its preview has been asked for
  // the photo's shape (previewConstraints.ts): the auto-shutter waits, so a
  // photo is never taken while the camera is being reconfigured.
  const previewSettledRef = useRef(true);
  const alignTokenRef = useRef(0);
  // The wait for the preview ran out before the camera answered.
  const settleTimedOutRef = useRef<boolean | null>(null);
  const attemptsRef = useRef<readonly AttemptRecord[]>([]);
  // This page's analysis count, for analytics only (1-based once incremented).
  const attemptCountRef = useRef(0);
  const captureInfoRef = useRef<CaptureInfo | null>(null);
  // When the live loop first found the sheet's four corners (performance.now()),
  // for the `liveWait` shadow bucket and the attempt log's `liveWaitMs`; `null`
  // until it does, and again whenever the loop starts over (resetLoopState).
  const firstSheetSeenAtRef = useRef<number | null>(null);
  const runIdRef = useRef(0);
  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);
  const camKindRef = useRef<CamState["kind"]>(camState.kind);
  camKindRef.current = camState.kind;
  const resultRef = useRef(result);
  resultRef.current = result;
  const fileRef = useRef<File | null>(null);
  // F10 item 2 (R6 F1, candidate): the focal length the automatic run of the
  // photo on screen used (EXIF or a reliable homography estimate), kept for a
  // frame the person places on that same photo (`reusableFocal`).
  const autoFocalRef = useRef<{
    readonly file: File;
    readonly focal: ReusedFocal;
  } | null>(null);
  // V3.2 F13 (candidate): the detector found the sheet of the photo on screen
  // curled (`PAPER_CURLED`) and the person went on with a frame placed by
  // hand. Kept for that photo (a new automatic run forgets it) and written to
  // this browser only after the scan was stored (`paperCurledNoteFor`).
  const curledBeforeRef = useRef(false);
  const quadSourceRef = useRef<SheetQuadSource>(createPaperEdgeQuadSource());
  const handChipRef = useRef(handChip);
  handChipRef.current = handChip;
  const userLengthRef = useRef(userLengthMm);
  userLengthRef.current = userLengthMm;
  const paperSizeRef = useRef(paperSize);
  paperSizeRef.current = paperSize;

  const sheetDialogRef = useRef<HTMLDialogElement>(null);
  const sheetTitleRef = useRef<HTMLParagraphElement>(null);
  const answerDialogRef = useRef<HTMLDialogElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  // Set when the sheet closes to make room for a question page: its next
  // opening is a return, not an arrival.
  const sheetResumedRef = useRef(false);
  const tipDialogRef = useRef<HTMLDialogElement>(null);
  const helpTriggerRef = useRef<HTMLButtonElement>(null);
  const gotItRef = useRef<HTMLButtonElement>(null);
  const tryAgainRef = useRef<HTMLButtonElement>(null);
  // 手動調整邊框 (V3.2 F2, candidate): which adjustment is open over the photo
  // (the sheet closes under it), and the button that opened it (focus goes
  // back there when it is cancelled).
  const [adjustOpen, setAdjustOpen] = useState<AdjustEntry | null>(null);
  // F14/F15: the adjustment opened by itself (after a paper failure, or on a
  // photo measured from the detector's own corners), with no sheet under it:
  // its way out goes back to the camera.
  const [adjustDirect, setAdjustDirect] = useState(false);
  const adjustButtonRef = useRef<HTMLButtonElement>(null);
  const adjustReturnRef = useRef(false);

  // The attempts kept on this device (attemptLog.ts), read once so the debug
  // panel shows the earlier ones too.
  useEffect(() => {
    attemptsRef.current = readAttempts(getBrowserStorage()) ?? [];
  }, []);

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

  // False while a question page (grip, thickness) is open over the sheet.
  const onSheet = answers.step === "sheet";
  const answersOpen = (result.kind === "measured" || manualMode) && !onSheet;

  // The measured / gate-failure bottom sheet: a native <dialog> for the
  // focus trap + Escape handling, opened the moment the pipeline settles
  // and closed again on retake. Focus goes to the sheet's own heading, not
  // whichever button happens to be first in DOM order (the browser's
  // showModal() default).
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
      // A question page (grip, thickness) is open over the sheet: the sheet
      // closes, but keeps the heights it measured, so the photo behind does not
      // move when 返回 opens it again.
      // The same while the paper frame is being adjusted (V3.2 F2): its own
      // full-screen modal is over the photo.
      if (!onSheet || adjustOpen) {
        sheetResumedRef.current = true;
        if (adjustOpen) adjustReturnRef.current = true;
        dialog?.close();
        return;
      }
      // Coming back from a question page: the sheet does not slide in again
      // (it was there a moment ago), and focus goes to the button that left.
      const resumed = sheetResumedRef.current;
      sheetResumedRef.current = false;
      const fromAdjust = adjustReturnRef.current;
      adjustReturnRef.current = false;
      if (dialog) {
        if (resumed) dialog.dataset.resumed = "true";
        else delete dialog.dataset.resumed;
      }
      dialog?.showModal();
      (fromAdjust
        ? (adjustButtonRef.current ?? sheetTitleRef.current)
        : resumed
          ? continueRef.current
          : sheetTitleRef.current
      )?.focus();
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
  }, [result.kind, onSheet, adjustOpen]);

  // A question page is a modal of its own, opened the moment it mounts, and
  // opened again if the browser closed it by itself while it should be open
  // (see onClose below). A page change starts at the top, so a short phone
  // does not keep the scroll position of the page before.
  useLayoutEffect(() => {
    const dialog = answerDialogRef.current;
    if (!answersOpen || !dialog) return;
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
  }, [answersOpen, answers.step]);

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

  const noteCaptureOutcome = useCallback((event: CaptureFailureEvent) => {
    captureFailuresRef.current = advanceCaptureFailures(
      captureFailuresRef.current,
      event,
    );
    setCaptureFailures(captureFailuresRef.current);
  }, []);

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
    noSheetCaptureRef.current = INITIAL_NO_SHEET_CAPTURE_STATE;
    handReadingsRef.current = EMPTY_HAND_READINGS;
    cornerStatesRef.current = INITIAL_CORNER_STATES;
    outlineRef.current = INITIAL_OUTLINE_HYSTERESIS_STATE;
    cueDebounceRef.current = INITIAL_CUE_DEBOUNCE_STATE;
    lastCueCodeRef.current = null;
    firstSheetSeenAtRef.current = null;
    setCornerStates(INITIAL_CORNER_STATES);
    setRingFraction(0);
    setCue(null);
    // What a screen reader was last told ("Photo taken", the last cue) is not
    // true of a camera that is starting again.
    setAnnounced("");
    noteCaptureOutcome("reset");
  }, [noteCaptureOutcome]);

  const startCamera = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    camKindRef.current = "requesting";
    resetLoopState();
    setCamState({ kind: "requesting" });
    try {
      // What the shutter takes decides what the preview is asked for.
      // As a frame of the video (the default, CAMERA_CONSTANTS.capture.source
      // in constants.ts) the
      // preview is asked for in the camera's own landscape terms, 1920x1080
      // ideal, as it was before #132: the S25 answers that with an upright
      // 1080x1920 and answered the photo-shaped request with a 1088x1088 square.
      // Only when the camera's photo is taken instead (takePhoto, off) is the
      // preview asked for in the photo's shape and re-asked below
      // (previewConstraints.ts): that code is kept, not used.
      const frameCapture = captureSource() === "frame";
      const portrait = isPortraitViewport(
        window.innerWidth,
        window.innerHeight,
      );
      const stream = await requestCameraStream(
        navigator.mediaDevices,
        {
          video: frameCapture
            ? framePreviewConstraints()
            : previewConstraintsFor(
                CAMERA_CONSTANTS.preview.defaultStillAspect,
                portrait,
              ),
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
      if (videoTrack && frameCapture) {
        // Nothing is asked of the camera but focus, and nothing makes the
        // shutter wait: the picture analysed is the frame being shown.
        setUpFocus(videoTrack);
        previewAlignmentRef.current = null;
        previewSettledRef.current = true;
        settleTimedOutRef.current = null;
      } else if (videoTrack) {
        setUpFocus(videoTrack);
        previewAlignmentRef.current = null;
        const alignToken = ++alignTokenRef.current;
        previewSettledRef.current = false;
        settleTimedOutRef.current = null;
        // The shutter waits for the alignment, but not for ever: `settled`
        // opens it after the alignment is done or after the limit, whichever
        // is first. The alignment's own result is still used when it arrives.
        const { alignment: alignmentPromise, settled } = alignAndSettle({
          track: asPreviewTrack(videoTrack),
          ImageCaptureCtor: getImageCaptureCtor(),
          portrait,
        });
        void settled.then(({ settleTimedOut }) => {
          // Only the newest stream's alignment may open the shutter.
          if (alignToken !== alignTokenRef.current) return;
          settleTimedOutRef.current = settleTimedOut;
          previewSettledRef.current = true;
        });
        void alignmentPromise
          .then((alignment) => {
            if (!alignment) return;
            // Not for a stream that has been replaced or stopped meanwhile.
            if (streamRef.current !== stream) return;
            previewAlignmentRef.current = alignment;
            const settings = alignment.settings;
            if (settings && debugTrackRef.current)
              debugTrackRef.current = {
                width: settings.width,
                height: settings.height,
                frameRate:
                  settings.frameRate ?? debugTrackRef.current.frameRate,
              };
            // A size request can reset the camera's focus: ask for continuous
            // focus again once the sizes are settled.
            const focusTrack = focusTrackRef.current;
            if (alignment.sizeRequests > 0 && focusTrack)
              return applyContinuousFocus(
                focusTrack,
                focusSupportRef.current,
              ).then((applied) => {
                if (streamRef.current === stream)
                  debugFocusRef.current.continuous = applied;
              });
          })
          .catch(() => undefined);
      } else {
        previewSettledRef.current = true;
      }
      setVideoReady(false);
      resetLoopState();
      lastDetectionAtRef.current = performance.now();
      track("camera_permission_result", { flow: "easy", result: "granted" });
      setCamState({ kind: "live" });
    } catch (err) {
      if (!isCameraPermissionDenial(err))
        reportCaught(err, "easy-scan.camera-open");
      const name = err instanceof DOMException ? err.name : undefined;
      const blocked =
        name === "NotAllowedError" || name === "PermissionDeniedError";
      if (
        mountedRef.current &&
        requestId === requestIdRef.current &&
        camKindRef.current === "requesting"
      ) {
        track("camera_permission_result", {
          flow: "easy",
          result:
            name === "NotAllowedError" || name === "PermissionDeniedError"
              ? "denied"
              : "error",
        });
        setCamState({ kind: "cameraError", blocked });
      }
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
    track("scan_entry_shown", { flow: "easy", device: fit });
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
      track("camera_permission_result", { flow: "easy", result: "noCamera" });
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

  // Keeps one record of an analysis on this device (attemptLog.ts): numbers
  // and codes only, no image, never sent anywhere. Always on, not only with
  // ?debug=1: the record is the only trace a failed scan leaves, and what it
  // holds is the same few numbers the debug panel shows.
  const logAttempt = useCallback(
    async (info: CaptureInfo | null, outcome: AttemptOutcome) => {
      try {
        const size = info?.stillSize ? await info.stillSize : null;
        const capture: AttemptCapture = {
          method: info?.method ?? null,
          captureSource: info?.captureSource ?? null,
          frame: info?.frame,
          settleTimedOut: info?.settleTimedOut ?? null,
          liveWaitMs: info?.liveWaitMs ?? null,
          photoWidth: size?.width ?? info?.photoWidth ?? null,
          photoHeight: size?.height ?? info?.photoHeight ?? null,
          photoKb: info?.photoKb ?? null,
          previewWidth: info?.previewWidth ?? null,
          previewHeight: info?.previewHeight ?? null,
        };
        attemptsRef.current = recordAttempt(
          getBrowserStorage(),
          buildAttemptRecord({
            at: new Date(),
            userAgent: shortUserAgent(navigator.userAgent),
            capture,
            outcome,
          }),
          attemptsRef.current,
        );
      } catch {
        // The log is a convenience: it must never break a scan.
      }
    },
    [],
  );

  const runPipeline = useCallback(
    async (
      file: File,
      previewUrl: string,
      // A paper frame the person placed on this photo (V3.2 F2): the same
      // analysis, with the frame instead of the detector.
      manualPaperCorners?: RunPhotoPipelineInput["manualPaperCorners"],
    ) => {
      // The typed-size form (or its pages) is open: a photo that arrives now
      // belongs to nothing on screen, and starting it would reset the answers.
      if (manualActiveRef.current) {
        URL.revokeObjectURL(previewUrl);
        setShutterMeasuring(false);
        return;
      }
      const runId = ++runIdRef.current;
      attemptCountRef.current += 1;
      // Read now: a typed length chosen while the photo is analysed must not
      // change it. One reading gives both what the pipeline is told about the
      // paper (with the placed frame, if any) and what the event records.
      const paperInput = pipelinePaperInput({
        typedLengthMm: userLengthRef.current,
        paperSize: paperSizeRef.current,
        manualPaperCorners,
      });
      // A placed frame on the photo whose automatic run had a focal length
      // keeps it (F10 item 2); a new automatic run forgets the old one.
      if (!paperInput.pipeline.manualPaperCorners) autoFocalRef.current = null;
      // It also forgets that the last photo's sheet was curled (F13).
      if (!paperInput.pipeline.manualPaperCorners)
        curledBeforeRef.current = false;
      const reusedFocal = reusedFocalFor({
        placedFrame: Boolean(paperInput.pipeline.manualPaperCorners),
        file,
        auto: autoFocalRef.current,
      });
      const paperUsed = paperInput.paper;
      const attempt = clampAttempt(attemptCountRef.current);
      track("scan_capture_attempted", {
        flow: "easy",
        method: captureInfoRef.current?.method ?? "upload",
        attempt,
        liveWait: liveWaitBucket(captureInfoRef.current?.liveWaitMs),
      });
      // 測量中… stays on the frozen photo while it is analysed (F10): the
      // shutter's flag hands over to `processing`, and the answer is shown
      // the moment it is here (no minimum time, no loader).
      setResult({ kind: "processing", previewUrl });
      setShutterMeasuring(false);
      // Answers belong to the photo they followed.
      dispatchAnswers({ type: "reset" });
      // What this analysis was started with, for both ways it can end: a later
      // capture changes `captureInfoRef` and must not change the record of an
      // earlier analysis still running, whether it finishes or throws.
      const info = captureInfoRef.current;
      try {
        const pipelineResult = await runPhotoPipelineImpl({
          file,
          hand: handChipRef.current.hand,
          handExplicit: handChipRef.current.locked,
          handednessFixInstruction: HAND_BUTTON_FIX_INSTRUCTION,
          // The calibration, and the placed frame only with paper (a typed
          // length has no sheet to frame): `pipelinePaperInput`, read above.
          ...paperInput.pipeline,
          ...(reusedFocal ? { reusedFocal } : {}),
          // A frame of the video is already the part the person saw on
          // screen, so nothing is cropped (no previewView). The camera's own
          // photo (takePhoto, off by default) is cut down to that part before
          // analysis (visibleView.ts); an upload has no viewfinder.
          previewView:
            info?.captureSource === "takePhoto" ? info.previewView : undefined,
          // The frame was cut before the pipeline saw it, so the pipeline is
          // told how wide the stream was: its assumed focal length is then the
          // live loop's, for the same pixels (a cut narrows the picture, not
          // the lens).
          focalReferenceWidthPx:
            info?.captureSource === "frame" && info.frame
              ? frameFocalReferenceWidthPx(
                  info.frame.stream,
                  info.photoWidth !== null && info.photoHeight !== null
                    ? { width: info.photoWidth, height: info.photoHeight }
                    : null,
                )
              : undefined,
          // landmark-raw-v3 (candidate): the nominal focal prior is taken on
          // the stream's long edge, in the same pixels, for the same reason.
          // Passing it is also what gives a frame of the video the video
          // frame's 18 mm prior (F17 review); a still (upload, takePhoto)
          // passes nothing and keeps 26 mm. A frame whose stream size was not
          // known is its own stream.
          focalReferenceLongEdgePx: frameNominalReferenceLongEdgePx(info),
        });
        void logAttempt(info, { kind: "result", result: pipelineResult });
        if (runId !== runIdRef.current) return;
        if (manualActiveRef.current) {
          // The form opened while this was analysed: its result must not open
          // a sheet over the form or touch the typed answers.
          URL.revokeObjectURL(previewUrl);
          setResult((prev) => (prev.kind === "processing" ? NO_RESULT : prev));
          return;
        }
        if (pipelineResult.status === "ok") {
          if (!paperInput.pipeline.manualPaperCorners) {
            const focal = reusableFocal(pipelineResult.diagnostics?.focal);
            autoFocalRef.current = focal ? { file, focal } : null;
          }
          track("scan_measured", {
            flow: "easy",
            attempt,
            // Paper-edge mode finds the sheet itself; a typed hand length
            // means no paper was used; `adjusted` is a frame the person
            // placed (V3.2 F2). The printed sheet's `manual` is never sent here.
            paper: paperUsed,
          });
          // The photo's conditions, as buckets; nothing is sent where a value
          // is missing (a typed length has no sheet to fit).
          const quality = buildScanQuality({
            flow: "easy",
            attempt,
            method: info?.method,
            diagnostics: pipelineResult.diagnostics,
          });
          if (quality) track("scan_quality", quality);
          setHandChip((prev) =>
            applyDetectedHandedness(prev, pipelineResult.overlay.handedness),
          );
          const measured: ResultState = {
            kind: "measured",
            previewUrl,
            overlay: pipelineResult.overlay,
            measurements: pipelineResult.measurements,
            submission: pipelineResult.submission,
            imageWidth: pipelineResult.overlay.imageWidth,
            imageHeight: pipelineResult.overlay.imageHeight,
          };
          setResult(measured);
          // F15 (candidate): a photo measured from the detector's own four
          // corners opens the adjustment by itself, before its sheet and
          // lengths: confirmed as it is, the sheet shows this very result;
          // moved, the photo is measured again with the frame.
          if (adjustOpensDirectly(measured)) {
            setAdjustDirect(true);
            setAdjustOpen("review");
          }
        } else if (pipelineResult.status === "error") {
          // How straight on the shot was and how much of the sheet's worst
          // side was seen (only where its four corners were found), and how
          // flat the fingers look (only where a hand was read): grades only
          // (shadow mode, candidate).
          track(
            "scan_rejected",
            buildScanRejected({
              flow: "easy",
              attempt,
              errors: pipelineResult.errors,
              diagnostics: pipelineResult.diagnostics,
            }),
          );
          setHandChip((prev) =>
            applyDetectedHandedness(prev, pipelineResult.overlay.handedness),
          );
          const failure: ResultState = {
            kind: "gateFailure",
            previewUrl,
            overlay: pipelineResult.overlay,
            errors: pipelineResult.errors,
            imageWidth: pipelineResult.overlay.imageWidth,
            imageHeight: pipelineResult.overlay.imageHeight,
            placedFrame: paperInput.pipeline.manualPaperCorners ?? null,
          };
          setResult(failure);
          // F14 (candidate): a photo turned back on the paper with the
          // detector's own frame opens the adjustment by itself, in place of
          // the failure sheet (a photo taken because the sheet was never
          // found, too). A hand failure keeps the sheet and its reason.
          if (adjustOpensDirectly(failure)) {
            setAdjustDirect(true);
            setAdjustOpen("rescue");
          }
        } else {
          // "needsManualCard" never happens in paper-edge mode.
          track("scan_rejected", {
            flow: "easy",
            attempt,
            codes: ["UNEXPECTED"],
          });
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
            placedFrame: paperInput.pipeline.manualPaperCorners ?? null,
          });
        }
      } catch (error) {
        // Only a genuine detector load failure says so; anything else keeps
        // the message that does not claim a cause it does not know.
        const detectorFailed = error instanceof HandLandmarkerLoadError;
        reportCaught(error, "easy-scan.process");
        void logAttempt(info, {
          kind: "thrown",
          code: detectorFailed ? "DETECTOR_LOAD_FAILED" : "PROCESSING_FAILED",
          message: error instanceof Error ? error.message : "",
        });
        if (runId !== runIdRef.current) return;
        if (manualActiveRef.current) {
          URL.revokeObjectURL(previewUrl);
          setResult((prev) => (prev.kind === "processing" ? NO_RESULT : prev));
          return;
        }
        track("scan_rejected", {
          flow: "easy",
          attempt,
          codes: [
            detectorFailed ? "DETECTOR_LOAD_FAILED" : "PROCESSING_FAILED",
          ],
        });
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
    [runPhotoPipelineImpl, logAttempt],
  );

  const captureNow = useCallback(async () => {
    if (capturingRef.current || manualActiveRef.current) return;
    const source: AttemptCaptureSource = captureSource();
    const video = videoRef.current;
    // A frame needs a video that has a picture. If it has none yet (no video
    // element, no frame decoded, no size) this press does nothing at all: the
    // loop, the ring and the busy flag are left as they were, and the
    // auto-shutter asks again on a later sample.
    if (
      source === "frame" &&
      (!video || video.readyState < 2 || video.videoWidth === 0)
    ) {
      noteCaptureOutcome("failure");
      return;
    }
    capturingRef.current = true;
    // Whether the photo reached `runPipeline`, which takes 測量中… on; on any
    // other way out the shutter's line goes again (the `finally`).
    let handedOff = false;
    try {
      const firedAt = performance.now();
      // 測量中… (F10; F7 put a full-screen loader here): up as soon as there
      // IS a photo (the frame made, or the camera's photo taken), before it is
      // decoded and before the camera stops. Not at the press itself: a frame
      // that cannot be made leaves the viewfinder running, and a line put up
      // for it would flash over the camera on every failed try (review of F7).
      const showMeasuring = () => {
        setShutterMeasuring(true);
      };
      // The camera's own photo (off): the live loop stops at once, as it did.
      // A frame stops it only once the frame exists (below), so a frame that
      // cannot be made leaves the viewfinder running.
      if (source !== "frame" && rafRef.current !== null)
        cancelAnimationFrame(rafRef.current);
      // What the live frame was, read before the stream stops: the photo is
      // drawn with the same crop.
      const streamSize = readStreamSize(video, streamRef.current);
      // ...and the part of it that is on screen (the stage shows the stream with
      // object-fit: cover): the same call, with the same inputs, as the live
      // loop's sample, so what is analysed is exactly what was approved.
      const stageBox = stageRef.current?.getBoundingClientRect();
      const region =
        streamSize && stageBox
          ? visibleRegionInStream(streamSize, {
              width: stageBox.width,
              height: stageBox.height,
            })
          : null;
      let file: File;
      let method: "takePhoto" | "canvas" = "takePhoto";
      /** Draws the video onto a canvas, cut to `rect` (or whole), and makes a JPEG of it. */
      const frameFile = async (
        rect: PixelRect | null,
      ): Promise<File | null> => {
        if (!video || video.videoWidth === 0) return null;
        const area: PixelRect = rect ?? {
          x: 0,
          y: 0,
          width: video.videoWidth,
          height: video.videoHeight,
        };
        const draw = frameDrawArgs(area);
        const canvas = document.createElement("canvas");
        canvas.width = draw.canvas.width;
        canvas.height = draw.canvas.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(video, ...draw.source, ...draw.destination);
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(
            resolve,
            "image/jpeg",
            CAMERA_CONSTANTS.capture.jpegQuality,
          ),
        );
        return blob
          ? new File([blob], `capture-${Date.now()}.jpg`, {
              type: "image/jpeg",
            })
          : null;
      };
      if (source === "frame") {
        // A frame of the video, cut to the part on screen, at the stream's own
        // resolution: the pixels the person saw and the detector approved.
        method = "canvas";
        let frame: File | null = null;
        try {
          frame = await frameFile(region?.capture ?? null);
        } catch {
          // A canvas that throws (out of memory, a lost context) is a frame
          // that was not made, like a missing context or a blob that is null.
          frame = null;
        }
        if (!frame) {
          // No frame: the loop was not stopped and is still running, the busy
          // flag is reset by the `finally` below, and the ring starts over so
          // that the auto-shutter tries again after a full fill, not on every
          // sample. Nothing is shown until the third failure in a row
          // (captureFailure.ts); a press of the shutter tries again at once.
          noteCaptureOutcome("failure");
          autoCaptureRef.current = resetAutoCapture();
          noSheetCaptureRef.current = INITIAL_NO_SHEET_CAPTURE_STATE;
          setRingFraction(0);
          return;
        }
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        file = frame;
      } else {
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
          // No camera photo: the whole frame; the pipeline cuts it to the part
          // on screen (previewView).
          method = "canvas";
          let frame: File | null = null;
          try {
            frame = await frameFile(null);
          } catch {
            // A canvas that throws is a frame that was not made, as above.
            frame = null;
          }
          if (!frame) {
            noteCaptureOutcome("failure");
            capturingRef.current = false;
            return;
          }
          file = frame;
        }
      }

      showMeasuring();
      noteCaptureOutcome("success");
      const previewUrl = URL.createObjectURL(file);
      // The camera keeps running while the photo is decoded, so the swap from
      // live picture to frozen picture happens in one step, under the flash.
      const still = await loadStillSize(previewUrl);
      stopStream();
      if (typeof navigator.vibrate === "function") {
        navigator.vibrate(CAMERA_CONSTANTS.autoCapture.vibrateMs);
      }
      if (!reducedMotionRef.current) setFlashKey((k) => k + 1);
      setAnnounced(scanCommonCopy(localeRef.current).photoTaken);
      fileRef.current = file;
      // A frame cut to the screen's part is drawn exactly as the live video's
      // visible part was: it IS that part, so it is its own "stream" for the layout.
      setPhotoInfo(
        still
          ? {
              url: previewUrl,
              still,
              stream: source === "frame" ? still : streamSize,
            }
          : null,
      );
      captureInfoRef.current = {
        method,
        captureSource: source,
        liveWaitMs:
          firstSheetSeenAtRef.current !== null
            ? firedAt - firstSheetSeenAtRef.current
            : null,
        frame:
          source === "frame" && streamSize && region
            ? { stream: streamSize, visibleInStream: region.visible }
            : undefined,
        settleTimedOut: settleTimedOutRef.current,
        photoWidth: still?.width ?? null,
        photoHeight: still?.height ?? null,
        photoKb: file.size / 1024,
        previewWidth: streamSize?.width ?? null,
        previewHeight: streamSize?.height ?? null,
        previewView:
          source === "takePhoto" && streamSize && region
            ? { stream: streamSize, visibleInStream: region.visible }
            : undefined,
      };
      debugCaptureRef.current = {
        method,
        source,
        stillWidth: still?.width ?? null,
        stillHeight: still?.height ?? null,
        stillKb: file.size / 1024,
        ringCompleteToFrozenMs: null,
      };
      capturingRef.current = false;
      handedOff = true;
      void runPipeline(file, previewUrl);
      // Two frames on, the frozen picture has been painted.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          debugCaptureRef.current.ringCompleteToFrozenMs =
            performance.now() - firedAt;
        }),
      );
    } finally {
      // Whatever happened above, a later press or auto-shutter is not blocked.
      capturingRef.current = false;
      if (!handedOff) {
        // No photo after all (the photo could not be decoded, or something
        // threw after it was made): the camera is still there, so 測量中…
        // goes. A frame that was never made never put it up.
        setShutterMeasuring(false);
      }
    }
  }, [stopStream, runPipeline, noteCaptureOutcome]);

  const onFilePicked = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file || manualActiveRef.current) return;
      stopStream();
      fileRef.current = file;
      const previewUrl = URL.createObjectURL(file);
      setPhotoInfo(null);
      debugCaptureRef.current = {
        method: "upload",
        source: "upload",
        stillWidth: null,
        stillHeight: null,
        stillKb: file.size / 1024,
        ringCompleteToFrozenMs: null,
      };
      const stillSize = loadStillSize(previewUrl);
      captureInfoRef.current = {
        method: "upload",
        captureSource: "upload",
        photoWidth: null,
        photoHeight: null,
        photoKb: file.size / 1024,
        previewWidth: null,
        previewHeight: null,
        stillSize,
      };
      void stillSize.then((still) => {
        if (still) setPhotoInfo({ url: previewUrl, still, stream: null });
      });
      void runPipeline(file, previewUrl);
    },
    [stopStream, runPipeline],
  );

  const retake = useCallback(() => {
    if (result.kind !== "none") URL.revokeObjectURL(result.previewUrl);
    setResult({ kind: "none" });
    setAdjustOpen(null);
    setAdjustDirect(false);
    // A new photo is never a return to a sheet: the next one slides in with
    // focus on its heading, even when this one was left from the adjustment
    // that opened by itself (F15) or a question page.
    sheetResumedRef.current = false;
    adjustReturnRef.current = false;
    dispatchAnswers({ type: "reset" });
    clearSubmitError();
    setPhotoInfo(null);
    // Also where no camera starts again (an upload-only screen).
    setAnnounced("");
    const canUseCamera =
      typeof window !== "undefined" &&
      window.isSecureContext &&
      typeof navigator.mediaDevices?.getUserMedia === "function";
    if (canUseCamera && deviceFit === "phone") void startCamera();
  }, [result, startCamera, deviceFit, clearSubmitError]);

  // 手動調整邊框 (V3.2 F2, candidate). A button only on the failure sheet:
  // after any paper failure or a failure with a frame placed by hand (rescue,
  // F7). A photo measured from the detector's own corners (review) opens it
  // by itself (F15, `adjustOpensDirectly`), never from a button. Nothing here
  // reads the photo's pixels.
  const adjustEntry = adjustEntryFor(result);
  const openAdjust = useCallback(() => {
    if (adjustEntry !== "rescue" || manualActiveRef.current) return;
    setAdjustOpen(adjustEntry);
  }, [adjustEntry]);
  // Cancel: back to the sheet it was opened from, or, when it opened by itself
  // (F14), back to the camera (there is no sheet under it).
  const cancelAdjust = useCallback(() => {
    if (adjustDirect) retake();
    else setAdjustOpen(null);
  }, [adjustDirect, retake]);
  const confirmAdjust = useCallback(
    (placed: PaperAdjustConfirm) => {
      const current = resultRef.current;
      const entry = adjustOpen;
      const direct = adjustDirect;
      setAdjustOpen(null);
      setAdjustDirect(false);
      // F15 (candidate): every confirm of the screen that opened by itself on
      // a measured photo records, on this device only, how far each corner
      // is from the detector's (in place of the ?debug=1 corner check). It
      // changes no measurement and is sent nowhere.
      const check = confirmCornerCheck({
        entry,
        result: current,
        corners: placed.corners,
      });
      if (check)
        void logAttempt(captureInfoRef.current, {
          kind: "cornerCheck",
          magnifier: check.magnifier,
          distancesPx: check.distancesPx,
          imageLongEdgePx: check.imageLongEdgePx,
        });
      const action = adjustConfirmAction({
        entry,
        result: current,
        hasFile: fileRef.current !== null,
        moved: placed.moved,
      });
      // The screen opened by itself (F15), so the sheet is not a return to
      // something already seen: it slides in as any result does, with focus
      // on its heading.
      if (direct) {
        sheetResumedRef.current = false;
        adjustReturnRef.current = false;
      }
      // A rescue on the failure, or a moved frame on a measured photo (F7,
      // F15); a frame confirmed as it opened changes nothing: the sheet shows
      // the measurement already made.
      if (
        action.kind !== "rerun" ||
        (current.kind !== "gateFailure" && current.kind !== "measured") ||
        !fileRef.current
      )
        return;
      // The frame is confirmed over a curled sheet's warning (F7): the
      // results page will say so (F13), for this photo.
      if (adjustWarningFor(current) === "curled")
        curledBeforeRef.current = true;
      // A new analysis, not a return: its sheet slides in as any result does.
      sheetResumedRef.current = false;
      adjustReturnRef.current = false;
      void runPipeline(fileRef.current, current.previewUrl, {
        corners: placed.corners,
        source: placed.source,
      });
    },
    [adjustOpen, adjustDirect, logAttempt, runPipeline],
  );

  const changePaperSize = useCallback((size: PaperSize) => {
    setPaperSize(size);
    writeStoredPaperSize(getBrowserStorage(), size);
  }, []);

  // The scan is sent from the last question page, with whatever was answered
  // (answers.ts): a skipped question leaves its field out. A typed pair is
  // sent the same way, as a new submission with no photo behind it, and its
  // grip is mandatory (the grip page has no 跳過 then).
  const sendScan = useCallback(
    (final: Pick<typeof answers, "grip" | "thickness">) => {
      if (manualValues) {
        // Cannot happen from the screen (the grip page is required and has no
        // 跳過); if it ever did, the person is taken back to choose rather than
        // left on a button that does nothing.
        if (final.grip === null) {
          dispatchAnswers({ type: "back" });
          return;
        }
        submitScanNow(buildManualAnswersSubmission(manualValues, final));
        return;
      }
      if (resultRef.current.kind !== "measured") return;
      const submission = buildSubmission(resultRef.current.submission, final);
      submitScanNow(submission, {
        paperCurled: paperCurledNoteFor({
          submission,
          curledBefore: curledBeforeRef.current,
        }),
      });
    },
    [submitScanNow, manualValues],
  );

  // The handle's press. Ignored while a photo is being taken or analysed, or
  // a result is up: the camera screen it belongs to is already leaving.
  const openManualSheet = useCallback(() => {
    if (capturingRef.current || resultRef.current.kind !== "none") return;
    setManualSheetOpen(true);
  }, []);
  // The typed pair is confirmed: the grip page opens over the form. A new
  // pair replaces any earlier one; the answers already given stay.
  const confirmManualValues = useCallback((values: ManualEntryValues) => {
    setManualValues(values);
    setManualSheetOpen(false);
    dispatchAnswers({ type: "open" });
  }, []);
  // 返回 on a question page (or Esc). From the grip page of a typed pair it
  // leaves the pages for the form again: the sheet opens (phone) or the panel
  // is simply there (desktop), with the draft as it was.
  const backFromAnswers = useCallback(() => {
    clearSubmitError();
    if (manualValues && answers.step === "grip") {
      setManualValues(null);
      setManualSheetOpen(deviceFit === "phone");
    }
    dispatchAnswers({ type: "back" });
  }, [clearSubmitError, manualValues, answers.step, deviceFit]);
  // The error banner's button after a failed send of a typed pair: back to the
  // form (there is no photo to retake), answers kept.
  const editManualNumbers = useCallback(() => {
    clearSubmitError();
    setManualValues(null);
    setManualSheetOpen(deviceFit === "phone");
    dispatchAnswers({ type: "back" });
    dispatchAnswers({ type: "back" });
  }, [clearSubmitError, deviceFit]);

  // Back on the desktop's panel (返回 from the grip page, 修改數字): focus goes
  // to the panel's heading, not to the page. (The phone's sheet focuses its own
  // title when it opens.)
  const wasManualRef = useRef(false);
  useEffect(() => {
    if (wasManualRef.current && !manualMode && deviceFit === "desktop")
      document
        .querySelector<HTMLElement>(
          '[data-testid="manual-entry-panel"] [tabindex="-1"]',
        )
        ?.focus();
    wasManualRef.current = manualMode;
  }, [manualMode, deviceFit]);

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
      // A frame the person placed stays with the photo (F7).
      void runPipeline(
        fileRef.current,
        resultRef.current.previewUrl,
        resultRef.current.placedFrame ?? undefined,
      );
    }
  }, [runPipeline]);

  // The live loop — identical shape to CameraCapture's, minus the hand
  // ghost and the redundant status-chips row (screen 14 shows only the
  // corner dots and one cue line).
  useEffect(() => {
    if (camState.kind !== "live" || tipOpen || manualActive) return;
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

    // The part of the stream that is on screen (the stage shows it with
    // object-fit: cover): the loop looks at this and nothing else, so what is
    // detected, counted ("Move closer") and found "perfect" is what the person
    // sees. `null` until the stage has a size: the whole frame is then used.
    function readVisible() {
      const stage = stageRef.current;
      if (!stage || !video || video.videoWidth === 0) return null;
      const box = stage.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return null;
      const region = visibleRegionInStream(
        { width: video.videoWidth, height: video.videoHeight },
        { width: box.width, height: box.height },
      );
      return region ? { box, visible: region.visible } : null;
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

      const view = readVisible();
      const source: PixelRect = view?.visible ?? {
        x: 0,
        y: 0,
        width: video.videoWidth,
        height: video.videoHeight,
      };
      const { width, height } = computeDownscaleSize(
        Math.max(1, Math.round(source.width)),
        Math.max(1, Math.round(source.height)),
        CAMERA_CONSTANTS.liveLoop.downscaleLongEdgePx,
      );
      // The sample has the stage's shape, so mapping it back onto the stage is
      // (nearly) a plain scale.
      const stageInfo = view
        ? {
            coverRect: computeCoverRect(
              view.box.width,
              view.box.height,
              width,
              height,
            ),
          }
        : null;
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
      ctx.drawImage(
        video,
        source.x,
        source.y,
        source.width,
        source.height,
        0,
        0,
        width,
        height,
      );
      const imageData = ctx.getImageData(0, 0, width, height);

      if (userLengthRef.current !== null) {
        setCue(null);
        setAnnounced(cameraCuesCopy(localeRef.current).handFlat);
        return;
      }

      let detection: SheetQuadDetection;
      const detectStartedAt = performance.now();
      try {
        // The assumed focal length is the whole stream's, scaled to the
        // sample (visibleView.ts), not the narrower sample's own.
        // V3.2 F17 (candidate): with a fresh hand reading (F14's sampling),
        // the bright region that holds the palm is taken for the sheet.
        const palm = livePalmHint({
          latest: handReadingsRef.current.latest,
          nowMs: now,
          width,
          height,
        });
        // V3.2 F19 (candidate): with the same fresh reading, the hand's 21
        // landmarks, so the points the hand and arm cover are left out.
        const handLandmarks = liveHandHint({
          latest: handReadingsRef.current.latest,
          nowMs: now,
          width,
          height,
        });
        detection = quadSourceRef.current(imageData, paperSizeRef.current, {
          focalPxHint: assumedSampleFocalPx(
            { width: video.videoWidth, height: video.videoHeight },
            source,
            { width, height },
          ),
          ...(palm ? { palmPointsPx: palm } : {}),
          ...(handLandmarks ? { handLandmarksPx: handLandmarks } : {}),
        });
      } catch {
        detection = NO_QUAD_DETECTION;
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

      if (sampleQuad && firstSheetSeenAtRef.current === null)
        firstSheetSeenAtRef.current = now;
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
          // The photo's own paper gate, on this detection: no second
          // detector run (paperGate.ts).
          paperGate: evaluateLivePaperGate(detection, paperSizeRef.current),
          // Where the detector stopped, from the same detection (scan S2):
          // nothing is computed again for it.
          paperStage: detection.failureStage ?? null,
          // No stage cue before the sheet was ever found (cues.ts).
          sheetSeenYet: firstSheetSeenAtRef.current !== null,
          msSinceLastDetection,
        },
        "paper-edge",
        localeRef.current,
      );

      // The ring reads the raw sample: one or two failures pause it, the
      // third in a row empties it (autoCapture.ts).
      const paperPassing = nextCue.allPass && previewSettledRef.current;
      autoCaptureRef.current = advanceAutoCapture(
        autoCaptureRef.current,
        paperPassing,
        dtMs,
      );
      setRingFraction(autoCaptureRingFraction(autoCaptureRef.current));

      // F14 (candidate): the sheet is not found (a light table: no sheet,
      // found only now and then, or a quad the gate turns back), but a hand
      // held still: after `noSheetCapture.waitMs` the photo is taken anyway,
      // and its analysis opens the adjustment (adjustOpensDirectly). A sheet
      // that is found and only needs the phone moved or held (too far,
      // tilted, dark, hold still...) pauses the wait: the live cue and the
      // ring guard that shot (sheetFoundByCue). The hand is read from this
      // same sample at most every `handSampleIntervalMs`, found sheet or not
      // (F17 review: the palm hint must not stop because a window passed
      // the gate); only whether it is there, still, and where its palm is
      // are used, nothing is measured from it.
      const sheetFound = sheetFoundByCue(nextCue.code);
      if (
        shouldSampleHand({
          detectorReady: isHandLandmarkerReady(),
          lastReadingAtMs: handReadingsRef.current.latest?.atMs ?? null,
          nowMs: now,
        })
      ) {
        const points = readLiveHandPoints(canvas, width, height);
        if (points !== undefined)
          handReadingsRef.current = recordHandReading(handReadingsRef.current, {
            atMs: now,
            points,
          });
      }
      const hand = liveHandSignal({
        previous: handReadingsRef.current.previous,
        latest: handReadingsRef.current.latest,
        nowMs: now,
        frameDiagonal,
      });
      noSheetCaptureRef.current = advanceNoSheetCapture(
        noSheetCaptureRef.current,
        {
          sheetFound,
          handSeen: hand.seen,
          handSteady: hand.steady,
          sharp: sharpEnough,
          settled: previewSettledRef.current,
        },
        dtMs,
      );

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
        live.visibleInStream = source;
        live.sample = { width, height };
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
        // V3.2 F16: two quads that alternate (conflicting side lines) do not
        // make the outline jump or blink (outlineHysteresis.ts); display only.
        const outline = advanceOutline(
          outlineRef.current,
          [observe(0), observe(1), observe(2), observe(3)],
          Math.hypot(coverRect.width, coverRect.height),
        );
        outlineRef.current = outline.state;
        cornerStatesRef.current = advanceCorners(
          cornerStatesRef.current,
          outline.shown,
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
          shownCode === nextCue.code
            ? nextCue
            : cueFromCode(shownCode, "paper-edge", localeRef.current);
        setCue(shownCue);
        setAnnounced(
          easyCueText(shownCue, {
            tapToFocus: focusSupportRef.current.tapToFocus,
            locale: localeRef.current,
          }),
        );
      }

      if (
        (autoCaptureRef.current.fired || noSheetCaptureRef.current.fired) &&
        previewSettledRef.current
      )
        void captureNow();
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [camState.kind, captureNow, tipOpen, manualActive, resetLoopState]);

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
    const alignment = previewAlignmentRef.current;
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
        visibleInStream: live.visibleInStream,
        sample: live.sample,
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
        source: capture.source ?? captureSource(),
        stillWidth: capture.stillWidth,
        stillHeight: capture.stillHeight,
        stillKb: capture.stillKb,
        ringCompleteToFrozenMs: capture.ringCompleteToFrozenMs,
      },
      preview: {
        requested: alignment
          ? {
              width: alignment.requested.width.ideal,
              height: alignment.requested.height.ideal,
              aspectRatio: alignment.requested.aspectRatio.ideal,
            }
          : null,
        stillAspect: alignment?.stillAspect ?? null,
        stillAspectSource: alignment?.stillAspectSource ?? null,
        photoMax: alignment?.photoMax ?? null,
        previewAspect: alignment?.comparison.previewAspect ?? null,
        aspectDiff: alignment?.comparison.aspectDiff ?? null,
        fovMismatch: alignment?.comparison.fovMismatch ?? null,
        reapplied: alignment?.reapplied ?? null,
        settleTimedOut: settleTimedOutRef.current,
        orientationRetry: alignment?.orientationRetry ?? null,
      },
      attempts: attemptsRef.current,
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
    noteCaptureOutcome("reset");
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
      setLengthError(userLengthRangeMessage(locale));
      return;
    }
    setLengthError("");
    setUserLengthMm(value);
    announceMode(easy.noPaperAnnounce(String(value)));
    leaveLengthStep();
  };
  const switchToPaper = () => {
    focusEntryAfterSwitchRef.current = true;
    setUserLengthMm(null);
    userLengthRef.current = null;
    resetLoopState();
    announceMode(easy.paperAnnounce);
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
    ? easyCueText(cue, { tapToFocus: focusSupport.tapToFocus, locale })
    : cameraCuesCopy(locale).pointAtPaper;
  // From the third failed frame capture in a row, the cue line says so instead
  // of its usual words (same slot, same live region); it is plain text, so
  // there is nothing to animate.
  const captureFailureLanguage = shouldShowCaptureFailureHint(captureFailures)
    ? locale
    : null;
  const captureFailureHint = captureFailureLanguage
    ? captureFailureHintText(captureFailureLanguage)
    : null;
  const hintText = hintUnderViewfinder(
    userLengthMm !== null
      ? ""
      : easyHintText({
          cueCode: cue?.code ?? null,
          ringFraction,
          tapToFocus: focusSupport.tapToFocus,
          locale,
        }),
    captureFailures,
  );

  // Null while the typed-hand-length feature flag is off: every "no paper"
  // entry below renders only when this is non-null.
  const noPaperLabel = noPaperEntryLabel(userLengthMm !== null, locale);
  const noPaperMode = userLengthMm !== null;

  // The grip and thickness pages, over the measured sheet or over the typed
  // hand size. A native modal, so it is also what makes the page behind inert;
  // it is built before the early return of the desktop screen below, which
  // shows it over the QR page.
  const answersDialog = answersOpen ? (
    <dialog
      ref={answerDialogRef}
      className="answerDialog"
      aria-labelledby="answer-title"
      onClose={(e) => {
        // The browser closed it itself: a second Esc, or the Android back
        // gesture, with no tap in between is not cancelable, so onCancel
        // never gets to stop it. State and dialog must stay in step:
        // while the scan is being sent it opens again, otherwise it is a
        // 返回 (and the effect above opens the dialog again if the page
        // before it is a question page too).
        if (answers.step === "thickness" && submitBusy) {
          e.currentTarget.showModal();
          return;
        }
        backFromAnswers();
      }}
      onCancel={(e) => {
        // Escape is 返回, and does nothing while the scan is being sent.
        e.preventDefault();
        if (answers.step === "thickness" && submitBusy) return;
        backFromAnswers();
      }}
    >
      {answers.step === "grip" ? (
        <GripPage
          value={answers.grip}
          onChange={(grip) => dispatchAnswers({ type: "chooseGrip", grip })}
          onConfirm={() => dispatchAnswers({ type: "confirmGrip" })}
          onSkip={() => dispatchAnswers({ type: "skipGrip" })}
          onBack={backFromAnswers}
          required={manualMode}
        />
      ) : (
        <ThicknessPage
          value={answers.thickness}
          onChange={(thickness) => {
            clearSubmitError();
            dispatchAnswers({ type: "chooseThickness", thickness });
          }}
          onSubmit={() => sendScan(answers)}
          onSkip={() => {
            const next = answersReducer(answers, {
              type: "skipThickness",
            });
            dispatchAnswers({ type: "skipThickness" });
            sendScan(next);
          }}
          onBack={backFromAnswers}
          busy={submitBusy}
          onRetake={manualMode ? editManualNumbers : retake}
          retakeLabel={
            manualMode ? manualEntryCopy(locale).editNumbers : undefined
          }
          errorText={
            manualMode
              ? {
                  invalid: manualEntryCopy(locale).sendInvalid,
                  tooLarge: manualEntryCopy(locale).sendTooLarge,
                }
              : undefined
          }
          errorKind={
            submitState.kind === "error" ? submitState.errorKind : null
          }
        />
      )}
    </dialog>
  ) : null;

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
        <h1 className="visuallyHidden">{easy.heading}</h1>
        <p className="visuallyHidden">{easy.loadingScanner}</p>
      </main>
    );

  if (
    (deviceFit === "desktop" || deviceFit === "in-app") &&
    result.kind === "none"
  )
    return (
      <>
        <DeviceEntry
          kind={deviceFit}
          url={pageUrl}
          onFilePicked={onFilePicked}
          manual={
            deviceFit === "desktop"
              ? {
                  draft: manualDraftRef.current,
                  onDraftChange: keepManualDraft,
                  onUse: confirmManualValues,
                }
              : undefined
          }
        />
        {answersDialog}
      </>
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
  const { x: overlayToStill, y: overlayToStillY } = computeOverlayToStill(
    stillSize,
    resultOverlay,
  );
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
            overlayToStillY,
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
  // F15: no length is drawn on the photo before the frame is confirmed (the
  // adjustment screen is open over it).
  const dimensions: readonly DimensionSpec[] | null =
    result.kind === "measured" && result.overlay.landmarksPx && !adjustOpen
      ? [
          {
            a: result.overlay.landmarksPx[0],
            b: result.overlay.landmarksPx[LANDMARK.middle[3]],
            label:
              "method" in result.submission.calibration &&
              result.submission.calibration.method === "user-length"
                ? easy.dimEntered(
                    String(result.submission.calibration.referenceMm),
                  )
                : easy.dimHand(
                    shownScanMeasurements(
                      result.measurements,
                      result.submission.calibration,
                    ).handLengthMm.toFixed(0),
                  ),
            side: 1,
          },
          {
            a: result.overlay.landmarksPx[LANDMARK.index[0]],
            b: result.overlay.landmarksPx[LANDMARK.pinky[0]],
            // landmark-raw-v3 (candidate, D1 = B): the engine-scale numbers.
            label: easy.dimPalm(
              shownScanMeasurements(
                result.measurements,
                result.submission.calibration,
              ).palmWidthMm.toFixed(0),
            ),
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
        overlayToStillY={overlayToStillY}
        layerScale={measuredView ? layerScale : 1}
        dimensions={measuredView ? dimensions : null}
        problem={measuredView ? problem : null}
        ariaLabel={noPaperMode ? easy.photoLabelNoPaper : easy.photoLabelPaper}
      />
    ) : null;

  return (
    <main
      className={`cameraViewfinder easyScanShell${showStage ? " easyScanStaged" : ""}`}
    >
      <h1 className="visuallyHidden">{easy.heading}</h1>
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
          aria-label={easy.closeCamera}
          onClick={exitToHome}
        >
          ×
        </button>
        <div className="easyScanTopRight">
          <button
            type="button"
            className="easyHelpButton"
            ref={helpTriggerRef}
            aria-label={easy.showTip}
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
            {cameraAvailable() ? easy.backToCamera : easy.backToUpload}
          </button>
          <svg
            className="easyHandDrawing"
            viewBox="0 0 240 290"
            role="img"
            aria-label={easy.handDrawingLabel}
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
            {easy.lengthHeading}
          </h2>
          <p>{easy.lengthSub}</p>
          <form
            className="easyLengthForm"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              continueWithLength();
            }}
          >
            <label htmlFor="easy-hand-length">{easy.lengthFieldLabel}</label>
            <input
              id="easy-hand-length"
              type="number"
              inputMode="decimal"
              enterKeyHint="go"
              min={USER_LENGTH_RANGE_MM.min}
              max={USER_LENGTH_RANGE_MM.max}
              step="any"
              placeholder={easy.lengthPlaceholder}
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
              {easy.lengthHint(
                USER_LENGTH_RANGE_MM.min,
                USER_LENGTH_RANGE_MM.max,
              )}
            </p>
            {lengthError && (
              <p id="easy-length-error" role="alert">
                {lengthError}
              </p>
            )}
            <button type="submit" className="primaryButton">
              {easy.lengthContinue}
            </button>
          </form>
        </section>
      )}
      {!lengthStep &&
        camState.kind === "streamEnded" &&
        result.kind === "none" && (
          <div className="cameraResumeCard">
            <p>{common.cameraTurnedOff}</p>
            <button
              type="button"
              className="cameraResumeButton"
              onClick={() => void startCamera()}
            >
              {common.cameraTapToResume}
            </button>
          </div>
        )}

      {!lengthStep &&
        camState.kind === "cameraError" &&
        result.kind === "none" && (
          <div className="cameraErrorCard" role="alert">
            <p>
              {camState.blocked ? common.cameraBlocked : common.cameraCantOpen}
            </p>
            <p>{common.cameraToUse}</p>
            <ol>
              <li>{common.cameraStepSettings}</li>
              <li>{common.cameraStepAllow}</li>
              <li>{common.cameraStepReloadEasy}</li>
            </ol>
            <p>{common.cameraOrUpload}</p>
            <label
              className="easyUploadFallbackButton"
              htmlFor="easy-scan-upload"
            >
              {common.uploadInstead}
            </label>
          </div>
        )}

      {!lengthStep &&
        camState.kind === "noCamera" &&
        result.kind === "none" && (
          <div className="easyScanNoCamera">
            <p>{noPaperMode ? easy.uploadLineNoPaper : easy.uploadLinePaper}</p>
            <label
              className="easyUploadFallbackButton"
              htmlFor="easy-scan-upload"
            >
              {common.uploadPhoto}
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
                {easy.usePaperInstead}
              </button>
            )}
          </div>
        )}

      {/* Where the camera cannot be used (permission refused, no camera, the
          stream ended), typing the hand size is the way on, and these are the
          people who need it most: the same strip as on the live camera, at
          the same edge. */}
      {!lengthStep &&
        deviceFit === "phone" &&
        !tipOpen &&
        result.kind === "none" &&
        (camState.kind === "streamEnded" ||
          camState.kind === "cameraError" ||
          camState.kind === "noCamera") && (
          <div className="easyManualDock">
            <ManualEntryHandle ref={manualHandleRef} onOpen={openManualSheet} />
          </div>
        )}

      {!lengthStep &&
        (camState.kind === "live" || camState.kind === "requesting") &&
        result.kind === "none" && (
          <>
            <div className="cameraCueWrap">
              <div
                className={`cameraCue${cue?.allPass && !captureFailureHint ? " perfect" : ""}`}
                aria-live="polite"
                data-testid="camera-cue"
                data-capture-failure={captureFailureHint ? "true" : undefined}
              >
                {captureFailureHint ? (
                  captureFailureHint
                ) : userLengthMm !== null ? (
                  cameraCuesCopy(locale).handFlat
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
            <div className="easyBottomDock easyBottomDock-withHandle">
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
                    {easy.lengthChip(String(userLengthMm))}
                  </span>
                )}
                <button
                  type="button"
                  className="cameraShutter"
                  aria-label={common.takePhoto}
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
                  <span className="visuallyHidden">{common.uploadInstead}</span>
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
                      {easy.usePaperInstead}
                    </button>
                  )}
                </div>
              )}
              {/* Typing the hand size instead (manual entry, candidate): a strip
                  at the very bottom of the camera screen. It is only here
                  while the camera is, not over a finished measurement, and
                  not under the first-run tip (a modal over the same edge). */}
              {!tipOpen && (
                <ManualEntryHandle
                  ref={manualHandleRef}
                  onOpen={openManualSheet}
                />
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
            ? common.uploadPhoto
            : common.uploadInstead
        }
      />

      {measuringShown(result.kind, shutterMeasuring) && (
        <p
          className="easyProcessingPill"
          role="status"
          aria-live="polite"
          data-testid="easy-measuring"
        >
          {easy.measuring}
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
            result.kind === "measured"
              ? common.handMeasured
              : common.retakeNeeded
          }
          onCancel={(e) => {
            e.preventDefault();
            retake();
          }}
        >
          {result.kind === "measured" ? (
            <>
              <p className="easySheetTitle" ref={sheetTitleRef} tabIndex={-1}>
                <CheckIcon width={20} height={20} /> {common.handMeasured}
              </p>
              <p className="easySheetNumbers" data-testid="easy-sheet-numbers">
                {measuredSheetNumbers(
                  result.measurements,
                  result.submission.calibration,
                  locale,
                )}
              </p>
              {/* F15 (candidate): only the title, the numbers, retake and
                  continue (and Debug with ?debug=1). "Still being
                  validated" and "adjusted by hand" are said on the results
                  page. */}
              {"method" in result.submission.calibration &&
                result.submission.calibration.method === "user-length" && (
                  <div className="easyLengthDisclosure">
                    <p>
                      {easy.disclosureBased(
                        String(result.submission.calibration.referenceMm),
                      )}
                    </p>
                    <p>{easy.disclosureNoPaper}</p>
                  </div>
                )}
              <div className="easySheetActions easyStickyActions">
                <button
                  type="button"
                  className="easyRetakeButton"
                  aria-label={common.retakePhoto}
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
                  <button
                    type="button"
                    className="primaryButton"
                    ref={continueRef}
                    data-testid="answers-continue-button"
                    onClick={() => dispatchAnswers({ type: "open" })}
                  >
                    {scanAnswersCopy(locale).sheetContinue}
                  </button>
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
                {common.retakeNeeded}
              </p>
              <p className="easySheetErrorMessage" role="alert">
                {result.errors[0] ? issueText(result.errors[0], locale) : ""}
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
                  {common.tryAgain}
                </button>
                {/* The secondary way on after a paper failure, or after a frame
                    placed by hand was turned back (V3.2 F2, F7, candidate):
                    retaking stays the main one. */}
                {adjustEntry === "rescue" && (
                  <button
                    type="button"
                    className="easyAdjustFrameButton"
                    ref={adjustButtonRef}
                    data-testid="adjust-frame-entry"
                    onClick={openAdjust}
                  >
                    {paperAdjustCopy(locale).entry}
                  </button>
                )}
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
                      {noPaperLabel}
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

      {adjustOpen &&
        (result.kind === "measured" || result.kind === "gateFailure") &&
        result.overlay && (
          <PaperAdjust
            key={`${adjustOpen}:${result.previewUrl}`}
            entry={adjustOpen}
            overlay={result.overlay}
            previous={
              result.kind === "gateFailure"
                ? (result.placedFrame ?? null)
                : null
            }
            leave={adjustDirect ? "retake" : "cancel"}
            paperSize={paperSizeRef.current}
            previewUrl={result.previewUrl}
            locale={locale}
            onCancel={cancelAdjust}
            onConfirm={confirmAdjust}
          />
        )}

      {manualSheetOpen && (
        <ManualEntrySheet
          presentation="sheet"
          returnFocusTo={manualHandleRef}
          initialDraft={manualDraftRef.current}
          onDraftChange={keepManualDraft}
          onCancel={() => setManualSheetOpen(false)}
          onUse={confirmManualValues}
        />
      )}
      {answersDialog}

      <dialog
        ref={tipDialogRef}
        className="easySheet easyTipSheet"
        tabIndex={-1}
        aria-label={noPaperMode ? easy.tipTitleNoPaper : easy.tipTitlePaper}
        onCancel={(e) => {
          e.preventDefault();
          dismissTip();
        }}
      >
        <p className="easySheetTitle">
          {noPaperMode ? easy.tipTitleNoPaper : easy.tipTitlePaper}
        </p>
        <ul className="easyTipList">
          {noPaperMode ? (
            <>
              <li>
                <span aria-hidden="true">🟫</span> {easy.tipSurface}
              </li>
              <li>
                <HandIcon width={18} height={18} /> {easy.tipHandFlat}
              </li>
              <li>
                <span aria-hidden="true">📱</span> {easy.tipPhoneNoPaper}
              </li>
            </>
          ) : (
            <>
              <li>
                <span aria-hidden="true">📄</span>{" "}
                {easy.tipPaperOnTable(PAPER_SIZE_LABELS[paperSize])}
              </li>
              <li>
                <HandIcon width={18} height={18} /> {easy.tipHandFlat}
              </li>
              <li>
                <span aria-hidden="true">📱</span> {easy.tipPhonePaper}
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
          {easy.tipGotIt}
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
            {easy.usePaperInstead}
          </button>
        )}
        <p className="easyTipFinePrint">
          {easy.tipFinePrint(common.privacyAndCameraStays)}
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
