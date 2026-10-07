/**
 * The pure parts of the PostHog reverse proxy (issue #138). A Next `rewrites()`
 * rule to an external host would forward the browser's Cookie header (the scan
 * session and the Auth.js session) and X-Forwarded-For to PostHog, so the proxy
 * is a route handler that builds the upstream request itself from an allowlist.
 */
export const POSTHOG_INGEST_ORIGIN = "https://us.i.posthog.com";

/** The only request headers that reach PostHog. Never cookie, authorization or any forwarding header. */
const FORWARDED_REQUEST_HEADERS = ["content-type", "content-encoding"] as const;

/** posthog-js 1.438.2 posts events to `/e/` (older paths listed too). */
const INGEST_PATHS = new Set(["e", "i/v0/e", "batch", "capture"]);

/** Largest body accepted: a batch of events is a few KB. */
export const MAX_INGEST_BODY_BYTES = 256 * 1024;

export function filterRequestHeaders(source: Headers): Headers {
  const out = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = source.get(name);
    if (value !== null) out.set(name, value);
  }
  return out;
}

/** The response headers handed back: content type only, so no set-cookie. */
export function filterResponseHeaders(source: Headers): Headers {
  const out = new Headers();
  const type = source.get("content-type");
  if (type !== null) out.set("content-type", type);
  return out;
}

/** True when `segments` (the catch-all, a trailing slash arrives as nothing) is an ingestion path. */
export function isIngestPath(segments: readonly string[]): boolean {
  return INGEST_PATHS.has(segments.join("/"));
}

/** Reads the body as a stream and stops as soon as it passes `cap`; null when it does. */
export async function readCapped(
  request: Request,
  cap: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export interface ProxyDeps {
  /** True when a project key is configured. */
  enabled: boolean;
  fetchImpl: typeof fetch;
}

/** Handles one proxied request. `segments` is the route's catch-all. */
export async function proxyIngest(
  request: Request,
  segments: readonly string[],
  deps: ProxyDeps,
): Promise<Response> {
  if (!deps.enabled || request.method !== "POST" || !isIngestPath(segments))
    return new Response(null, { status: 404 });

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_INGEST_BODY_BYTES)
    return new Response(null, { status: 413 });
  const body = await readCapped(request, MAX_INGEST_BODY_BYTES);
  if (body === null) return new Response(null, { status: 413 });

  const search = new URL(request.url).search;
  let upstream: Response;
  try {
    upstream = await deps.fetchImpl(
      `${POSTHOG_INGEST_ORIGIN}/${segments.join("/")}/${search}`,
      {
        method: "POST",
        headers: filterRequestHeaders(request.headers),
        body,
        redirect: "error",
      },
    );
  } catch {
    return new Response(null, { status: 502 });
  }
  // These statuses may not carry a body (Response throws if one is given).
  if ([101, 204, 205, 304].includes(upstream.status))
    return new Response(null, { status: upstream.status });
  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: filterResponseHeaders(upstream.headers),
  });
}
