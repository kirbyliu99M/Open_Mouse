import { scanSubmissionSchema } from "../../lib/contracts/measurement";
import { BodyTooLargeError, readLimitedBody } from "./body-limit";
import { buildSessionCookie, readSessionCookie } from "./cookies";
import { SESSION_TTL_MS } from "./retention";
import type { ScanRepo } from "./repo";
import { defaultSweepThrottle, type SweepThrottle } from "./sweep";

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
}

/**
 * `POST /api/scans`. Thin route handlers (`src/app/api/scans/route.ts`) call
 * this with a real `ScanRepo`; tests call it with a fake one.
 *
 * Order matters: the body-size cap runs before anything touches the body's
 * bytes as JSON, and neither an oversized body nor a schema-rejected one is
 * ever echoed back or logged.
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
    scaleCheckRatio: submission.calibration.cardScaleRatio,
  });

  return json(
    201,
    { scanId },
    setCookie ? { "set-cookie": setCookie } : undefined,
  );
}
