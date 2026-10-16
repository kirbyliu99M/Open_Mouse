import { fitPreferencesSchema } from "../../lib/contracts/fit";
import {
  RESULT_FEEDBACK_TOP_MICE,
  resultFeedbackSnapshotSchema,
  type ResultFeedbackSnapshot,
} from "../../lib/contracts/result-feedback";
import { bandOf } from "../../lib/fit/bands";
import { scoreFitDefault } from "../fit/engine";
import { listedOnly } from "../fit/listed";
import { scoringMeasurements } from "../fit/scoring-measurements";
import { groupShells } from "../fit/shell-groups";
import type { CatalogueMouse } from "../fit/types";
import type { OwnedScan } from "../scans/repo";

const EMPTY_PREFERENCES = fitPreferencesSchema.parse({});

/**
 * The server-side snapshot of a scan (`resultFeedbackSnapshotSchema`), pure.
 *
 * It is a fresh run of the default engine on the scan's stored measurements
 * with empty preferences, the same inputs `loadOwnedFit` gives an empty fit
 * request (the scan's stated grip and palm thickness, no override), listed
 * mice only, same-shell entries grouped as the fit route groups them, and a
 * typed hand width scored on the scan's scale (`scoringMeasurements`, as in
 * `loadOwnedFit`, so the snapshot matches the page). Nothing
 * is read from or written to `fit_results`: every fit request overwrites it
 * with that request's own preferences.
 *
 * A first-three mouse whose total has no band throws (a 500): a ranked mouse
 * always has a total. A scan written before `calibration_method` existed has
 * none; it counts as `printed-sheet`, as `calibrationMethodOf` does for old
 * evidence. The result is parsed with the contract's schema, so a value
 * outside its lists throws instead of being stored.
 */
export function buildSnapshot(
  scan: OwnedScan,
  catalogue: readonly CatalogueMouse[],
): ResultFeedbackSnapshot {
  const listed = listedOnly(catalogue);
  const engineOutput = scoreFitDefault(
    scoringMeasurements(scan.measurements, scan.calibrationMethod),
    listed,
    {
      ...EMPTY_PREFERENCES,
      gripStyle: scan.gripStyleStated ?? undefined,
      palmThickness: scan.palmThicknessStated ?? undefined,
    },
    scan.hand,
  );
  const ranked = groupShells(engineOutput.results, listed);
  return resultFeedbackSnapshotSchema.parse({
    engineVersion: engineOutput.engineVersion,
    handSize: engineOutput.handType?.size ?? null,
    handWidth: engineOutput.handType?.width ?? null,
    grip: engineOutput.gripStyle.used,
    calibrationMethod: scan.calibrationMethod ?? "printed-sheet",
    palmThicknessStated: scan.palmThicknessStated ?? null,
    topMice: ranked.slice(0, RESULT_FEEDBACK_TOP_MICE).map((entry) => {
      const band = bandOf(entry.total);
      if (band === null) {
        throw new Error("A ranked mouse has no fit band.");
      }
      return { slug: entry.mouse.slug, band };
    }),
  });
}
