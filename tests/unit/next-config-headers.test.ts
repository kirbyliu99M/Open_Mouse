import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

async function rules() {
  const headers = nextConfig.headers;
  if (!headers) throw new Error("next.config.ts defines no headers()");
  return headers();
}

function valueOf(
  rule: { headers: { key: string; value: string }[] },
  key: string,
) {
  return rule.headers.find((h) => h.key.toLowerCase() === key.toLowerCase())
    ?.value;
}

describe("next.config.ts headers()", () => {
  it("caches the vendored MediaPipe files for a bounded time, never immutable", async () => {
    const rule = (await rules()).find((r) => r.source === "/mediapipe/:path*");
    expect(rule).toBeDefined();
    const cacheControl = valueOf(rule!, "Cache-Control");
    // The file names carry no hash: `immutable` (or a very long max-age) would
    // pin a replaced file in browsers.
    expect(cacheControl).toBe(
      "public, max-age=86400, stale-while-revalidate=604800",
    );
    expect(cacheControl).not.toContain("immutable");
  });

  it("puts the cache rule after the catch-all rule, so it wins if both ever set the same header", async () => {
    const sources = (await rules()).map((r) => r.source);
    expect(sources.indexOf("/mediapipe/:path*")).toBeGreaterThan(
      sources.indexOf("/:path*"),
    );
  });

  it("does not cache anything else: no other rule sets Cache-Control", async () => {
    const others = (await rules()).filter(
      (r) => r.source !== "/mediapipe/:path*",
    );
    for (const rule of others) {
      expect(valueOf(rule, "Cache-Control"), rule.source).toBeUndefined();
    }
  });

  async function cspDirective(name: string): Promise<string[]> {
    const all = (await rules()).find((r) => r.source === "/:path*");
    expect(all).toBeDefined();
    const csp = valueOf(all!, "Content-Security-Policy");
    expect(csp).toBeDefined();
    // Directives are separated by ";", the name comes first, then the sources.
    const matching = csp!
      .split(";")
      .map((directive) => directive.trim().split(/\s+/))
      .filter(([directiveName]) => directiveName === name);
    // A repeated directive is ambiguous (browsers use the first one), so it
    // must appear exactly once.
    expect(matching, `exactly one ${name} directive`).toHaveLength(1);
    return matching[0]!.slice(1);
  }

  it("sends the CSP on every route with connect-src allowing exactly 'self' (this is what stops MediaPipe's own usage metrics from leaving the browser)", async () => {
    // toEqual on the whole list, not toContain: adding a third-party origin or
    // `*` after 'self' would still contain "connect-src 'self'" but would let
    // MediaPipe's POST to odml.pa.googleapis.com through.
    expect(await cspDirective("connect-src")).toEqual(["'self'"]);
  });

  it("lets scripts come from no third-party origin: script-src holds only keywords (no host, scheme or wildcard)", async () => {
    const sources = await cspDirective("script-src");
    expect(sources).toContain("'self'");
    // Every source is a quoted keyword ('self', 'unsafe-inline', ...). A host
    // (https://cdn.example.com), a scheme (https:) or `*` would not start with
    // a quote.
    expect(sources.filter((source) => !source.startsWith("'"))).toEqual([]);
  });
});
