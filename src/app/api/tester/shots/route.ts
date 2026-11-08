import { testerRouteDeps } from "../../../../server/tester/route-deps";
import { handleTesterShot } from "../../../../server/tester/service";

export const dynamic = "force-dynamic";

/** Stores one tester shot (src/server/tester/service.ts). 404 unless TESTER_CODES is set. */
export async function POST(request: Request): Promise<Response> {
  return handleTesterShot(request, testerRouteDeps("shot"));
}

/** Any other method answers 404 too: the route does not say it exists. */
function notFound(): Response {
  return new Response(JSON.stringify({ error: "Not found." }), {
    status: 404,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}
export const GET = notFound;
export const HEAD = notFound;
export const PUT = notFound;
export const DELETE = notFound;
export const PATCH = notFound;
export const OPTIONS = notFound;
