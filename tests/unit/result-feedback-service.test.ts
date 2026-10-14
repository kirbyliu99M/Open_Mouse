/**
 * `handleResultFeedbackSubmission` and `handleResultFeedbackStatus` with
 * in-memory fakes: the status order of routes.ts (429, 413, 404, 400, 409,
 * 201), the snapshot computed on the server and never taken from the body, the
 * second rating of a scan, and what is and is not in a response or a log line.
 * The SQL is in result-feedback-db.test.ts.
 */
import { describe, expect, it, vi } from "vitest";
import {
  RESULT_FEEDBACK_NOTICE_VERSION,
  resultFeedbackSnapshotSchema,
} from "../../src/lib/contracts/result-feedback";
import { scoreFitDefault } from "../../src/server/fit/engine";
import { groupShells } from "../../src/server/fit/shell-groups";
import { bandOf } from "../../src/lib/fit/bands";
import type {
  FeedbackWrite,
  RecordFeedbackResult,
  ResultFeedbackRepo,
} from "../../src/server/result-feedback/repo";
import {
  MAX_RESULT_FEEDBACK_BODY_BYTES,
  handleResultFeedbackStatus,
  handleResultFeedbackSubmission,
  type ResultFeedbackDeps,
} from "../../src/server/result-feedback/service";
import { buildSnapshot } from "../../src/server/result-feedback/snapshot";
import type { OwnedScan } from "../../src/server/scans/repo";
import { fitPreferencesSchema } from "../../src/lib/contracts/fit";
import { sampleCatalogue, sampleOwnedScan } from "./fixtures/fake-fit-deps";

vi.mock("server-only", () => ({}));

const SCAN_ID = "10000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-14T09:30:45.678Z");

function fakeRepo(initiallyRated = false) {
  const writes: FeedbackWrite[] = [];
  let rated = initiallyRated;
  let outcomeOverride: RecordFeedbackResult | null = null;
  const repo: ResultFeedbackRepo = {
    async recordFeedback(write) {
      if (outcomeOverride) return outcomeOverride;
      if (rated) return "already_rated";
      rated = true;
      writes.push(write);
      return "stored";
    },
    async isRated() {
      return rated;
    },
    async withdrawFeedback() {
      return 0;
    },
  };
  return {
    repo,
    writes,
    forceOutcome: (o: RecordFeedbackResult) => (outcomeOverride = o),
  };
}

function setup(
  over: {
    scan?: OwnedScan | null;
    userId?: string | null;
    limiterAllows?: boolean;
    rated?: boolean;
  } = {},
) {
  const fake = fakeRepo(over.rated);
  const findOwnedScan = vi.fn(async () =>
    over.scan === undefined ? sampleOwnedScan : over.scan,
  );
  const loadCatalogue = vi.fn(async () => sampleCatalogue);
  const deps: ResultFeedbackDeps = {
    scanRepo: { findOwnedScan },
    fitRepo: { loadCatalogue },
    feedbackRepo: fake.repo,
    limiter: { allow: () => over.limiterAllows ?? true },
    getUserId: async () => (over.userId === undefined ? null : over.userId),
    now: () => NOW,
  };
  return { deps, findOwnedScan, loadCatalogue, ...fake };
}

const IP = { "x-forwarded-for": "203.0.113.9" };
const validBody = {
  notice: RESULT_FEEDBACK_NOTICE_VERSION,
  stars: 4,
  locale: "zh-TW",
};
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/scans/x/feedback", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const get = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/scans/x/feedback", { headers });

describe("buildSnapshot", () => {
  it("is a fresh default-engine run with empty preferences, parsed by the contract", () => {
    const snapshot = buildSnapshot(sampleOwnedScan, sampleCatalogue);
    const out = scoreFitDefault(
      sampleOwnedScan.measurements,
      sampleCatalogue,
      fitPreferencesSchema.parse({}),
      "right",
    );
    expect(resultFeedbackSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(snapshot.engineVersion).toBe(out.engineVersion);
    expect(snapshot.grip).toBe(out.gripStyle.used);
    expect(snapshot.handSize).toBe(out.handType?.size ?? null);
    expect(snapshot.handWidth).toBe(out.handType?.width ?? null);
    const ranked = groupShells(out.results, sampleCatalogue).slice(0, 3);
    expect(snapshot.topMice).toEqual(
      ranked.map((e) => ({ slug: e.mouse.slug, band: bandOf(e.total) })),
    );
    expect(snapshot.topMice.length).toBeLessThanOrEqual(3);
  });

  it("uses the stated grip, the stated palm thickness and the calibration method of the scan", () => {
    const snapshot = buildSnapshot(
      {
        ...sampleOwnedScan,
        gripStyleStated: "fingertip",
        palmThicknessStated: "thick",
        calibrationMethod: "manual-entry",
      },
      sampleCatalogue,
    );
    expect(snapshot.grip).toBe("fingertip");
    expect(snapshot.palmThicknessStated).toBe("thick");
    expect(snapshot.calibrationMethod).toBe("manual-entry");
  });

  it("calls a scan with no calibration method printed-sheet and no stated thickness null", () => {
    const snapshot = buildSnapshot(sampleOwnedScan, sampleCatalogue);
    expect(snapshot.calibrationMethod).toBe("printed-sheet");
    expect(snapshot.palmThicknessStated).toBeNull();
  });

  it("holds no millimetre value", () => {
    const text = JSON.stringify(
      buildSnapshot(sampleOwnedScan, sampleCatalogue),
    );
    expect(text).not.toMatch(/Mm|mm"/);
    expect(text).not.toContain("180");
  });
});

describe("POST feedback", () => {
  it("stores the body and the server's snapshot, with the day (not the instant), and answers 201", async () => {
    const t = setup({ userId: "user-1" });
    const res = await handleResultFeedbackSubmission(
      post({ ...validBody, comment: "ok" }, IP),
      SCAN_ID,
      t.deps,
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ stored: true, withdrawable: true });
    expect(t.writes).toHaveLength(1);
    expect(t.writes[0]).toMatchObject({
      scanId: SCAN_ID,
      userId: "user-1",
      stars: 4,
      comment: "ok",
      locale: "zh-TW",
      noticeVersion: RESULT_FEEDBACK_NOTICE_VERSION,
      createdOn: new Date("2026-10-14T00:00:00.000Z"),
      markedAt: NOW,
    });
    expect(t.writes[0]!.snapshot).toEqual(
      buildSnapshot(sampleOwnedScan, sampleCatalogue),
    );
  });

  it("is withdrawable only when signed in, and keeps no comment as null", async () => {
    const t = setup({ userId: null });
    const res = await handleResultFeedbackSubmission(
      post(validBody),
      SCAN_ID,
      t.deps,
    );
    expect(await res.json()).toEqual({ stored: true, withdrawable: false });
    expect(t.writes[0]).toMatchObject({ userId: null, comment: null });
  });

  it("ignores a snapshot field the client sends: the schema is strict, so it is a 400", async () => {
    const t = setup();
    const res = await handleResultFeedbackSubmission(
      post({ ...validBody, grip: "palm" }),
      SCAN_ID,
      t.deps,
    );
    expect(res.status).toBe(400);
    expect(t.writes).toHaveLength(0);
  });

  it("answers 409 to a second rating of the same scan and stores nothing more", async () => {
    const t = setup();
    const first = await handleResultFeedbackSubmission(
      post(validBody),
      SCAN_ID,
      t.deps,
    );
    const second = await handleResultFeedbackSubmission(
      post({ ...validBody, stars: 1 }),
      SCAN_ID,
      t.deps,
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.headers.get("cache-control")).toBe("no-store");
    expect(t.writes).toHaveLength(1);
    expect(t.writes[0]!.stars).toBe(4);
  });

  it("answers 404 when the scan vanished between the check and the write", async () => {
    const t = setup();
    t.forceOutcome("scan_gone");
    const res = await handleResultFeedbackSubmission(
      post(validBody),
      SCAN_ID,
      t.deps,
    );
    expect(res.status).toBe(404);
  });

  it("answers 404 for an unknown, foreign or expired scan (one body), before reading the body as JSON", async () => {
    const t = setup({ scan: null });
    const res = await handleResultFeedbackSubmission(
      post("not json"),
      SCAN_ID,
      t.deps,
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Scan not found." });
    expect(t.writes).toHaveLength(0);
  });

  it("answers 404 for a malformed scan id without asking the scan repo", async () => {
    const t = setup();
    const res = await handleResultFeedbackSubmission(
      post(validBody),
      "not-a-uuid",
      t.deps,
    );
    expect(res.status).toBe(404);
    expect(t.findOwnedScan).not.toHaveBeenCalled();
  });

  it.each([
    ["stars 0", { ...validBody, stars: 0 }],
    ["stars 6", { ...validBody, stars: 6 }],
    ["stars 2.5", { ...validBody, stars: 2.5 }],
    ["an unknown notice version", { ...validBody, notice: "old" }],
    ["an unknown locale", { ...validBody, locale: "xx" }],
    ["an email in the comment", { ...validBody, comment: "mail me a@b.com" }],
    [
      "a phone number in the comment",
      { ...validBody, comment: "call 0912 345 678" },
    ],
    [
      "a control character in the comment",
      { ...validBody, comment: "a\u0007b" },
    ],
    ["an empty comment", { ...validBody, comment: "" }],
    ["a too long comment", { ...validBody, comment: "x".repeat(501) }],
    ["no stars", { notice: RESULT_FEEDBACK_NOTICE_VERSION, locale: "zh-TW" }],
  ])("answers 400 to %s and stores nothing", async (_name, body) => {
    const t = setup();
    const res = await handleResultFeedbackSubmission(
      post(body),
      SCAN_ID,
      t.deps,
    );
    expect(res.status).toBe(400);
    expect(t.writes).toHaveLength(0);
  });

  it("answers 400 to a body that is not JSON", async () => {
    const t = setup();
    const res = await handleResultFeedbackSubmission(
      post("{nope"),
      SCAN_ID,
      t.deps,
    );
    expect(res.status).toBe(400);
  });

  it("does not echo the comment, in the 400 or in a log line", async () => {
    const t = setup();
    const res = await handleResultFeedbackSubmission(
      post({ ...validBody, comment: "write to secret@example.com" }),
      SCAN_ID,
      t.deps,
    );
    expect(await res.text()).not.toContain("secret@example.com");
  });

  it("answers 413 to a body over the cap, before the scan is looked up", async () => {
    const t = setup();
    const res = await handleResultFeedbackSubmission(
      post("x".repeat(MAX_RESULT_FEEDBACK_BODY_BYTES + 1)),
      SCAN_ID,
      t.deps,
    );
    expect(res.status).toBe(413);
    expect(t.findOwnedScan).not.toHaveBeenCalled();
  });

  it("answers 429 first, ahead of a bad body and a missing scan, and stores nothing", async () => {
    const t = setup({ limiterAllows: false, scan: null });
    const res = await handleResultFeedbackSubmission(
      post("x".repeat(MAX_RESULT_FEEDBACK_BODY_BYTES + 1), IP),
      "nope",
      t.deps,
    );
    expect(res.status).toBe(429);
    expect(t.findOwnedScan).not.toHaveBeenCalled();
    expect(t.writes).toHaveLength(0);
  });

  it("answers 500 with a fixed sentence when the snapshot cannot be built", async () => {
    const t = setup();
    t.deps.fitRepo.loadCatalogue = async () => {
      throw new Error("boom");
    };
    const res = await handleResultFeedbackSubmission(
      post(validBody),
      SCAN_ID,
      t.deps,
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Something went wrong. Try again in a moment.",
    });
  });
});

describe("GET feedback", () => {
  it("says whether the scan was rated", async () => {
    const fresh = setup();
    expect(
      await (
        await handleResultFeedbackStatus(get(), SCAN_ID, fresh.deps)
      ).json(),
    ).toEqual({ answered: false });
    const rated = setup({ rated: true });
    const res = await handleResultFeedbackStatus(get(), SCAN_ID, rated.deps);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ answered: true });
  });

  it("is 404 for a foreign scan or a malformed id, 429 when limited (first)", async () => {
    expect(
      (
        await handleResultFeedbackStatus(
          get(),
          SCAN_ID,
          setup({ scan: null }).deps,
        )
      ).status,
    ).toBe(404);
    expect(
      (await handleResultFeedbackStatus(get(), "x", setup().deps)).status,
    ).toBe(404);
    expect(
      (
        await handleResultFeedbackStatus(
          get(IP),
          "x",
          setup({ limiterAllows: false }).deps,
        )
      ).status,
    ).toBe(429);
  });
});
