/**
 * The single prioritised cue line and the three status chips
 * (docs/design/camera-capture-2026-09-25/README.md's numbered priority
 * list). Pure — combines the checks in quad.ts/light.ts/steadiness.ts into
 * one ordered decision, so the priority order itself is unit-tested
 * directly rather than only exercised incidentally through the component.
 */
import { CAMERA_CONSTANTS } from "./constants";
import { computeQuadSkew, isQuadSkewed, computeQuadWidthFraction, computeQuadSizeStatus, type Quad } from "./quad";
import { computeLightStatus, type LightStatus } from "./light";

export type CueCode =
  | "no-markers"
  | "some-markers"
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
  "no-markers": "Point the camera at the sheet",
  "some-markers": "Move back so all four corners are in view",
  tilted: "Hold the phone flat above the sheet",
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
  /** Number of the four flat-flap markers (ids 0-3) detected in this sample. */
  readonly markerCount: number;
  /** The tracked sheet quad — required once markerCount === 4. */
  readonly quad: Quad | null;
  readonly frameWidth: number;
  readonly meanLuma: number;
  readonly clippedFraction: number;
  readonly steady: boolean;
  readonly sharpEnough: boolean;
}

/**
 * The one cue to show, per the spec's fixed priority order. Every input
 * after markers is only consulted once 4/4 markers are found and a quad
 * exists — a partial marker set always short-circuits to "some-markers".
 */
export function pickCue(input: CueInput): Cue {
  if (input.markerCount <= 0) return cue("no-markers");
  if (input.markerCount < 4) return cue("some-markers");
  if (!input.quad) return cue("some-markers");

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
  readonly sheet: StatusChip;
  readonly steady: StatusChip;
  readonly light: StatusChip;
}

/**
 * The three always-visible status chips (`Sheet 4/4`, `Steady`, `Light`) —
 * redundant with the cue line for anyone scanning rather than reading, per
 * the spec.
 */
export function computeStatusChips(input: CueInput): StatusChips {
  const sheetPass = input.markerCount >= 4;
  const light = computeLightStatus(input.meanLuma, input.clippedFraction);
  return {
    sheet: { label: `Sheet ${Math.min(input.markerCount, 4)}/4`, pass: sheetPass },
    steady: { label: "Steady", pass: input.steady && input.sharpEnough },
    light: { label: "Light", pass: light === "ok" },
  };
}

export { CAMERA_CONSTANTS };
