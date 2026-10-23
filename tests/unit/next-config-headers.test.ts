import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("caches the product photos for a bounded time, never immutable (the names carry no hash)", async () => {
    const rule = (await rules()).find(
      (r) => r.source === "/images/mice/:path*",
    );
    expect(rule).toBeDefined();
    const cacheControl = valueOf(rule!, "Cache-Control");
    expect(cacheControl).toBe(
      "public, max-age=86400, stale-while-revalidate=604800",
    );
    expect(cacheControl).not.toContain("immutable");
  });

  it("puts the cache rules after the catch-all rule, so they win if both ever set the same header", async () => {
    const sources = (await rules()).map((r) => r.source);
    for (const source of ["/mediapipe/:path*", "/images/mice/:path*"]) {
      expect(sources.indexOf(source)).toBeGreaterThan(
        sources.indexOf("/:path*"),
      );
    }
  });

  it("does not cache anything else: no other rule sets Cache-Control", async () => {
    const others = (await rules()).filter(
      (r) =>
        r.source !== "/mediapipe/:path*" && r.source !== "/images/mice/:path*",
    );
    for (const rule of others) {
      expect(valueOf(rule, "Cache-Control"), rule.source).toBeUndefined();
    }
  });

  /**
   * The sources of one CSP directive. A directive that is absent gives [] when
   * `optional` is set (script-src-elem is not sent today, but a future one must
   * still be checked). A repeated directive is ambiguous (browsers use the
   * first one), so it may appear at most once, and exactly once unless optional.
   */
  async function cspDirective(
    name: string,
    { optional = false } = {},
  ): Promise<string[]> {
    const all = (await rules()).find((r) => r.source === "/:path*");
    expect(all).toBeDefined();
    const csp = valueOf(all!, "Content-Security-Policy");
    expect(csp).toBeDefined();
    // Directives are separated by ";", the name comes first, then the sources.
    const matching = csp!
      .split(";")
      .map((directive) => directive.trim().split(/\s+/))
      .filter(([directiveName]) => directiveName === name);
    if (optional && matching.length === 0) return [];
    expect(matching, `exactly one ${name} directive`).toHaveLength(1);
    return matching[0]!.slice(1);
  }

  it("sends the CSP on every route with connect-src allowing exactly 'self' (this is what stops MediaPipe's own usage metrics from leaving the browser)", async () => {
    // toEqual on the whole list, not toContain: adding a third-party origin or
    // `*` after 'self' would still contain "connect-src 'self'" but would let
    // MediaPipe's POST to odml.pa.googleapis.com through.
    expect(await cspDirective("connect-src")).toEqual(["'self'"]);
  });

  // Every directive that decides where code or workers may load from. A source
  // is a quoted keyword ('self', 'unsafe-inline', ...) or, for worker-src only,
  // the blob: scheme (see next.config.ts). A host (https://cdn.example.com),
  // any other scheme (https:, data:) or `*` does not start with a quote, so it
  // is caught. default-src is the fallback for every fetch directive that is
  // not listed, so it is held to the same rule.
  it.each([
    { name: "default-src", optional: false, extra: [] as string[] },
    { name: "script-src", optional: false, extra: [] as string[] },
    { name: "script-src-elem", optional: true, extra: [] as string[] },
    { name: "worker-src", optional: false, extra: ["blob:"] },
  ])(
    "$name lets code load from no third-party origin (no host, wildcard or scheme)",
    async ({ name, optional, extra }) => {
      const sources = await cspDirective(name, { optional });
      if (!optional) expect(sources).toContain("'self'");
      expect(
        sources.filter(
          (source) => !source.startsWith("'") && !extra.includes(source),
        ),
      ).toEqual([]);
    },
  );

  it("img-src allows only self, data:, blob: and the Google avatar host", async () => {
    expect(await cspDirective("img-src")).toEqual([
      "'self'",
      "data:",
      "blob:",
      "https://lh3.googleusercontent.com",
    ]);
  });
});

describe("next.config.ts CSP with a GA4 measurement ID", () => {
  async function cspWith(id: string | undefined) {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_GA_ID", id ?? "");
    const config = (await import("../../next.config")).default;
    const all = (await config.headers!()).find((r) => r.source === "/:path*");
    const csp = all!.headers.find(
      (h) => h.key === "Content-Security-Policy",
    )!.value;
    const sources = (name: string) =>
      csp
        .split(";")
        .map((d) => d.trim().split(/\s+/))
        .find(([n]) => n === name)!
        .slice(1);
    return { sources };
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("adds exactly the named GA4 hosts to script-src, connect-src and img-src", async () => {
    const { sources } = await cspWith("G-ABCD123456");
    expect(sources("script-src")).toContain("https://www.googletagmanager.com");
    expect(sources("connect-src")).toEqual([
      "'self'",
      "https://*.google-analytics.com",
      "https://*.analytics.google.com",
      "https://*.googletagmanager.com",
    ]);
    expect(sources("img-src")).toEqual([
      "'self'",
      "data:",
      "blob:",
      "https://lh3.googleusercontent.com",
      "https://*.google-analytics.com",
      "https://*.googletagmanager.com",
    ]);
  });

  it("still blocks MediaPipe's metrics host and allows no wildcard origin", async () => {
    const { sources } = await cspWith("G-ABCD123456");
    for (const name of [
      "script-src",
      "connect-src",
      "img-src",
      "default-src",
    ]) {
      const all = sources(name);
      expect(all.join(" "), name).not.toContain("googleapis.com");
      expect(all, name).not.toContain("*");
      expect(all, name).not.toContain("https:");
    }
  });

  it("leaves the policy exactly as it was when the ID is unset or malformed", async () => {
    for (const id of [undefined, "UA-1-1", "G-bad id"]) {
      const { sources } = await cspWith(id);
      expect(sources("connect-src")).toEqual(["'self'"]);
      expect(sources("script-src").filter((s) => !s.startsWith("'"))).toEqual(
        [],
      );
    }
  });
});
