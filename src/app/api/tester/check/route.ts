import { testerRouteDeps } from "../../../../server/tester/route-deps";
import { handleTesterCheck } from "../../../../server/tester/service";

export const dynamic = "force-dynamic";

/** Checks a tester code (src/server/tester/service.ts). 404 unless TESTER_CODES is set. */
export async function POST(request: Request): Promise<Response> {
  return handleTesterCheck(request, testerRouteDeps("check"));
}
