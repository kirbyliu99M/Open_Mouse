import { scanSubmitResponseSchema } from "../../lib/contracts/routes";
import { readSessionCookie } from "./cookies";
import type { ScanRepo } from "./repo";

export interface DeleteScanDeps {
  repo: Pick<ScanRepo, "deleteOwnedScan">;
  getUserId: () => Promise<string | null>;
  now?: () => Date;
}

/** DELETE /api/scans/{scanId}; the repo checks ownership in the DELETE statement. */
export async function handleScanDelete(
  request: Request,
  scanId: string,
  deps: DeleteScanDeps,
): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  if (!scanSubmitResponseSchema.shape.scanId.safeParse(scanId).success) {
    return Response.json(
      { error: "Scan not found." },
      { status: 404, headers },
    );
  }

  const deleted = await deps.repo.deleteOwnedScan(scanId, {
    userId: await deps.getUserId(),
    cookieSessionId: readSessionCookie(request.headers.get("cookie")),
    now: deps.now?.() ?? new Date(),
  });
  return deleted
    ? new Response(null, { status: 204, headers })
    : Response.json({ error: "Scan not found." }, { status: 404, headers });
}
