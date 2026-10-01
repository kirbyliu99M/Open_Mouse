/**
 * One bad photo must not stop the batch. A detector that throws on a single
 * photo (a corrupt file, an out-of-memory frame, a bug) used to reject the
 * whole `/learn/check` run, so the operator lost every photo after it and got
 * no report. Here each photo is analysed on its own: a failure becomes that
 * photo's failed report and the rest go on.
 *
 * What the failed report says is fixed text plus the error's class name
 * (`errorKind`). The error's message is dropped on purpose: it can quote a
 * file path, an account name or pixel values, and the run log must hold none
 * of them.
 */
import { failureKind } from "./errorkind";
import { assembleFailedReport, type LearningPhotoReport } from "./report";
import type { PaperSize } from "../contracts/measurement";

export { failureKind };

export const ANALYSIS_FAILED_MESSAGE =
  "This photo couldn't be analysed. Retake it, and check the others as usual.";

/** Run one photo's analysis; if it throws, return that photo's failed report instead. */
export async function analyseSafely(
  fileName: string,
  paperSize: PaperSize,
  run: () => Promise<LearningPhotoReport>,
): Promise<LearningPhotoReport> {
  try {
    return await run();
  } catch (err) {
    return assembleFailedReport(
      fileName,
      paperSize,
      ANALYSIS_FAILED_MESSAGE,
      failureKind(err),
    );
  }
}

/**
 * Analyse the files one after another (MediaPipe and the canvas are not for
 * parallel use) and return a report for every one of them, in order. Calls
 * `onProgress` with the reports so far after each photo.
 */
export async function analyseBatch<F extends { readonly name: string }>(
  files: readonly F[],
  analyse: (file: F) => Promise<LearningPhotoReport>,
  options: {
    readonly paperSize: PaperSize;
    readonly onProgress?: (done: readonly LearningPhotoReport[]) => void;
  },
): Promise<LearningPhotoReport[]> {
  const out: LearningPhotoReport[] = [];
  for (const file of files) {
    out.push(
      await analyseSafely(file.name, options.paperSize, () => analyse(file)),
    );
    options.onProgress?.([...out]);
  }
  return out;
}
