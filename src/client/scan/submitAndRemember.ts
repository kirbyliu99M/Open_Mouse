/**
 * Sending a scan and, only once it was stored, remembering on this device what
 * the results page needs to say about HOW the numbers came about:
 *
 *  - a typed hand length (`user-length`): `resultLengthKey`, the length;
 *  - a typed hand length and width (`manual-entry`): `resultManualEntryKey`,
 *    the pair as JSON.
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
  serializeManualEntry,
} from "../../components/results/userLengthDisclosure";
import { submitScan, type SubmitScanOutcome } from "./submitScan";

type SetItemStorage = Pick<Storage, "setItem">;

/** Writes the key of this scan's calibration method, if it has one. Never throws. */
export function rememberScanDisclosures(
  storage: SetItemStorage | null,
  submission: ScanSubmission,
  scanId: string,
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
): Promise<SubmitScanOutcome> {
  const outcome = await submitScan(submission, fetchImpl);
  if (outcome.status === "success")
    rememberScanDisclosures(storage, submission, outcome.scanId);
  return outcome;
}
