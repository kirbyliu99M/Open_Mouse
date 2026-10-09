import { proxyIngest } from "@/server/analytics/proxy";

export const dynamic = "force-dynamic";

/**
 * Same-origin proxy for PostHog events (issue #138): keeps the CSP's
 * `connect-src 'self'` and, unlike a `rewrites()` rule, forwards no cookie and
 * no client address. Everything else (other methods, other paths, no key
 * configured) is a 404.
 */
async function handle(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await params;
  return proxyIngest(request, path, {
    enabled: Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY),
    fetchImpl: fetch,
  });
}

export {
  handle as GET,
  handle as POST,
  handle as PUT,
  handle as PATCH,
  handle as DELETE,
  handle as OPTIONS,
};
