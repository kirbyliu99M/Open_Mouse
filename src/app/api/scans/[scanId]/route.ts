import { auth } from "../../../../auth";
import { handleScanDelete } from "../../../../server/scans/delete";
import { createDrizzleScanRepo } from "../../../../server/scans/drizzle-repo";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ scanId: string }> },
): Promise<Response> {
  const { scanId } = await context.params;
  return handleScanDelete(request, scanId, {
    repo: createDrizzleScanRepo(),
    getUserId: async () => (await auth())?.user?.id ?? null,
  });
}
