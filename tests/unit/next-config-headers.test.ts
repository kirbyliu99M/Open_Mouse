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

  it("still sends the CSP with connect-src 'self' on every route (it also stops MediaPipe's own usage metrics from leaving the browser)", async () => {
    const all = (await rules()).find((r) => r.source === "/:path*");
    expect(all).toBeDefined();
    expect(valueOf(all!, "Content-Security-Policy")).toContain(
      "connect-src 'self'",
    );
  });
});
