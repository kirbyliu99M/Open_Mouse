import { fitPreferencesSchema } from "../../lib/contracts/fit";
import { similarResponseSchema } from "../../lib/contracts/recommend";
import { scanSubmitResponseSchema } from "../../lib/contracts/routes";
import { UNKNOWN_IP_KEY, resolveClientIp } from "../analysis/ip";
import { DEFAULT_ENGINE } from "../fit/coefficients";
import { excludeReason } from "../fit/exclusions";
import { excludeReasonV1 } from "../fit/exclusions-v1";
import { listedOnly } from "../fit/listed";
import type { FitRepo } from "../fit/repo";
import type { CatalogueMouse } from "../fit/types";
import { log } from "../log";
import { readSessionCookie } from "../scans/cookies";
import type { RateLimiter } from "../scans/rate-limit-config";
import type { ScanRepo } from "../scans/repo";
import { binDown, resolveStoredGrip } from "../survey/profile";
import { similarHands, type Contribution } from "./neighbours";
import type { SimilarRepo } from "./repo";

/** The route name every similar-hand log line carries. */
export const SIMILAR_LOG_ROUTE = "/api/scans/[scanId]/similar";

// Every response from this path, errors included, is `no-store`: the answer
// depends on this person's hand (routes.ts, `similarPath`).
const NO_STORE = { "cache-control": "no-store" } as const;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...NO_STORE },
  });
}

export interface SimilarDeps {
  scanRepo: Pick<ScanRepo, "findOwnedScan">;
  /** The catalogue as the fit route loads it, so both read the same rows. */
  fitRepo: Pick<FitRepo, "loadCatalogue">;
  similarRepo: SimilarRepo;
  /**
   * Per-IP limit. Required, not defaulted: a route that forgets it must fail
   * to compile rather than ship unlimited.
   */
  limiter: RateLimiter;
  /** The signed-in caller's user id, or null. Wraps `auth()` in the real route. */
  getUserId: () => Promise<string | null>;
  /** Injectable clock; defaults to `new Date()`. */
  now?: () => Date;
}

/**
 * What a log line may say about a failure: the route and the error's class
 * (log.ts reduces an Error to its name and a short code). Never a hand size, a
 * bin, a rating or a name. Also the route's answer when it cannot even build
 * its dependencies (a missing or malformed `DATABASE_URL`).
 */
export function logFailure(error: unknown): Response {
  log.error("similar.failed", { route: SIMILAR_LOG_ROUTE, error });
  return json(500, { error: "Something went wrong. Try again in a moment." });
}

// The fit's defaults: no stored preference exists, so `includeVertical` is off,
// as it is for a person who has not touched the filter.
const DEFAULT_PREFERENCES = fitPreferencesSchema.parse({});

/**
 * Whether the fit leaves this mouse out for a person with this hand. It asks
 * the engine `DEFAULT_ENGINE` names, through that engine's own rule
 * (`excludeReason` for v0, `excludeReasonV1` for v1), so a change to the switch
 * or to a rule moves this route with the fit and no rule is copied here.
 */
function fitExcludes(mouse: CatalogueMouse, hand: "left" | "right"): boolean {
  const reason =
    DEFAULT_ENGINE === "v1"
      ? excludeReasonV1(mouse, hand, DEFAULT_PREFERENCES)
      : excludeReason(mouse, hand, DEFAULT_PREFERENCES);
  return reason !== null;
}

/**
 * `GET /api/scans/{scanId}/similar`. Order: per-IP rate limit (429) ->
 * malformed id (404, the scan repo is never asked) -> ownership (404, one body
 * for every cause) -> the answer (200).
 *
 * The caller's hand profile is read from the scan on the server and rounded
 * down to the bins, as a contribution's is (`../survey/profile.ts`). Before
 * the engine runs, the pool is cut down to what this caller may be shown
 * (neighbours.ts, "What the caller of this function must do"): ratings of mice
 * with `listed = false` and of mice the fit excludes for this hand are dropped,
 * so they are neither listed nor counted in the prior. Names come from the
 * current `mice` row by `mouse_id`, never from a contribution. A contributor
 * stays a neighbour when every one of their ratings was dropped: their hand is
 * still in the pool.
 *
 * `ownContributionIds` is every contribution of the signed-in caller's
 * account. An anonymous caller has none: a contribution made from this scan
 * cannot be told from anyone else's (the engine's documented known limit).
 *
 * The body is parsed with `similarResponseSchema` before it is sent; an answer
 * that fails it is a 500 with a fixed sentence, never the data. Nothing from a
 * contribution is logged.
 */
export async function handleSimilar(
  request: Request,
  scanId: string,
  deps: SimilarDeps,
): Promise<Response> {
  try {
    // No usable IP (local dev) is never limited: the carve-out every scan
    // route makes.
    const clientIp = resolveClientIp(request.headers);
    if (clientIp !== UNKNOWN_IP_KEY && !(await deps.limiter.allow(clientIp))) {
      return json(429, { error: "Too many requests. Try again shortly." });
    }

    if (!scanSubmitResponseSchema.shape.scanId.safeParse(scanId).success) {
      return json(404, { error: "Scan not found." });
    }

    const userId = await deps.getUserId();
    const scan = await deps.scanRepo.findOwnedScan(scanId, {
      userId,
      cookieSessionId: readSessionCookie(request.headers.get("cookie")),
      now: (deps.now ?? (() => new Date()))(),
    });
    if (!scan) return json(404, { error: "Scan not found." });

    const shown = new Map<string, CatalogueMouse>();
    for (const mouse of listedOnly(await deps.fitRepo.loadCatalogue())) {
      if (mouse.id !== undefined && !fitExcludes(mouse, scan.hand)) {
        shown.set(mouse.id, mouse);
      }
    }

    const pooled = await deps.similarRepo.loadContributions();
    const pool: Contribution[] = pooled.map((contribution) => ({
      id: contribution.id,
      handLengthBinMm: contribution.handLengthBinMm,
      palmWidthBinMm: contribution.palmWidthBinMm,
      gripStyle: contribution.gripStyle,
      ratings: contribution.ratings.flatMap((rating) => {
        const mouse = shown.get(rating.mouseId);
        return mouse === undefined
          ? []
          : [
              {
                slug: mouse.slug,
                brand: mouse.brand,
                model: mouse.model,
                satisfaction: rating.satisfaction,
              },
            ];
      }),
    }));
    const ownContributionIds = new Set(
      userId === null
        ? []
        : pooled.filter((c) => c.userId === userId).map((c) => c.id),
    );

    const answer = similarHands(
      {
        handLengthBinMm: binDown(scan.measurements.handLengthMm),
        palmWidthBinMm: binDown(scan.measurements.palmWidthMm),
        gripStyle: resolveStoredGrip(
          undefined,
          scan.gripStyleStated ?? null,
          scan.measurements,
        ),
        ownContributionIds,
      },
      pool,
    );

    const response = similarResponseSchema.parse(answer);
    log.info("similar.answered", {
      route: SIMILAR_LOG_ROUTE,
      available: response.available,
    });
    return json(200, response);
  } catch (error) {
    return logFailure(error);
  }
}
