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
  | "perfect";

export interface Cue {
  readonly code: CueCode;
  readonly message: string;
  /** True only for "perfect" — every check passed, auto-capture may run. */
  readonly allPass: boolean;
}

const CUE_MESSAGES: Record<CueCode, string> = {
  "place-paper": "Place a blank sheet of paper on a darker surface",
  "no-corners": "Point the camera at the paper",
  "some-corners": "Move back so all four paper corners are in view",
  tilted: "Hold the phone flat above the paper",
  "too-far": "Move closer",
  "too-close": "Move back a little",
  dark: "More light, please",
  bright: "Too bright — avoid glare",
  "hold-still": "Hold still",
  perfect: "Perfect — hold still",
};

function cue(code: CueCode): Cue {
  return { code, message: CUE_MESSAGES[code], allPass: code === "perfect" };
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
export function pickCue(input: CueInput): Cue {
  if (input.cornersSeen <= 0) {
    if (
      input.msSinceLastDetection >
      CAMERA_CONSTANTS.noDetection.placePaperTimeoutMs
    ) {
      return cue("place-paper");
    }
    return cue("no-corners");
  }
  if (input.cornersSeen < 4) return cue("some-corners");
  if (!input.quad) return cue("some-corners");

  const skew = computeQuadSkew(input.quad);
  if (isQuadSkewed(skew)) return cue("tilted");

  const widthFraction = computeQuadWidthFraction(input.quad, input.frameWidth);
  const sizeStatus = computeQuadSizeStatus(widthFraction);
  if (sizeStatus === "too-far") return cue("too-far");
  if (sizeStatus === "too-close") return cue("too-close");

  const light: LightStatus = computeLightStatus(
    input.meanLuma,
    input.clippedFraction,
  );
  if (light === "dark") return cue("dark");
  if (light === "bright") return cue("bright");

  if (!input.steady || !input.sharpEnough) return cue("hold-still");

  return cue("perfect");
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
export function computeStatusChips(input: CueInput): StatusChips {
  const paperPass = input.cornersSeen >= 4;
  const light = computeLightStatus(input.meanLuma, input.clippedFraction);
  return {
    paper: { label: `Paper ${input.cornersSeen}/4`, pass: paperPass },
    steady: { label: "Steady", pass: input.steady && input.sharpEnough },
    light: { label: "Light", pass: light === "ok" },
  };
}

export { CAMERA_CONSTANTS };
