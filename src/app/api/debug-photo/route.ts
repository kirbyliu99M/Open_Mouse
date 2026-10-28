import { put } from "@vercel/blob";
import { handleDebugPhoto } from "../../../server/debug/debugPhoto";

export const dynamic = "force-dynamic";

/** Debug photos on a preview only (src/server/debug/debugPhoto.ts). */
export async function POST(request: Request): Promise<Response> {
  return handleDebugPhoto(request, {
    // Only these variables, never the whole environment.
    env: {
      VERCEL_ENV: process.env.VERCEL_ENV,
      VERCEL_URL: process.env.VERCEL_URL,
      BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    },
    put: async (pathname, body, contentType) => {
      await put(pathname, body, {
        access: "private",
        contentType,
        addRandomSuffix: false,
        allowOverwrite: true,
      });
    },
  });
}
