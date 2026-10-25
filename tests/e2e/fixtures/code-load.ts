import type { Request } from "@playwright/test";

/**
 * True for a request that only loads the app's own code: a same-origin GET of
 * a JavaScript file under /_next/static/ (a lazy chunk, and since F8 the
 * paper-detection Web Worker's script,
 * /_next/static/chunks/..._paper_worker_ts.js).
 *
 * The "zero network requests" checks exist to prove a photo never leaves the
 * browser. Downloading the worker's script is code coming in, not the photo
 * going out, and it is fetched on demand the first time the photo is
 * analysed. Everything else still counts: any other method, any other
 * origin, any other path, anything that is not a .js file.
 */
export function isSameOriginCodeChunk(request: Request, origin: string) {
  if (request.method() !== "GET") return false;
  let url: URL;
  try {
    url = new URL(request.url());
  } catch {
    return false;
  }
  return (
    url.origin === origin &&
    url.pathname.startsWith("/_next/static/") &&
    url.pathname.endsWith(".js")
  );
}
