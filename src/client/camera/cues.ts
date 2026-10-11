/**
 * The single prioritised cue line and the three status chips
 * (docs/design/camera-capture-2026-09-25/README.md's numbered priority
 * list, revised 2026-09-25 for Kirby's plain-paper direction change: the
 * lock-on target is a blank sheet of paper's four corners, not a printed
 * sheet's ArUco markers — see src/client/camera/quad-source.ts's header).
 * Pure — combines the checks in quad.ts/light.ts/steadiness.ts into one
 * ordered decision, so the priority order itself is unit-tested directly
 * rather than only exercised incidentally through the component.
 */
import type { Locale } from "../../lib/contracts/locale";
import {
  cameraCuesCopy,
  type CameraCuesCopy,
} from "../../lib/copy/camera-cues";
import { CAMERA_CONSTANTS } from "./constants";
import {
  computeQuadSkew,
  isQuadSkewed,
  computeQuadWidthFraction,
  computeQuadSizeStatus,
  type Quad,
} from "./quad";
import { computeLightStatus, type LightStatus } from "./light";

export type CueCode =
  | "place-paper"
  | "no-corners"
  | "some-corners"
  | "tilted"
  | "too-far"
  | "too-close"
  | "dark"
  | "bright"
  | "hold-still"
  | "out-of-focus"
  | "perfect";

export interface Cue {
  readonly code: CueCode;
  readonly message: string;
  /** True only for "perfect" — every check passed, auto-capture may run. */
  readonly allPass: boolean;
}

const CUE_KEYS: Record<CueCode, keyof CameraCuesCopy["paper"]> = {
  "place-paper": "placePaper",
  "no-corners": "noCorners",
  "some-corners": "someCorners",
  tilted: "tilted",
  "too-far": "tooFar",
  "too-close": "tooClose",
  dark: "dark",
  bright: "bright",
  "hold-still": "holdStill",
  "out-of-focus": "outOfFocus",
  perfect: "perfect",
};

export type CueCalibrationMode = "printed-sheet" | "paper-edge";

/**
 * The words of a cue in a locale. `locale` is a parameter, never read from
 * anywhere in here: this module is pure.
 */
export function cueMessage(
  code: CueCode,
  mode: CueCalibrationMode,
  locale: Locale,
): string {
  const table = cameraCuesCopy(locale);
  return (mode === "printed-sheet" ? table.sheet : table.paper)[CUE_KEYS[code]];
}

function cue(code: CueCode, mode: CueCalibrationMode, locale: Locale): Cue {
  return {
    code,
    message: cueMessage(code, mode, locale),
    allPass: code === "perfect",
  };
}

/** The cue for a code, as `pickCue` would have built it. */
export function cueFromCode(
  code: CueCode,
  mode: CueCalibrationMode,
  locale: Locale,
): Cue {
  return cue(code, mode, locale);
}

/**
 * The easy scan's cue line. "Perfect" reads "Got it — hold still" there, and
 * being out of focus reads "Tap the paper to focus" where a tap can set the
 * focus (otherwise the plain "Waiting for a sharp picture"). The words come
 * from the cue's code, so a cue built earlier still reads right in the locale
 * now shown.
 */
export function easyCueText(
  cue: Cue,
  options: { readonly tapToFocus: boolean; readonly locale: Locale },
): string {
  const table = cameraCuesCopy(options.locale);
  if (cue.code === "perfect") return table.gotIt;
  if (cue.code === "out-of-focus" && options.tapToFocus)
    return table.tapToFocus;
  return cueMessage(cue.code, "paper-edge", options.locale);
}

/**
 * The hint line under the viewfinder: what is happening now, when it is not
 * already the cue. Empty otherwise. While out of focus it says so, unless the
 * cue already says exactly that (no tap to focus): the same words twice would
 * only be read out twice.
 */
export function easyHintText(input: {
  readonly cueCode: CueCode | null;
  readonly ringFraction: number;
  readonly tapToFocus: boolean;
  readonly locale: Locale;
}): string {
  const table = cameraCuesCopy(input.locale);
  if (input.cueCode === "out-of-focus")
    return input.tapToFocus ? table.paper.outOfFocus : "";
  if (input.cueCode === "perfect" && input.ringFraction > 0)
    return table.holdStillTakingPhoto;
  return "";
}

export interface CueInput {
  /** How many of the paper's four corners were found in this sample. */
  readonly cornersSeen: 0 | 1 | 2 | 3 | 4;
  /** The tracked paper quad — required once cornersSeen === 4. */
  readonly quad: Quad | null;
  readonly frameWidth: number;
  readonly meanLuma: number;
  readonly clippedFraction: number;
  readonly steady: boolean;
  readonly sharpEnough: boolean;
  /**
   * Milliseconds since a paper quad was last found at all (0 corners seen
   * continuously). Only consulted when `cornersSeen === 0`, to escalate
   * from the generic "point the camera" cue to a more specific one.
   */
  readonly msSinceLastDetection: number;
}

/**
 * The one cue to show, per the spec's fixed priority order. Every input
 * after corner count is only consulted once 4/4 corners are found and a
 * quad exists — a partial corner set always short-circuits to
 * "some-corners".
 */
export function pickCue(
  input: CueInput,
  mode: CueCalibrationMode,
  locale: Locale,
): Cue {
  if (input.cornersSeen <= 0) {
    if (
      input.msSinceLastDetection >
      CAMERA_CONSTANTS.noDetection.placePaperTimeoutMs
    ) {
      return cue("place-paper", mode, locale);
    }
    return cue("no-corners", mode, locale);
  }
  if (input.cornersSeen < 4) return cue("some-corners", mode, locale);
  if (!input.quad) return cue("some-corners", mode, locale);

  const skew = computeQuadSkew(input.quad);
  if (isQuadSkewed(skew)) return cue("tilted", mode, locale);

  const widthFraction = computeQuadWidthFraction(input.quad, input.frameWidth);
  const sizeStatus = computeQuadSizeStatus(widthFraction);
  if (sizeStatus === "too-far") return cue("too-far", mode, locale);
  if (sizeStatus === "too-close") return cue("too-close", mode, locale);

  const light: LightStatus = computeLightStatus(
    input.meanLuma,
    input.clippedFraction,
  );
  if (light === "dark") return cue("dark", mode, locale);
  if (light === "bright") return cue("bright", mode, locale);

  // Shake and focus are different problems with different fixes: holding
  // still cannot bring a soft picture into focus, so they are told apart.
  if (!input.steady) return cue("hold-still", mode, locale);
  if (!input.sharpEnough) return cue("out-of-focus", mode, locale);

  return cue("perfect", mode, locale);
}

export interface StatusChip {
  readonly label: string;
  readonly pass: boolean;
}

export interface StatusChips {
  readonly paper: StatusChip;
  readonly steady: StatusChip;
  readonly light: StatusChip;
}

/**
 * The three always-visible status chips (`Paper 4/4`, `Steady`, `Light`) —
 * redundant with the cue line for anyone scanning rather than reading, per
 * the spec.
 */
export function computeStatusChips(
  input: CueInput,
  mode: CueCalibrationMode,
  locale: Locale,
): StatusChips {
  const words = cameraCuesCopy(locale);
  const paperPass = input.cornersSeen >= 4;
  const light = computeLightStatus(input.meanLuma, input.clippedFraction);
  return {
    paper: {
      label: (mode === "printed-sheet" ? words.sheetChip : words.paperChip)(
        input.cornersSeen,
      ),
      pass: paperPass,
    },
    // "Steady" means what the "hold-still" cue means: shake only. A soft
    // picture is the "out-of-focus" cue's business, and holding still cannot fix it.
    steady: { label: words.steadyChip, pass: input.steady },
    light: { label: words.lightChip, pass: light === "ok" },
  };
}

export { CAMERA_CONSTANTS };
