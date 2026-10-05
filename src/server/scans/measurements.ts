import {
  scanMeasurementsResponseSchema,
  type HandMeasurements,
} from "../../lib/contracts/measurement";
import { scanSubmitResponseSchema } from "../../lib/contracts/routes";
import { UNKNOWN_IP_KEY, resolveClientIp } from "../analysis/ip";
import { readSessionCookie } from "./cookies";
import type { RateLimiter } from "./rate-limit-config";
import type { ScanRepo } from "./repo";

/** No-DB, always-allow default, same role as the fit service's. The real
 * route always injects the DB-backed limiter. */
const ALWAYS_ALLOW_LIMITER: RateLimiter = { allow: () => true };

// `no-store` on every response: the answer is a person's own hand, and it
// depends on who asks (routes.ts, `scanMeasurementsPath`).
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

export interface ScanMeasurementsDeps {
  repo: Pick<ScanRepo, "findOwnedScan">;
  /** Resolves the signed-in caller's user id, or null. Wraps `auth()` in the
   * real route; tests inject a fake. */
  getUserId: () => Promise<string | null>;
  /** Per-IP limit; defaults to an always-allow no-op. */
  limiter?: RateLimiter;
  /** Injectable clock; defaults to `new Date()`. */
  now?: () => Date;
}

/**
 * The contract says an optional measurement the scan never had is absent,
 * never null. The real repo already maps a NULL column to `undefined`; this
 * makes the guarantee here too, so a repo that hands back `null` cannot turn
 * into a null on the wire (or into a 500 from the strict schema).
 */
function withoutAbsentFields(
  measurements: HandMeasurements,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(measurements).filter(
      ([, value]) => value !== null && value !== undefined,
    ),
  );
}

/**
 * `GET /api/scans/{scanId}/measurements`: the millimetres a scan stored, for
 * the 3D viewer to scale its hand model (`scanMeasurementsPath` in routes.ts).
 *
 * Thin on purpose: ownership is `ScanRepo.findOwnedScan`'s rule, the same one
 * the fit route uses, so a foreign, expired or unknown scan is the same 404 as
 * a malformed id (never 403). Order: per-IP rate limit (429) -> malformed id
 * (404, the repo is never asked) -> ownership (404) -> 200. The body is
 * parsed with `scanMeasurementsResponseSchema` before it is sent; if the
 * stored values do not satisfy the contract the answer is a 500 with a fixed
 * sentence, never the bad data. Only the person's own derived millimetres
 * leave here: no image, and nothing the scan did not already hold.
 */
export async function handleScanMeasurements(
  request: Request,
  scanId: string,
  deps: ScanMeasurementsDeps,
): Promise<Response> {
  // Per-IP limit. No usable IP (local dev) is never limited, the same
  // carve-out as the fit and submit routes.
  const clientIp = resolveClientIp(request.headers);
  if (clientIp !== UNKNOWN_IP_KEY) {
    const limiter = deps.limiter ?? ALWAYS_ALLOW_LIMITER;
    if (!(await limiter.allow(clientIp))) {
      return json(429, {
        error: "Too many requests. Try again shortly.",
      });
    }
  }

  if (!scanSubmitResponseSchema.shape.scanId.safeParse(scanId).success) {
    return json(404, { error: "Scan not found." });
  }

  try {
    const owned = await deps.repo.findOwnedScan(scanId, {
      userId: await deps.getUserId(),
      cookieSessionId: readSessionCookie(request.headers.get("cookie")),
      now: deps.now?.() ?? new Date(),
    });
    if (!owned) return json(404, { error: "Scan not found." });

    const body = scanMeasurementsResponseSchema.parse({
      scanId,
      hand: owned.hand,
      measurements: withoutAbsentFields(owned.measurements),
    });
    return json(200, body);
  } catch {
    return json(500, { error: "Failed to load measurements." });
  }
}
