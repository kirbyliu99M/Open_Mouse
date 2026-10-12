/**
 * The two optional questions after a measured scan (grip 1／2, palm thickness
 * 2／2) as pure logic: the page state machine, what each page's buttons may do,
 * and the submission built from the answers.
 *
 * The rules (Kirby, 2026-10-12, candidate):
 *  - Back keeps every answer. Back from the grip page returns to the measured
 *    sheet, back from the thickness page returns to the grip page.
 *  - A skip is "no answer": the field is absent from the POST. Nothing ever
 *    sends a default (`"medium"` would be stored as if the person chose it).
 *    Skipping a page clears a choice made earlier on it.
 *  - The scan is POSTed once, from the last page, with both answers in place.
 *
 * `src/lib/contracts/` already has `gripStyleStated` and `palmThicknessStated`;
 * this file only fills them.
 */
import {
  scanSubmissionSchema,
  type PalmThicknessLevel,
  type ScanSubmission,
} from "../../lib/contracts/measurement";

export type GripStyle = NonNullable<ScanSubmission["gripStyleStated"]>;

/** Where the person is: the measured sheet, or one of the two question pages. */
export type AnswerStep = "sheet" | "grip" | "thickness";

export interface AnswersState {
  readonly step: AnswerStep;
  /** `null`: not answered (never chosen, or skipped). */
  readonly grip: GripStyle | null;
  readonly thickness: PalmThicknessLevel | null;
}

export const INITIAL_ANSWERS: AnswersState = {
  step: "sheet",
  grip: null,
  thickness: null,
};

export type AnswersAction =
  /** The measured sheet's button: opens the grip page. */
  | { readonly type: "open" }
  | { readonly type: "chooseGrip"; readonly grip: GripStyle }
  /** 確認: needs a choice, otherwise nothing happens. */
  | { readonly type: "confirmGrip" }
  | { readonly type: "skipGrip" }
  | {
      readonly type: "chooseThickness";
      readonly thickness: PalmThicknessLevel;
    }
  /** The thickness page's 跳過: clears the choice; the caller then submits. */
  | { readonly type: "skipThickness" }
  | { readonly type: "back" }
  /** A new photo: the answers belonged to the old one. */
  | { readonly type: "reset" };

export function answersReducer(
  state: AnswersState,
  action: AnswersAction,
): AnswersState {
  switch (action.type) {
    case "open":
      return state.step === "sheet" ? { ...state, step: "grip" } : state;
    case "chooseGrip":
      return state.step === "grip" ? { ...state, grip: action.grip } : state;
    case "confirmGrip":
      return state.step === "grip" && state.grip !== null
        ? { ...state, step: "thickness" }
        : state;
    case "skipGrip":
      return state.step === "grip"
        ? { ...state, grip: null, step: "thickness" }
        : state;
    case "chooseThickness":
      return state.step === "thickness"
        ? { ...state, thickness: action.thickness }
        : state;
    case "skipThickness":
      return state.step === "thickness" ? { ...state, thickness: null } : state;
    case "back":
      if (state.step === "thickness") return { ...state, step: "grip" };
      if (state.step === "grip") return { ...state, step: "sheet" };
      return state;
    case "reset":
      return INITIAL_ANSWERS;
  }
}

/**
 * What the grip page's buttons may do. `required` is for the page's second use
 * (typed hand measurements, where the grip is mandatory): no 跳過, and 確認
 * stays disabled until a choice. The normal flow does not pass it.
 */
export function gripControls(
  grip: GripStyle | null,
  required: boolean,
): { readonly confirmEnabled: boolean; readonly showSkip: boolean } {
  return { confirmEnabled: grip !== null, showSkip: !required };
}

/** What the thickness page's buttons may do; while a scan is being sent none may. */
export function thicknessControls(
  thickness: PalmThicknessLevel | null,
  busy: boolean,
): {
  readonly submitEnabled: boolean;
  readonly skipEnabled: boolean;
  readonly backEnabled: boolean;
} {
  return {
    submitEnabled: thickness !== null && !busy,
    skipEnabled: !busy,
    backEnabled: !busy,
  };
}

/**
 * The submission to POST: the measured one plus whichever answers exist. An
 * unanswered question leaves no key at all, and an answer the measured
 * submission already carried is replaced by the current one (or dropped).
 */
export function buildSubmission(
  base: ScanSubmission,
  answers: Pick<AnswersState, "grip" | "thickness">,
): ScanSubmission {
  return scanSubmissionSchema.parse({
    hand: base.hand,
    measurements: base.measurements,
    calibration: base.calibration,
    measurementModelVersion: base.measurementModelVersion,
    ...(answers.grip !== null ? { gripStyleStated: answers.grip } : {}),
    ...(answers.thickness !== null
      ? { palmThicknessStated: answers.thickness }
      : {}),
  });
}
