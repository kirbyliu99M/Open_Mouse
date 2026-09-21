import type { ScanRepo } from "./repo";

export interface ExpireSessionsDeps {
  repo: ScanRepo;
  /** `undefined` (unset env var) always fails the check — never open by default. */
  cronSecret: string | undefined;
  now?: () => Date;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * `GET /api/cron/expire-sessions`. Vercel Cron sends `CRON_SECRET` as a
 * bearer token (vercel.json's hourly schedule); any other caller gets 401.
 */
export async function handleExpireSessions(
  request: Request,
  deps: ExpireSessionsDeps,
): Promise<Response> {
  const authorization = request.headers.get("authorization");
  if (!deps.cronSecret || authorization !== `Bearer ${deps.cronSecret}`) {
    return json(401, { error: "Unauthorized" });
  }
  const now = deps.now ?? (() => new Date());
  const deleted = await deps.repo.deleteExpiredAnonymousSessions(now());
  return json(200, { deleted });
}
