import { createDrizzleScanRepo } from "../../../../server/scans/drizzle-repo";
import { handleSessionDelete } from "../../../../server/scans/session";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request): Promise<Response> {
  return handleSessionDelete(request, { repo: createDrizzleScanRepo() });
}
