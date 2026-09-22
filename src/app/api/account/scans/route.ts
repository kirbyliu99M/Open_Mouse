import { auth } from "../../../../auth";
import { createDrizzleAccountRepo } from "../../../../server/account/drizzle-repo";
import {
  handleAccountDeleteAll,
  handleAccountScansList,
} from "../../../../server/account/handlers";

export const dynamic = "force-dynamic";

async function getUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function GET(): Promise<Response> {
  return handleAccountScansList({
    repo: createDrizzleAccountRepo(),
    getUserId,
  });
}

export async function DELETE(): Promise<Response> {
  return handleAccountDeleteAll({
    repo: createDrizzleAccountRepo(),
    getUserId,
  });
}
