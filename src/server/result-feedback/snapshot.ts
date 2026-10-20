import { fitPreferencesSchema } from "../../lib/contracts/fit";
import {
  RESULT_FEEDBACK_TOP_MICE,
  resultFeedbackSnapshotSchema,
  type ResultFeedbackSnapshot,
} from "../../lib/contracts/result-feedback";
import { bandOf } from "../../lib/fit/bands";
import {
  surveyReferencesFor,
  type SurveyReferenceSource,
} from "../fit/auto-calibration";
import { resolveFitEngine, scoreFitDefault } from "../fit/engine";
import { listedOnly } from "../fit/listed";
import { scoringMeasurements } from "../fit/scoring-measurements";
import { groupShells } from "../fit/shell-groups";
import { fingerprintOfFit } from "../fit/fingerprint";
import type { CatalogueMouse } from "../fit/types";
import type { OwnedScan } from "../scans/repo";

const EMPTY_PREFERENCES = fitPreferencesSchema.parse({});

/**
 * The server-side snapshot of a scan (`resultFeedbackSnapshotSchema`), pure.
 *
 * It is a fresh run of the default engine on the scan's stored measurements
 * with empty preferences, the same inputs `loadOwnedFit` gives an empty fit
 * request (the scan's stated grip and palm thickness, no override), listed
 * mice only, and, for a signed-in person under the v3 engine, the same
 * automatic survey calibration (`surveyReferencesFor`: same source, same
 * threshold; the request has no references, so the survey is read, and a
 * signed-out caller reads nothing), same-shell entries grouped as the fit route groups them, and a
 * typed hand width scored on the scan's scale (`scoringMeasurements`, as in
 * `loadOwnedFit`, so the snapshot matches the page). Nothing
 * is read from `fit_results` (the fit request no longer writes it either).
 *
 * A first-three mouse whose total has no band throws (a 500): a ranked mouse
 * always has a total. The one exception is a hand outside the catalogue's
 * length range (`coverage.lengthOutOfRange`): `total` is a sort value there,
 * not a distance, so every `band` is null (v3.1, M4). A scan written before `calibration_method` existed has
 * none; it counts as `printed-sheet`, as `calibrationMethodOf` does for old
 * evidence. The result is parsed with the contract's schema, so a value
 * outside its lists throws instead of being stored.
 */
export async function buildSnapshot(
  scan: OwnedScan,
  catalogue: readonly CatalogueMouse[],
  calibration: {
    userId: string | null;
    source: SurveyReferenceSource | undefined;
  } = { userId: null, source: undefined },
): Promise<ResultFeedbackSnapshot> {
  return (await buildSnapshotAndFingerprint(scan, catalogue, calibration))
    .snapshot;
}

/**
 * `buildSnapshot`, plus the V3.2 F1 fingerprint (candidate) of the same engine
 * run (`../fit/fingerprint.ts`): the ranking the snapshot records, which is the
 * ranking an empty-preferences fit request shows (the results page sends `{}`).
 * The fingerprint is not part of the snapshot and is never stored.
 */
export async function buildSnapshotAndFingerprint(
  scan: OwnedScan,
  catalogue: readonly CatalogueMouse[],
  calibration: {
    userId: string | null;
    source: SurveyReferenceSource | undefined;
  } = { userId: null, source: undefined },
): Promise<{ snapshot: ResultFeedbackSnapshot; resultFingerprint: string }> {
  const listed = listedOnly(catalogue);
  const surveyReferences = await surveyReferencesFor({
    engine: resolveFitEngine(),
    userId: calibration.userId,
    prefs: EMPTY_PREFERENCES,
    catalogue: listed,
    source: calibration.source,
  });
  const engineOutput = scoreFitDefault(
    scoringMeasurements(scan.measurements, scan.calibrationMethod),
    listed,
    {
      ...EMPTY_PREFERENCES,
      ...(surveyReferences ? { references: surveyReferences } : {}),
      gripStyle: scan.gripStyleStated ?? undefined,
      palmThickness: scan.palmThicknessStated ?? undefined,
    },
    scan.hand,
  );
  const ranked = groupShells(engineOutput.results, listed);
  const outOfRange = engineOutput.coverage?.lengthOutOfRange === true;
  const snapshot = resultFeedbackSnapshotSchema.parse({
    engineVersion: engineOutput.engineVersion,
    handSize: engineOutput.handType?.size ?? null,
    handWidth: engineOutput.handType?.width ?? null,
    grip: engineOutput.gripStyle.used,
    calibrationMethod: scan.calibrationMethod ?? "printed-sheet",
    palmThicknessStated: scan.palmThicknessStated ?? null,
    topMice: ranked.slice(0, RESULT_FEEDBACK_TOP_MICE).map((entry) => {
      // Outside the catalogue's length range `total` is a sort value, not a
      // distance to this hand, so no band exists to store: null for every
      // mouse (the contract allows it for exactly this case).
      if (outOfRange) return { slug: entry.mouse.slug, band: null };
      const band = bandOf(entry.total);
      if (band === null) {
        throw new Error("A ranked mouse has no fit band.");
      }
      return { slug: entry.mouse.slug, band };
    }),
  });
  return {
    snapshot,
    resultFingerprint: fingerprintOfFit({ ...engineOutput, results: ranked }),
  };
}
