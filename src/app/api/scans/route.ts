import { createDrizzleScanRepo } from "../../../server/scans/drizzle-repo";
import { handleScanSubmission } from "../../../server/scans/submit";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleScanSubmission(request, { repo: createDrizzleScanRepo() });
}
