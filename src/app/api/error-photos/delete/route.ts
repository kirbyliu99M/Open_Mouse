import { errorPhotoRouteDeps } from "../../../../server/error-photos/route-deps";
import { handleErrorPhotoDelete } from "../../../../server/error-photos/service";

export const dynamic = "force-dynamic";

/** Deletes an error photo by its deletion code (src/server/error-photos/service.ts). */
export async function POST(request: Request): Promise<Response> {
  return handleErrorPhotoDelete(request, errorPhotoRouteDeps("delete"));
}
