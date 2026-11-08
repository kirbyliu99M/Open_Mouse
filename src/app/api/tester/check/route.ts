import { testerRouteDeps } from "../../../../server/tester/route-deps";
import { handleTesterCheck } from "../../../../server/tester/service";

export const dynamic = "force-dynamic";

/** Checks a tester code (src/server/tester/service.ts). 404 unless TESTER_CODES is set. */
export async function POST(request: Request): Promise<Response> {
  return handleTesterCheck(request, testerRouteDeps("check"));
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
