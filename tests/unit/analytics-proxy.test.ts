import { describe, expect, it, vi } from "vitest";
import {
  MAX_INGEST_BODY_BYTES,
  filterRequestHeaders,
  filterResponseHeaders,
  isIngestPath,
  proxyIngest,
} from "@/server/analytics/proxy";

const post = (headers: Record<string, string> = {}, body = "{}") =>
  new Request("https://app.test/ingest/e/?ip=0&v=1", {
    method: "POST",
    headers,
    body,
  });

describe("filterRequestHeaders", () => {
  it("keeps only content-type and content-encoding", () => {
    const out = filterRequestHeaders(
      new Headers({
        "content-type": "text/plain",
        "content-encoding": "gzip",
        cookie: "scan_session=1",
        authorization: "Bearer x",
        "x-forwarded-for": "1.2.3.4",
        "x-real-ip": "1.2.3.4",
        forwarded: "for=1.2.3.4",
        "user-agent": "ua",
      }),
    );
    expect([...out.keys()].sort()).toEqual([
      "content-encoding",
      "content-type",
    ]);
  });
  it("response filter drops set-cookie", () => {
    const out = filterResponseHeaders(
      new Headers({ "content-type": "application/json", "set-cookie": "a=b" }),
    );
    expect([...out.keys()]).toEqual(["content-type"]);
  });
});

describe("isIngestPath", () => {
  it("accepts ingestion paths only", () => {
    expect(isIngestPath(["e"])).toBe(true);
    expect(isIngestPath(["i", "v0", "e"])).toBe(true);
    expect(isIngestPath(["batch"])).toBe(true);
    expect(isIngestPath(["decide"])).toBe(false);
    expect(isIngestPath(["static", "x.js"])).toBe(false);
    expect(isIngestPath([])).toBe(false);
  });
});

describe("proxyIngest", () => {
  it("forwards no cookie, authorization or forwarding header upstream", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("1", {
          status: 200,
          headers: { "content-type": "text/plain", "set-cookie": "x=y" },
        }),
    );
    const res = await proxyIngest(
      post({
        "content-type": "text/plain",
        cookie: "scan_session=secret; authjs.session-token=t",
        authorization: "Bearer secret",
        "x-forwarded-for": "1.2.3.4",
        "x-real-ip": "1.2.3.4",
        forwarded: "for=1.2.3.4",
      }),
      ["e"],
      { enabled: true, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://us.i.posthog.com/e/?ip=0&v=1");
    const sent = new Headers(init.headers);
    for (const name of [
      "cookie",
      "authorization",
      "x-forwarded-for",
      "x-real-ip",
      "forwarded",
    ])
      expect(sent.has(name)).toBe(false);
    expect(sent.get("content-type")).toBe("text/plain");
  });

  it("404s without a key, for other methods and for other paths", async () => {
    const fetchImpl = vi.fn();
    const deps = {
      enabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    };
    expect(
      (await proxyIngest(post(), ["e"], { ...deps, enabled: false })).status,
    ).toBe(404);
    expect(
      (
        await proxyIngest(
          new Request("https://app.test/ingest/e/"),
          ["e"],
          deps,
        )
      ).status,
    ).toBe(404);
    expect((await proxyIngest(post(), ["flags"], deps)).status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("413s above the body cap", async () => {
    const fetchImpl = vi.fn();
    const res = await proxyIngest(
      post({}, "x".repeat(MAX_INGEST_BODY_BYTES + 1)),
      ["e"],
      { enabled: true, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(res.status).toBe(413);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("502s when the upstream is unreachable", async () => {
    const res = await proxyIngest(post(), ["e"], {
      enabled: true,
      fetchImpl: (async () => {
        throw new Error("down");
      }) as unknown as typeof fetch,
    });
    expect(res.status).toBe(502);
  });

  it("413s a chunked body with no content-length once it passes the cap", async () => {
    const fetchImpl = vi.fn();
    const chunk = new Uint8Array(100 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        controller.enqueue(chunk);
        if (sent > 20) controller.close();
      },
    });
    const request = new Request("https://app.test/ingest/e/", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(request.headers.get("content-length")).toBeNull();
    const res = await proxyIngest(request, ["e"], {
      enabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.status).toBe(413);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(sent).toBeLessThan(10);
  });

  it.each([204, 205, 304])("passes a bodiless %i through", async (status) => {
    const res = await proxyIngest(post(), ["e"], {
      enabled: true,
      fetchImpl: (async () =>
        new Response(null, { status })) as unknown as typeof fetch,
    });
    expect(res.status).toBe(status);
    expect(await res.text()).toBe("");
  });
});
