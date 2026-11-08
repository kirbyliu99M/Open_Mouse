import { testerRouteDeps } from "../../../../server/tester/route-deps";
import { handleTesterShot } from "../../../../server/tester/service";

export const dynamic = "force-dynamic";

/** Stores one tester shot (src/server/tester/service.ts). 404 unless TESTER_CODES is set. */
export async function POST(request: Request): Promise<Response> {
  return handleTesterShot(request, testerRouteDeps("shot"));
}
