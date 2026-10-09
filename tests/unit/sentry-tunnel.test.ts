import { describe, expect, it, vi } from "vitest";
import {
  MAX_ENVELOPE_BYTES,
  envelopeDsn,
  parseDsn,
  proxyEnvelope,
} from "@/server/observability/tunnel";

const DSN = "https://abc123@o111.ingest.us.sentry.io/222";

const envelope = (dsn: string | null = DSN) =>
  `${JSON.stringify(dsn === null ? { event_id: "e" } : { event_id: "e", dsn })}\n{"type":"event"}\n{"message":"boom"}`;

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request("https://app.test/monitoring", {
    method: "POST",
    headers: { "content-type": "text/plain;charset=UTF-8", ...headers },
    body,
  });

const okFetch = () =>
  vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));

describe("parseDsn", () => {
  it("reads host and project id", () => {
    expect(parseDsn(DSN)).toEqual({
      host: "o111.ingest.us.sentry.io",
      projectId: "222",
    });
  });
  it("rejects what is not an https DSN with a numeric project", () => {
    expect(parseDsn(undefined)).toBeNull();
    expect(parseDsn("")).toBeNull();
    expect(parseDsn("not a url")).toBeNull();
    expect(parseDsn("http://k@o1.ingest.sentry.io/2")).toBeNull();
    expect(parseDsn("https://k@o1.ingest.sentry.io/abc")).toBeNull();
  });
});

describe("envelopeDsn", () => {
  const bytes = (s: string) => new TextEncoder().encode(s);
  it("reads the dsn from the header line", () => {
    expect(envelopeDsn(bytes(envelope()))).toBe(DSN);
  });
  it("is null without a dsn or a JSON header", () => {
    expect(envelopeDsn(bytes(envelope(null)))).toBeNull();
    expect(envelopeDsn(bytes("garbage\n{}"))).toBeNull();
    expect(envelopeDsn(bytes(""))).toBeNull();
  });
});

describe("proxyEnvelope", () => {
  it("forwards the body and content type only, to the DSN's envelope endpoint", async () => {
    const fetchImpl = okFetch();
    const res = await proxyEnvelope(
      post(envelope(), {
        cookie: "scan_session=1; authjs.session-token=x",
        authorization: "Bearer x",
        "x-forwarded-for": "1.2.3.4",
        "x-real-ip": "1.2.3.4",
        "user-agent": "ua",
      }),
      { dsn: DSN, fetchImpl },
    );
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://o111.ingest.us.sentry.io/api/222/envelope/");
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(init?.headers).toEqual({
      "content-type": "text/plain;charset=UTF-8",
    });
    expect(new TextDecoder().decode(init?.body as Uint8Array)).toBe(envelope());
  });

  it("hands back the status with no upstream headers", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response("{}", {
          status: 429,
          headers: { "set-cookie": "a=b", "content-type": "application/json" },
        }),
    );
    const res = await proxyEnvelope(post(envelope()), { dsn: DSN, fetchImpl });
    expect(res.status).toBe(429);
    expect([...res.headers.keys()]).toEqual([]);
  });

  it("is a 404 when no DSN is configured, or for a method other than POST", async () => {
    const fetchImpl = okFetch();
    expect(
      (await proxyEnvelope(post(envelope()), { dsn: undefined, fetchImpl }))
        .status,
    ).toBe(404);
    expect(
      (
        await proxyEnvelope(new Request("https://app.test/monitoring"), {
          dsn: DSN,
          fetchImpl,
        })
      ).status,
    ).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses envelopes addressed to another project or host", async () => {
    const fetchImpl = okFetch();
    for (const other of [
      "https://abc123@o111.ingest.us.sentry.io/999",
      "https://abc123@o999.ingest.us.sentry.io/222",
      null,
    ]) {
      const res = await proxyEnvelope(post(envelope(other)), {
        dsn: DSN,
        fetchImpl,
      });
      expect(res.status).toBe(400);
    }
    expect(
      (await proxyEnvelope(post("garbage"), { dsn: DSN, fetchImpl })).status,
    ).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses an envelope over the cap", async () => {
    const fetchImpl = okFetch();
    const big = envelope() + "x".repeat(MAX_ENVELOPE_BYTES);
    const declared = await proxyEnvelope(post(big), { dsn: DSN, fetchImpl });
    expect(declared.status).toBe(413);
    const streamed = await proxyEnvelope(
      new Request("https://app.test/monitoring", {
        method: "POST",
        body: new Blob([big]).stream(),
        // @ts-expect-error -- undici needs this for a stream body
        duplex: "half",
      }),
      { dsn: DSN, fetchImpl },
    );
    expect(streamed.status).toBe(413);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is a 502 when Sentry cannot be reached", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error("network");
    });
    const res = await proxyEnvelope(post(envelope()), { dsn: DSN, fetchImpl });
    expect(res.status).toBe(502);
  });
});
