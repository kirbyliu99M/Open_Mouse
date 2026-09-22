import { z } from "zod";
import {
  fitPreferencesSchema,
  fitResponseSchema,
} from "../../lib/contracts/fit";
import { BodyTooLargeError, readLimitedBody } from "../scans/body-limit";
import { readSessionCookie } from "../scans/cookies";
import type { ScanRepo } from "../scans/repo";
import { buildFitResultRows } from "./rows";
import type { FitRepo } from "./repo";
import { scoreFit } from "./score";

// `no-store`: every response here carries personal hand-measurement data or
// a ranking derived from it (same finding as #24/M6).
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

const scanIdSchema = z.string().uuid();

export interface FitServiceDeps {
  scanRepo: ScanRepo;
  fitRepo: FitRepo;
  /** Resolves the signed-in caller's user id, or null. Wraps `auth()` in the
   * real route; tests inject a fake so no NextAuth machinery runs here. */
  getUserId: () => Promise<string | null>;
  /** Injectable clock; defaults to `new Date()`. */
  now?: () => Date;
}

/**
 * `POST /api/scans/{scanId}/fit`. Thin route handlers
 * (`src/app/api/scans/[scanId]/fit/route.ts`) call this with real repos;
 * tests call it with fakes — no real database or clock required.
 *
 * Order: malformed scan id (404) → oversized body (413) → ownership (404)
 * → invalid preferences (400) → compute + validate + persist → 200. Every
 * non-owner — unknown scan, wrong session, expired anonymous scan, and a
 * malformed id — gets the exact same 404 body, so a scan id is never an
 * oracle for whether it exists (routes.ts header). The response is
 * validated against `fitResponseSchema` before it is ever returned or
 * persisted: a response that fails its own contract is a 500, never a
 * silently malformed 200 (issue #27, criterion 1).
 */
export async function computeFitForScan(
  request: Request,
  scanId: string,
  deps: FitServiceDeps,
): Promise<Response> {
  const now = deps.now ?? (() => new Date());

  if (!scanIdSchema.safeParse(scanId).success) {
    return json(404, { error: "Scan not found." });
  }

  let bodyText: string;
  try {
    bodyText = await readLimitedBody(request);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return json(413, { error: "Request body too large." });
    }
    throw error;
  }

  const userId = await deps.getUserId();
  const cookieSessionId = readSessionCookie(request.headers.get("cookie"));
  const owned = await deps.scanRepo.findOwnedScan(scanId, {
    userId,
    cookieSessionId,
    now: now(),
  });
  if (!owned) {
    return json(404, { error: "Scan not found." });
  }

  let payload: unknown;
  try {
    // An empty body means "no preferences" — the same thing `{}` means
    // (fitPreferencesSchema, contract header) — rather than a parse error.
    payload = bodyText.length > 0 ? JSON.parse(bodyText) : {};
  } catch {
    return json(400, { error: "Request body must be valid JSON." });
  }

  const parsedPrefs = fitPreferencesSchema.safeParse(payload);
  if (!parsedPrefs.success) {
    return json(400, {
      error: "Invalid fit preferences.",
      issues: parsedPrefs.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const catalogue = await deps.fitRepo.loadCatalogue();
  // Every number below comes from scoreFit — this handler adds none of its
  // own (hard rule 2, issue #27 criterion 6).
  const engineOutput = scoreFit(
    owned.measurements,
    catalogue,
    parsedPrefs.data,
    owned.hand,
  );
  const response = { scanId, ...engineOutput };

  const validated = fitResponseSchema.safeParse(response);
  if (!validated.success) {
    return json(500, { error: "Failed to compute a valid fit response." });
  }

  const mouseIdBySlug = new Map(
    catalogue
      .filter((m): m is typeof m & { id: string } => m.id !== undefined)
      .map((m) => [m.slug, m.id] as const),
  );
  try {
    const rows = buildFitResultRows(
      scanId,
      engineOutput.engineVersion,
      engineOutput.results,
      mouseIdBySlug,
    );
    await deps.fitRepo.saveFitResults(rows);
  } catch {
    return json(500, { error: "Failed to save fit results." });
  }

  return json(200, validated.data);
}
