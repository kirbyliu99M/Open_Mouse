/**
 * Sending a scan and, only once it was stored, remembering on this device what
 * the results page needs to say about HOW the numbers came about:
 *
 *  - a typed hand length (`user-length`): `resultLengthKey`, the length;
 *  - a typed hand length and width (`manual-entry`): `resultManualEntryKey`,
 *    the pair as JSON;
 *  - a paper frame placed or moved by hand (`paper-edge` with `cornersSource`
 *    adjusted or manual, V3.2 F2): `resultPaperAdjustedKey`, "1"; and when
 *    that frame was placed after the sheet was found curled (`PAPER_CURLED`,
 *    the caller's `notes.paperCurled`, V3.2 F13), `resultPaperCurledKey`, "1".
 *    The scan's submission carries neither: they stay in this browser.
 *
 * Each calibration method writes its own key and no other; a scan measured
 * from a photo writes none, and a failed send writes nothing. Pure of React so
 * the rule is testable without a browser (`useScanSubmit` is the thin hook on
 * top).
 */
import type { ScanSubmission } from "../../lib/contracts/measurement";
import {
  resultLengthKey,
  resultManualEntryKey,
  resultPaperAdjustedKey,
  resultPaperCurledKey,
  serializeManualEntry,
} from "../../components/results/userLengthDisclosure";
import { submitScan, type SubmitScanOutcome } from "./submitScan";

type SetItemStorage = Pick<Storage, "setItem">;

/** What the scan page knows about how the scan was made that the submission does not carry. */
export interface ScanLocalNotes {
  /** The hand-placed frame was confirmed after a `PAPER_CURLED` result (V3.2 F13). */
  readonly paperCurled?: boolean;
}

/** Writes the key of this scan's calibration method, if it has one. Never throws. */
export function rememberScanDisclosures(
  storage: SetItemStorage | null,
  submission: ScanSubmission,
  scanId: string,
  notes: ScanLocalNotes = {},
): void {
  if (!storage) return;
  try {
    const calibration = submission.calibration;
    if (!("method" in calibration)) return;
    if (calibration.method === "user-length") {
      storage.setItem(resultLengthKey(scanId), String(calibration.referenceMm));
    } else if (calibration.method === "manual-entry") {
      storage.setItem(
        resultManualEntryKey(scanId),
        serializeManualEntry({
          handLengthMm: calibration.handLengthMm,
          handWidthMm: calibration.handWidthMm,
        }),
      );
    } else if (
      calibration.method === "paper-edge" &&
      (calibration.cornersSource ?? "auto") !== "auto"
    ) {
      storage.setItem(resultPaperAdjustedKey(scanId), "1");
      if (notes.paperCurled === true)
        storage.setItem(resultPaperCurledKey(scanId), "1");
    }
  } catch {
    // Storage may be disabled; the results stay available without the note.
  }
}

/** `submitScan`, then `rememberScanDisclosures` on a success and nothing on a failure. */
export async function submitAndRemember(
  submission: ScanSubmission,
  storage: SetItemStorage | null,
  fetchImpl: typeof fetch = fetch,
  notes: ScanLocalNotes = {},
): Promise<SubmitScanOutcome> {
  const outcome = await submitScan(submission, fetchImpl);
  if (outcome.status === "success")
    rememberScanDisclosures(storage, submission, outcome.scanId, notes);
  return outcome;
}
