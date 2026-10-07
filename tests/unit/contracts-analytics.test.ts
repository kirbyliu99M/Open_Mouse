import { describe, expect, it } from "vitest";
import {
  ANALYTICS_COUNT_CAP,
  analyticsEventSchemas,
  redactAnalyticsPath,
} from "../../src/lib/contracts/analytics";

const SCAN_ID = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b";

describe("analyticsEventSchemas", () => {
  it("accepts the documented shape of each event", () => {
    const ok: Record<keyof typeof analyticsEventSchemas, unknown> = {
      $pageview: {},
      home_cta_clicked: { cta: "scan" },
      scan_entry_shown: { flow: "easy", device: "in-app" },
      camera_permission_result: { flow: "easy", result: "denied" },
      scan_capture_attempted: { flow: "easy", method: "takePhoto", attempt: 1 },
      scan_rejected: {
        flow: "easy",
        attempt: 2,
        codes: ["HAND_NOT_DETECTED", "LOW_SHARPNESS"],
      },
      scan_measured: { flow: "sheet", attempt: 3, paper: "manual" },
      scan_submitted: { flow: "easy" },
      scan_submit_failed: { flow: "easy", kind: "rateLimited" },
      results_viewed: {
        state: "ready",
        topPick: "logitech-g-pro-x-superlight-2",
        noGoodFit: false,
      },
      analysis_shown: { outcome: "fallback" },
      analysis_retry_clicked: {},
      results_list_opened: { list: "ranked" },
      viewer_interacted: {},
      retake_clicked: { from: "results" },
      scan_deleted: {},
      outbound_clicked: {
        mouse: "logitech-g-pro-x-superlight-2",
        rank: 1,
        retailer: "biggo",
      },
    };
    for (const [name, props] of Object.entries(ok)) {
      const schema =
        analyticsEventSchemas[name as keyof typeof analyticsEventSchemas];
      expect(schema.safeParse(props).success, name).toBe(true);
    }
  });

  it("refuses a property the contract does not list, on every event", () => {
    for (const [name, schema] of Object.entries(analyticsEventSchemas)) {
      for (const key of ["handLengthMm", "scanId", "sessionId", "email"]) {
        const extra = { [key]: "x" };
        expect(schema.safeParse(extra).success, `${name}.${key}`).toBe(false);
      }
    }
  });

  it("refuses a scan ID where a mouse slug goes", () => {
    const viewed = analyticsEventSchemas.results_viewed;
    expect(viewed.safeParse({ state: "ready", topPick: SCAN_ID }).success).toBe(
      false,
    );
    expect(
      viewed.safeParse({ state: "ready", topPick: SCAN_ID.toUpperCase() })
        .success,
    ).toBe(false);
  });

  it("caps counts and refuses fractions and negatives", () => {
    const measured = analyticsEventSchemas.scan_measured;
    const at = (attempt: number) =>
      measured.safeParse({ flow: "easy", attempt, paper: "detected" }).success;
    expect(at(ANALYTICS_COUNT_CAP)).toBe(true);
    expect(at(ANALYTICS_COUNT_CAP + 1)).toBe(false);
    expect(at(1.5)).toBe(false);
    expect(at(-1)).toBe(false);
    expect(at(0)).toBe(false);
  });

  it("refuses a dashless UUID as a slug, and ready-only fields on other states", () => {
    const viewed = analyticsEventSchemas.results_viewed;
    const dashless = SCAN_ID.replaceAll("-", "");
    expect(
      viewed.safeParse({ state: "ready", topPick: dashless, noGoodFit: false })
        .success,
    ).toBe(false);
    expect(
      viewed.safeParse({ state: "notFound", topPick: "logitech-mx-master-3s" })
        .success,
    ).toBe(false);
    expect(viewed.safeParse({ state: "notFound" }).success).toBe(true);
    expect(viewed.safeParse({ state: "ready" }).success).toBe(false);
  });

  it("refuses repeated issue codes", () => {
    const rejected = analyticsEventSchemas.scan_rejected;
    expect(
      rejected.safeParse({ flow: "easy", attempt: 1, codes: ["A_B", "A_B"] })
        .success,
    ).toBe(false);
  });

  it("takes issue codes, not messages", () => {
    const rejected = analyticsEventSchemas.scan_rejected;
    const codes = (c: string[]) =>
      rejected.safeParse({ flow: "easy", attempt: 1, codes: c }).success;
    expect(codes(["PAPER_NOT_FOUND"])).toBe(true);
    expect(codes(["No paper found — retake"])).toBe(false);
    expect(codes(Array(9).fill("UNEXPECTED"))).toBe(false);
  });
});

describe("redactAnalyticsPath", () => {
  it("replaces a scan ID and a learning-kit token with the route pattern", () => {
    expect(redactAnalyticsPath(`/results/${SCAN_ID}`)).toBe(
      "/results/[scanId]",
    );
    expect(
      redactAnalyticsPath(
        `https://open-mouse.vercel.app/results/${SCAN_ID}?x=1`,
      ),
    ).toBe("https://open-mouse.vercel.app/results/[scanId]");
    expect(redactAnalyticsPath("/l/v1/abcDEF123_-xyz")).toBe("/l/v1/[token]");
  });

  it("keeps the demo results page and ordinary paths, without query or fragment", () => {
    expect(redactAnalyticsPath("/results/demo")).toBe("/results/demo");
    expect(redactAnalyticsPath("/scan/easy?debug=1#top")).toBe("/scan/easy");
    expect(redactAnalyticsPath("https://example.com/?q=hand")).toBe(
      "https://example.com/",
    );
  });

  it("returns null for something that is not a URL", () => {
    expect(redactAnalyticsPath("http://")).toBeNull();
  });

  it("redacts the variants a denylist would miss", () => {
    const cases: [string, string | null][] = [
      [`/results//${SCAN_ID}`, "/results/[scanId]"],
      [`/Results/${SCAN_ID}`, "/results/[scanId]"],
      [`/results/${SCAN_ID}/`, "/results/[scanId]"],
      [`/results/${SCAN_ID}/more`, "/results/[scanId]"],
      [`/results;x/${SCAN_ID}`, "/results/[scanId]"],
      [`/results/demo/${SCAN_ID}`, "/results/[scanId]"],
      ["/results/demo-abc", "/results/[scanId]"],
      [`//evil.example/results/${SCAN_ID}`, "/results/[scanId]"],
      [
        `https://user:pw@open-mouse.vercel.app/results/${SCAN_ID}`,
        "https://open-mouse.vercel.app/results/[scanId]",
      ],
      ["/l/v1//abcDEF123_-xyz", "/l/v1/[token]"],
      ["/L/v2/abcDEF123_-xyz", "/l/[version]/[token]"],
      [`/anything/${SCAN_ID.replaceAll("-", "")}`, "/anything/[id]"],
      ["/x/abcdefghijklmnopqrstuvwxyz", "/x/[id]"],
      ["mailto:a@b.c", null],
      ["data:text/plain,hi", null],
      ["/", "/"],
      ["/how-it-works/", "/how-it-works"],
    ];
    for (const [input, expected] of cases) {
      expect(redactAnalyticsPath(input), input).toBe(expected);
    }
  });
});
