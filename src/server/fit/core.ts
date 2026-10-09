import { z } from "zod";
import type { FitPreferences, FitResponse } from "../../lib/contracts/fit";
import { fitResponseSchema } from "../../lib/contracts/fit";
import type { HandMeasurements } from "../../lib/contracts/measurement";
import type { ScanRepo } from "../scans/repo";
import type { FitRepo } from "./repo";
import { buildFitResultRows } from "./rows";
import { scoreFitDefault, storedNullScore } from "./engine";
import { DEFAULT_ENGINE } from "./coefficients";
import { listedOnly } from "./listed";

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
  | { status: "ok"; fit: FitResponse; measurements: HandMeasurements }
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
 * own `fitResponseSchema`, or if persisting `fit_results` fails — an HTTP
 * adapter turns either into a 500. Every number in the result comes from
 * `scoreFit`; this function adds none of its own (hard rule 2).
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
  const engineOutput = scoreFitDefault(
    owned.measurements,
    catalogue,
    {
      ...prefs,
      gripStyle: prefs.gripStyle ?? owned.gripStyleStated ?? undefined,
    },
    owned.hand,
  );
  const response = { scanId, ...engineOutput };

  const validated = fitResponseSchema.safeParse(response);
  if (!validated.success) {
    throw new Error(
      "scoreFit produced a response that fails fitResponseSchema.",
    );
  }

  const mouseIdBySlug = new Map(
    catalogue
      .filter((m): m is typeof m & { id: string } => m.id !== undefined)
      .map((m) => [m.slug, m.id] as const),
  );
  const storedNull = storedNullScore(DEFAULT_ENGINE, catalogue);
  const rows = buildFitResultRows(
    scanId,
    engineOutput.engineVersion,
    engineOutput.results,
    mouseIdBySlug,
    (sub) => storedNull(sub, engineOutput.gripStyle.used),
  );
  await deps.fitRepo.saveFitResults(rows);

  return {
    status: "ok",
    fit: validated.data,
    measurements: owned.measurements,
  };
}
