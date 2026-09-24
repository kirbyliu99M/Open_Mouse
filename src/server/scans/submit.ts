import { scanSubmissionSchema } from "../../lib/contracts/measurement";
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
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
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

  const cookieSessionId = readSessionCookie(request.headers.get("cookie"));
  const existing = cookieSessionId
    ? await deps.repo.findValidSession(cookieSessionId, currentNow)
    : null;

  let sessionId: string;
  let setCookie: string | undefined;
  if (existing) {
    sessionId = existing.id;
  } else {
    const created = await deps.repo.createAnonymousSession(
      new Date(currentNow.getTime() + SESSION_TTL_MS),
    );
    sessionId = created.id;
    setCookie = buildSessionCookie(sessionId);
  }

  const { scanId } = await deps.repo.insertScanWithMeasurements({
    sessionId,
    hand: submission.hand,
    gripStyleStated: submission.gripStyleStated ?? null,
    measurements: submission.measurements,
    scaleCheckRatio:
      "cardScaleRatio" in submission.calibration
        ? submission.calibration.cardScaleRatio
        : null,
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
