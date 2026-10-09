import {
  calibrationMethodOf,
  scanSubmissionSchema,
} from "../../lib/contracts/measurement";
import { UNKNOWN_IP_KEY, resolveClientIp } from "../analysis/ip";
import { BodyTooLargeError, readLimitedBody } from "./body-limit";
import { buildSessionCookie, readSessionCookie } from "./cookies";
import type { RateLimiter } from "./rate-limit-config";
import { SESSION_TTL_MS } from "./retention";
import type { ScanRepo } from "./repo";
import { defaultSweepThrottle, type SweepThrottle } from "./sweep";

/** No DB access, always allows — the default when a test doesn't care about
 * rate limiting, same role as `defaultSweepThrottle` plays for `sweep`. The
 * real route (`src/app/api/scans/route.ts`) always injects the DB-backed
 * limiter explicitly; this default is never reached in production. */
const ALWAYS_ALLOW_LIMITER: RateLimiter = { allow: () => true };

function json(status: number, body: unknown, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export interface SubmitScanDeps {
  repo: ScanRepo;
  /** Injectable clock; defaults to `new Date()`. */
  now?: () => Date;
  /** Injectable lazy-sweep throttle; defaults to the shared per-instance one. */
  sweep?: SweepThrottle;
  /** Per-IP submit limit (M2 hardening); defaults to an always-allow no-op —
   * see `ALWAYS_ALLOW_LIMITER` above. */
  limiter?: RateLimiter;
  /** The signed-in caller's user id, or null when signed out. Required, not
   * defaulted: a route that forgets it must fail to compile rather than
   * silently treat every signed-in user as anonymous (issue #52). */
  getUserId: () => Promise<string | null>;
}

/**
 * `POST /api/scans`. Thin route handlers (`src/app/api/scans/route.ts`) call
 * this with a real `ScanRepo`; tests call it with a fake one.
 *
 * Order matters: the body-size cap runs before anything touches the body's
 * bytes as JSON, and neither an oversized body nor a schema-rejected one is
 * ever echoed back or logged. The per-IP rate limit (M2 hardening) is
 * checked right after the submission validates and before any session or
 * scan is created — a limited caller writes nothing. No usable IP (local
 * dev, per `resolveClientIp`) is never limited, same carve-out as the
 * analysis route's per-IP limit would give it, rather than sharing one
 * bucket with every other IP-less caller.
 */
type ZodIssueLike = {
  code?: string;
  path: readonly PropertyKey[];
  message: string;
  errors?: readonly (readonly ZodIssueLike[])[];
};

/**
 * Field-level issues for the 400 body. A union (the calibration evidence)
 * that fails every branch reports one generic "Invalid input" at its own
 * path, with each branch's real issues nested under `errors`. Report the
 * branch that came closest (fewest issues) instead, with full paths, so a
 * nearly-right paper-edge body says `calibration.paperSize`, not just
 * `calibration`.
 */
export function flattenIssues(
  issues: readonly ZodIssueLike[],
  prefix: readonly PropertyKey[] = [],
): { path: string; message: string }[] {
  return issues.flatMap((issue) => {
    const path = [...prefix, ...issue.path];
    if (
      issue.code === "invalid_union" &&
      issue.errors &&
      issue.errors.length > 0
    ) {
      const closest = [...issue.errors].sort((x, y) => x.length - y.length)[0]!;
      if (closest.length > 0) return flattenIssues(closest, path);
    }
    return [{ path: path.map(String).join("."), message: issue.message }];
  });
}

export async function handleScanSubmission(
  request: Request,
  deps: SubmitScanDeps,
): Promise<Response> {
  const now = deps.now ?? (() => new Date());

  let bodyText: string;
  try {
    bodyText = await readLimitedBody(request);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return json(413, { error: "Request body too large." });
    }
    throw error;
  }

  let payload: unknown;
  try {
    payload = bodyText.length > 0 ? JSON.parse(bodyText) : undefined;
  } catch {
    return json(400, { error: "Request body must be valid JSON." });
  }

  const parsed = scanSubmissionSchema.safeParse(payload);
  if (!parsed.success) {
    return json(400, {
      error: "Invalid scan submission.",
      issues: flattenIssues(parsed.error.issues),
    });
  }
  const submission = parsed.data;
  const currentNow = now();

  // Per-IP rate limit (M2 hardening), checked before any write. No usable
  // IP (local dev) is never limited — see the function doc comment.
  const clientIp = resolveClientIp(request.headers);
  if (clientIp !== UNKNOWN_IP_KEY) {
    const limiter = deps.limiter ?? ALWAYS_ALLOW_LIMITER;
    const allowed = await limiter.allow(clientIp);
    if (!allowed) {
      return json(
        429,
        { error: "Too many scan submissions. Try again shortly." },
        { "cache-control": "no-store" },
      );
    }
  }

  // Lazy sweep (issue #17 amendment): cheap, indexed on expires_at, throttled
  // to at most once a minute per instance. Best-effort — a sweep failure
  // never fails the scan submission; the daily cron is the backstop.
  const sweep = deps.sweep ?? defaultSweepThrottle;
  try {
    await sweep.maybeSweep(deps.repo, currentNow);
  } catch {
    // swallow — see comment above
  }

  const { sessionId, setCookie } = await resolveSubmitSession(
    deps.repo,
    readSessionCookie(request.headers.get("cookie")),
    await deps.getUserId(),
    currentNow,
  );

  const { scanId } = await deps.repo.insertScanWithMeasurements({
    sessionId,
    hand: submission.hand,
    gripStyleStated: submission.gripStyleStated ?? null,
    palmThicknessStated: submission.palmThicknessStated ?? null,
    measurements: submission.measurements,
    scaleCheckRatio:
      "cardScaleRatio" in submission.calibration
        ? submission.calibration.cardScaleRatio
        : null,
    measurementModelVersion: submission.measurementModelVersion,
    calibrationMethod: calibrationMethodOf(submission.calibration),
    calibrationEvidence: submission.calibration,
  });

  // no-store (L4): the body carries a fresh scanId a client could otherwise
  // replay from a cached response.
  return json(
    201,
    { scanId },
    {
      "cache-control": "no-store",
      ...(setCookie ? { "set-cookie": setCookie } : {}),
    },
  );
}

/**
 * Which session a submitted scan is written into (issue #52). The cookie
 * only says which session the *browser* holds, never who is submitting now:
 * a browser can keep an old cookie after sign-out, or carry a fresh one into
 * a signed-in visit. So the caller's identity (`userId`, null when signed
 * out) decides whether the cookie's session may be used (`findValidSession`
 * applies the ownership rule) and what to create when it may not.
 *
 * - signed out: reuse an unclaimed, unexpired session; otherwise (no cookie,
 *   expired, unknown, or already claimed by anyone) a new anonymous session
 *   with the `SESSION_TTL_MS` expiry (20 h 30 min), and a new cookie.
 * - signed in as `userId`: reuse their own session; claim an unclaimed,
 *   unexpired one first (`claimSession`, the same step sign-in runs, for a
 *   browser that signed in before it held a cookie); otherwise (no cookie,
 *   expired, unknown, or claimed by someone else, which is never touched) a
 *   new session already claimed for them, and a new cookie.
 *
 * `setCookie` is set exactly when the session is not the one the cookie named.
 */
async function resolveSubmitSession(
  repo: ScanRepo,
  cookieSessionId: string | null,
  userId: string | null,
  now: Date,
): Promise<{ sessionId: string; setCookie?: string }> {
  let usable = cookieSessionId
    ? await repo.findValidSession(cookieSessionId, userId, now)
    : null;

  if (usable && userId !== null && usable.userId === null) {
    await repo.claimSession(usable.id, userId, now);
    // The claim is conditional (unclaimed and unexpired) and another request
    // may have won the race or the session may have just expired: trust only
    // what the database now says is this caller's.
    usable = await repo.findValidSession(usable.id, userId, now);
    if (usable && usable.userId !== userId) usable = null;
  }

  if (usable) return { sessionId: usable.id };

  const created =
    userId === null
      ? await repo.createAnonymousSession(
          new Date(now.getTime() + SESSION_TTL_MS),
        )
      : await repo.createClaimedSession(userId);
  return { sessionId: created.id, setCookie: buildSessionCookie(created.id) };
}
