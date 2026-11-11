import { errorPhotoRouteDeps } from "../../../server/error-photos/route-deps";
import { handleErrorPhotoUpload } from "../../../server/error-photos/service";

export const dynamic = "force-dynamic";

/** The opt-in error photo upload (src/server/error-photos/service.ts). */
export async function POST(request: Request): Promise<Response> {
  return handleErrorPhotoUpload(request, errorPhotoRouteDeps("upload"));
}
