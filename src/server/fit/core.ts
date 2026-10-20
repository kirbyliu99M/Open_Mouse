import { z } from "zod";
import type { FitPreferences, FitResponse } from "../../lib/contracts/fit";
import { fitResponseSchema } from "../../lib/contracts/fit";
import type {
  CalibrationMethod,
  HandMeasurements,
} from "../../lib/contracts/measurement";
import type { ScanRepo } from "../scans/repo";
import type { FitRepo } from "./repo";
import { scoreFitDefault } from "./engine";
import { scoringMeasurements } from "./scoring-measurements";
import { listedOnly } from "./listed";
import { withFilterFacts } from "./filter-facts";
import { withPhotos } from "./photos";
import mouseMediaFile from "../../data/mouse-media.json";
import { groupShells } from "./shell-groups";

const scanIdSchema = z.string().uuid();

/** The caller identity a fit (or, later, analysis) request resolves ownership
 * against — never a `Request`, a cookie header, or anything HTTP-shaped, so
 * this stays reusable from any adapter. */
export interface FitOwner {
  /** The signed-in caller's user id, or null when not signed in. */
  userId: string | null;
  /** The session id named by the caller's own anonymous session cookie, or
   * null when absent. */
  cookieSessionId: string | null;
}

export interface FitCoreDeps {
  scanRepo: ScanRepo;
  fitRepo: FitRepo;
  /** Injectable clock; defaults to `new Date()`. */
  now?: () => Date;
}

export type LoadOwnedFitResult =
  | {
      status: "ok";
      fit: FitResponse;
      measurements: HandMeasurements;
      /** How the numbers came about; null for a row written before the column. */
      calibrationMethod: CalibrationMethod | null;
    }
  | { status: "not_found" };

/**
 * The data-level core shared by every route that needs "this scan's fit,
 * scoped to its owner" — today `POST /api/scans/{scanId}/fit`, and the
 * analysis route next, which needs the same ownership check and the same
 * `FitResponse` plus the scan's `HandMeasurements` as plain data, not an
 * HTTP `Response` to re-parse. One implementation of the ownership rule
 * (`src/lib/contracts/routes.ts` header) for both, so they cannot drift
 * apart from each other.
 *
 * Returns `{ status: "not_found" }` for every case where the caller does
 * not own this scan — unknown scan id, malformed (non-UUID) scan id, a
 * scan belonging to someone else, or an expired anonymous scan — so every
 * non-owner is indistinguishable from every other (routes.ts: 404, never
 * 403). `scanId`'s format is checked here, before the repo is ever asked,
 * so a malformed id can't reach the database.
 *
 * Throws (never silently returns bad data) if `scoreFit`'s output fails its
 * own `fitResponseSchema` — an HTTP adapter turns that into a 500. Nothing is
 * stored: since 2026-10-20 the request path no longer writes `fit_results`
 * (the table stays for old rows; nothing reads it). Every number in the result
 * comes from `scoreFit`; this function adds none of its own (hard rule 2).
 */
export async function loadOwnedFit(
  scanId: string,
  owner: FitOwner,
  prefs: FitPreferences,
  deps: FitCoreDeps,
): Promise<LoadOwnedFitResult> {
  if (!scanIdSchema.safeParse(scanId).success) {
    return { status: "not_found" };
  }

  const now = deps.now ?? (() => new Date());
  const owned = await deps.scanRepo.findOwnedScan(scanId, {
    userId: owner.userId,
    cookieSessionId: owner.cookieSessionId,
    now: now(),
  });
  if (!owned) {
    return { status: "not_found" };
  }

  // Unlisted rows (CAT-1) leave here, before scoring and before the priors.
  const catalogue = listedOnly(await deps.fitRepo.loadCatalogue());
  // A typed width is scored on the scan's scale; `owned.measurements` itself
  // (returned below, shown on the page) stays as typed.
  const engineOutput = scoreFitDefault(
    scoringMeasurements(owned.measurements, owned.calibrationMethod),
    catalogue,
    {
      ...prefs,
      gripStyle: prefs.gripStyle ?? owned.gripStyleStated ?? undefined,
      // A skipped answer is null in the scan; it must reach the engine as
      // undefined (no shift), never as "medium".
      palmThickness:
        prefs.palmThickness ?? owned.palmThicknessStated ?? undefined,
    },
    owned.hand,
  );
  // Same-shell entries become one card; ranks are renumbered. `excluded` is
  // untouched.
  // The filter's catalogue facts (shape, connectivity) ride along after the
  // grouping; nothing scores on them and the analysis never sees them. The
  // product photo (a static file) follows, for every entry; the same holds for
  // it. The official and purchase links are not here: the page fetches them for
  // its one big-header mouse from `/api/mice/<slug>/links`.
  const results = withPhotos(
    withFilterFacts(groupShells(engineOutput.results, catalogue), catalogue),
    mouseMediaFile,
  );
  const response = { scanId, ...engineOutput, results };

  const validated = fitResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      "scoreFit produced a response that fails fitResponseSchema.",
    );
  }

  return {
    status: "ok",
    fit: validated.data,
    measurements: owned.measurements,
    calibrationMethod: owned.calibrationMethod ?? null,
  };
}
