/**
 * Tester mode of the easy-scan camera (candidate 未拍板; contract
 * src/lib/contracts/tester.ts). Types only: EasyScanCamera imports them as
 * `import type`, so `/scan/easy` carries no tester code. Only the hidden
 * `/scan/tester` page passes `tester`; without it nothing changes.
 *
 * With `tester` set, the camera:
 *   - reports every analysis that ended (`onAttempt`): measured, or the
 *     failure codes the sheet showed;
 *   - on 繼續 of a measured sheet hands the result over (`onMeasured`)
 *     instead of opening the question pages, so nothing is sent to
 *     `/api/scans` (no scan, no hand sample, no fit results);
 *   - hides the typed-entry ways (manual entry, "no paper" typed length) and
 *     the error-photo link: the tester page sends its own photo;
 *   - calls `onExit` from its close button instead of going home.
 */
import type {
  HandMeasurements,
  ScanSubmission,
} from "../../lib/contracts/measurement";

/** The overlay fields the photo preparation needs (prepare.ts `ErrorPhotoOverlay`). */
export interface TesterPhotoOverlay {
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly landmarksPx:
    readonly { readonly x: number; readonly y: number }[] | null;
  readonly paperCorners?:
    readonly { readonly x: number; readonly y: number }[] | null;
  readonly paperPartialCorners?: readonly ({
    readonly x: number;
    readonly y: number;
  } | null)[];
  readonly paperGuessCorners?: readonly {
    readonly x: number;
    readonly y: number;
  }[];
}

export interface TesterScanAttempt {
  readonly measured: boolean;
  /** The failure codes the sheet showed for this analysis, in order. */
  readonly failureCodes: readonly string[];
}

export interface TesterScanMeasured {
  readonly measurements: HandMeasurements;
  readonly submission: ScanSubmission;
  readonly captureMode: "camera" | "upload";
  /** What `prepareErrorPhoto` needs, or null when the photo is gone. */
  readonly photo: {
    readonly file: Blob;
    readonly overlay: TesterPhotoOverlay;
    readonly mode: "paper" | "card";
  } | null;
}

export interface TesterScanHooks {
  onAttempt(attempt: TesterScanAttempt): void;
  onMeasured(result: TesterScanMeasured): void;
  onExit(): void;
}
