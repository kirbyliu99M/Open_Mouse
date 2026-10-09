import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import {
  DATA_COLLECTION,
  SENTRY_OPTIONS,
  TRACES_SAMPLE_RATE,
  scrubBreadcrumb,
  scrubDeep,
  scrubEvent,
  scrubSpan,
  scrubText,
} from "@/lib/observability/sentry";

const SCAN_ID = "3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b";

describe("scrubText", () => {
  it.each([
    [`/results/${SCAN_ID}`, "/results/[id]"],
    [
      `/api/scans/${SCAN_ID.toUpperCase()}/analysis`,
      "/api/scans/[id]/analysis",
    ],
    [
      "hand length 187.5 mm, width 84mm",
      "hand length [redacted-measurement], width [redacted-measurement]",
    ],
    ["from kirby@example.com", "from [redacted-email]"],
    ["client 203.0.113.7 failed", "client [redacted-ip] failed"],
    ["peer 2001:db8:85a3:0:0:8a2e:370:7334", "peer [redacted-ip]"],
    ["Authorization: Bearer abc.def-123", "Authorization=[redacted]"],
    ["sent Bearer abc.def-123", "sent Bearer [redacted-token]"],
    ["jwt eyJhbGciOi.eyJzdWIiOi.sig", "jwt [redacted-token]"],
    ["postgresql://u:p@host/db?x=1", "[redacted-url]"],
    [
      "fetch failed: api_key=not-a-real-key-123",
      "fetch failed: api_key=[redacted]",
    ],
    ['{"session-id": "abc123"}', '{"session-id=[redacted]}'],
    // A long opaque run, deliberately not shaped like any vendor's key.
    [`key ${"q7Rw".repeat(10)}`, "key [redacted-token]"],
  ])("%s", (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  it("leaves ordinary text and hex ids alone", () => {
    expect(scrubText("TypeError: x is not a function")).toBe(
      "TypeError: x is not a function",
    );
    expect(scrubText("trace 4bf92f3577b34da6a3ce929d0e0e4736")).toBe(
      "trace 4bf92f3577b34da6a3ce929d0e0e4736",
    );
  });
});

describe("scrubDeep", () => {
  it("scrubs nested strings and keeps other values", () => {
    expect(
      scrubDeep({ url: `/results/${SCAN_ID}`, n: 3, list: ["90 mm", true] }),
    ).toEqual({
      url: "/results/[id]",
      n: 3,
      list: ["[redacted-measurement]", true],
    });
  });

  it("stops at a fixed depth", () => {
    let deep: unknown = "x";
    for (let i = 0; i < 10; i += 1) deep = { deep };
    expect(JSON.stringify(scrubDeep(deep))).toContain("[truncated]");
  });
});

describe("scrubEvent", () => {
  it("drops the user, the body, cookies and headers other than the user agent", () => {
    const event = {
      type: undefined,
      user: { id: "u1", ip_address: "203.0.113.7" },
      server_name: "host",
      message: `scan ${SCAN_ID}`,
      exception: { values: [{ type: "Error", value: "palm 88 mm" }] },
      request: {
        url: `https://example.app/results/${SCAN_ID}`,
        method: "POST",
        data: '{"handLengthMm":187}',
        cookies: { session: "s" },
        query_string: "a=1",
        headers: { "user-agent": "UA", cookie: "session=s" },
      },
      breadcrumbs: [
        {
          message: `GET /api/scans/${SCAN_ID}`,
          data: { url: `/x/${SCAN_ID}` },
        },
      ],
      extra: { note: "kirby@example.com" },
      contexts: {
        nextjs: {
          request_path: `/results/${SCAN_ID}`,
          router_path: "/results/[id]",
        },
        trace: {
          trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
          span_id: "00f067aa0ba902b7",
        },
      },
    } as unknown as ErrorEvent;

    const out = scrubEvent(event);

    expect(out.user).toBeUndefined();
    expect(out.server_name).toBeUndefined();
    expect(out.message).toBe("scan [id]");
    expect(out.exception?.values?.[0]?.value).toBe(
      "palm [redacted-measurement]",
    );
    expect(out.request).toEqual({
      url: "https://example.app/results/[id]",
      method: "POST",
      headers: { "user-agent": "UA" },
    });
    expect(out.breadcrumbs?.[0]).toEqual({
      message: "GET /api/scans/[id]",
      data: { url: "/x/[id]" },
    });
    expect(out.extra).toEqual({ note: "[redacted-email]" });
    expect(out.contexts).toEqual({
      nextjs: { request_path: "/results/[id]", router_path: "/results/[id]" },
      trace: {
        trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
        span_id: "00f067aa0ba902b7",
      },
    });
  });
});

describe("scrubBreadcrumb and scrubSpan", () => {
  it("scrub a fetch breadcrumb's URL", () => {
    expect(
      scrubBreadcrumb({
        category: "fetch",
        data: { url: `/api/scans/${SCAN_ID}` },
      }),
    ).toEqual({ category: "fetch", data: { url: "/api/scans/[id]" } });
  });

  it("scrubs the span name and string attributes", () => {
    const span = {
      trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
      span_id: "00f067aa0ba902b7",
      name: `GET /results/${SCAN_ID}`,
      start_timestamp: 1,
      status: "ok" as const,
      is_segment: true,
      attributes: { "url.full": `https://a.app/results/${SCAN_ID}`, n: 2 },
    };
    const out = scrubSpan(span);
    expect(out.name).toBe("GET /results/[id]");
    expect(out.attributes).toEqual({
      "url.full": "https://a.app/results/[id]",
      n: 2,
    });
    expect(out.trace_id).toBe(span.trace_id);
  });
});

describe("SENTRY_OPTIONS", () => {
  it("collects no bodies, cookies, users, query data, local variables or model text", () => {
    expect(DATA_COLLECTION).toMatchObject({
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ["user-agent"] }, response: false },
      httpBodies: [],
      graphQL: { document: false, variables: false },
      queues: false,
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
      genAI: { inputs: false, outputs: false },
    });
  });

  it("samples traces below 1 and is off without a DSN", () => {
    expect(TRACES_SAMPLE_RATE).toBe(0.8);
    expect(SENTRY_OPTIONS.tracesSampleRate).toBeLessThan(1);
    if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
      expect(SENTRY_OPTIONS.enabled).toBe(false);
    }
  });
});
