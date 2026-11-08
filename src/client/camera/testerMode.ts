/**
 * Tester mode of the easy-scan camera (candidate 未拍板; contract
 * src/lib/contracts/tester.ts). Types only: EasyScanCamera imports them as
 * `import type`. `/scan/easy` carries only the camera's small default-off
 * branches that read `tester` (no tester page, copy or send code). Only the
 * hidden `/scan/tester` page passes `tester`; without it nothing changes.
 *
 * With `tester` set, the camera:
 *   - reports every analysis that ended (`onAttempt`): measured, or the
 *     failure codes the sheet showed;
 *   - on 繼續 of a measured sheet hands the result over (`onMeasured`)
 *     instead of opening the question pages, so nothing is sent to
 *     `/api/scans` (no scan, no hand sample, no fit results);
 *   - hides the typed-entry ways (manual entry, "no paper" typed length) and
 *     the error-photo link: the tester page sends its own photo;
 *   - calls `onExit` from its close button instead of going home;
 *   - uses the tester's declared `reference` and shows it as a plain chip
 *     (no menu, nothing stored);
 *   - shows `privacyNotice` in place of "photos stay on the phone" (the
 *     tester page always gives it: what is sent with the photo box on or off);
 *   - leaves the reference step out of the scan tour (`referenceLocked`).
 * The tester page also mutes product analytics while it is mounted
 * (`muteTracking`, src/client/analytics/track.ts).
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
  /** How the analysed photo came in. */
  readonly captureMode: "camera" | "upload";
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
  /** The reference the tester declared: the camera uses it and offers no menu. */
  readonly reference: "a4" | "letter" | "card";
  /**
   * Replaces the "photos stay on the phone" fine print (first-run tip, tour
   * welcome, device entry) when the tester chose to send the photo.
   */
  readonly privacyNotice?: string;
  /** Shown as the close button's text (it calls `onExit`), e.g. 這次放棄. */
  readonly exitLabel?: string;
  onAttempt(attempt: TesterScanAttempt): void;
  onMeasured(result: TesterScanMeasured): void;
  onExit(): void;
}
