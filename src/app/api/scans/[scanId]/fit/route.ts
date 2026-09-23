import { auth } from "../../../../../auth";
import { createDrizzleFitRepo } from "../../../../../server/fit/drizzle-repo";
import { computeFitForScan } from "../../../../../server/fit/service";
import { createDrizzleScanRepo } from "../../../../../server/scans/drizzle-repo";

export const dynamic = "force-dynamic";

async function getUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ scanId: string }> },
): Promise<Response> {
  const { scanId } = await context.params;
  return computeFitForScan(request, scanId, {
    scanRepo: createDrizzleScanRepo(),
    fitRepo: createDrizzleFitRepo(),
    getUserId,
  });
}
