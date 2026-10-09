/**
 * The Sentry tunnel behind /monitoring. The SDK's own `tunnelRoute` is a
 * `rewrites()` rule to the ingest host, and a rewrite to an external host
 * forwards the browser's Cookie header (the scan session and the Auth.js
 * session) and X-Forwarded-For to Sentry. So, as for PostHog
 * (src/server/analytics/proxy.ts), the tunnel is a route handler that builds
 * the upstream request itself: the envelope body and its content type,
 * nothing else.
 *
 * It only relays envelopes addressed to this app's own DSN, so it cannot be
 * used to send events to someone else's Sentry project.
 */
import { readCapped } from "@/server/analytics/proxy";

/** Largest envelope accepted. An error event with its breadcrumbs is a few KB. */
export const MAX_ENVELOPE_BYTES = 1024 * 1024;

export interface DsnTarget {
  host: string;
  projectId: string;
}

/** Host and project id of a DSN such as `https://key@o1.ingest.us.sentry.io/2`; null when it is not one. */
export function parseDsn(dsn: string | undefined): DsnTarget | null {
  if (!dsn) return null;
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }
  const projectId = url.pathname.replace(/^\/+|\/+$/g, "");
  if (url.protocol !== "https:" || !/^\d+$/.test(projectId)) return null;
  return { host: url.host, projectId };
}

/** The DSN named in an envelope's first line (its JSON header); null when there is none. */
export function envelopeDsn(body: Uint8Array): string | null {
  const newline = body.indexOf(0x0a);
  const headerLine = new TextDecoder().decode(
    newline === -1 ? body : body.subarray(0, newline),
  );
  try {
    const header: unknown = JSON.parse(headerLine);
    if (
      typeof header === "object" &&
      header !== null &&
      "dsn" in header &&
      typeof header.dsn === "string"
    )
      return header.dsn;
  } catch {
    // Not an envelope.
  }
  return null;
}

/**
 * The response headers handed back: only the two the SDK reads to back off
 * when the project is over quota. Never set-cookie.
 */
export function rateLimitHeaders(source: Headers): Headers {
  const out = new Headers();
  for (const name of ["x-sentry-rate-limits", "retry-after"]) {
    const value = source.get(name);
    if (value !== null) out.set(name, value);
  }
  return out;
}

export interface TunnelDeps {
  /** The configured DSN; unset turns the tunnel off. */
  dsn: string | undefined;
  fetchImpl: typeof fetch;
}

/** Handles one request to the tunnel. */
export async function proxyEnvelope(
  request: Request,
  deps: TunnelDeps,
): Promise<Response> {
  const target = parseDsn(deps.dsn);
  if (target === null || request.method !== "POST")
    return new Response(null, { status: 404 });

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_ENVELOPE_BYTES)
    return new Response(null, { status: 413 });
  const body = await readCapped(request, MAX_ENVELOPE_BYTES);
  if (body === null) return new Response(null, { status: 413 });

  const addressed = parseDsn(envelopeDsn(body) ?? undefined);
  if (
    addressed === null ||
    addressed.host !== target.host ||
    addressed.projectId !== target.projectId
  )
    return new Response(null, { status: 400 });

  const contentType = request.headers.get("content-type");
  let upstream: Response;
  try {
    upstream = await deps.fetchImpl(
      `https://${target.host}/api/${target.projectId}/envelope/`,
      {
        method: "POST",
        headers: contentType ? { "content-type": contentType } : {},
        body,
        redirect: "error",
      },
    );
  } catch {
    return new Response(null, { status: 502 });
  }
  return new Response(null, {
    status: upstream.status,
    headers: rateLimitHeaders(upstream.headers),
  });
}
