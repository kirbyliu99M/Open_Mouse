import { describe, expect, it } from "vitest";
import { RESULT_FEEDBACK_NOTICE_VERSION } from "@/lib/contracts/result-feedback";
import {
  RESULT_FEEDBACK_DWELL_MS,
  buildSubmission,
  failureFromStatus,
  fetchAnswered,
  markFeedbackDone,
  readFeedbackDone,
  sendFeedback,
  shouldShowSheet,
} from "@/lib/results/resultFeedback";

const base = {
  answered: false,
  dismissedLocally: false,
  scrolledToEnd: false,
  elapsedMs: 0,
  isDemo: false,
};

describe("shouldShowSheet", () => {
  it("stays away on load", () => {
    expect(shouldShowSheet(base)).toBe(false);
  });
  it("shows at the end of the list", () => {
    expect(shouldShowSheet({ ...base, scrolledToEnd: true })).toBe(true);
  });
  it("shows after the dwell time, not before", () => {
    expect(
      shouldShowSheet({ ...base, elapsedMs: RESULT_FEEDBACK_DWELL_MS - 1 }),
    ).toBe(false);
    expect(
      shouldShowSheet({ ...base, elapsedMs: RESULT_FEEDBACK_DWELL_MS }),
    ).toBe(true);
  });
  it("never shows when answered, unknown, dismissed or in the demo", () => {
    const ready = { ...base, scrolledToEnd: true };
    expect(shouldShowSheet({ ...ready, answered: true })).toBe(false);
    expect(shouldShowSheet({ ...ready, answered: null })).toBe(false);
    expect(shouldShowSheet({ ...ready, dismissedLocally: true })).toBe(false);
    expect(shouldShowSheet({ ...ready, isDemo: true })).toBe(false);
  });
});

describe("buildSubmission", () => {
  it("omits an empty comment and carries the notice and locale", () => {
    const built = buildSubmission({ stars: 4, comment: "   ", locale: "en" });
    expect(built).toEqual({
      ok: true,
      body: {
        notice: RESULT_FEEDBACK_NOTICE_VERSION,
        stars: 4,
        locale: "en",
      },
    });
  });
  it("trims the comment", () => {
    const built = buildSubmission({
      stars: 2,
      comment: "  too high  ",
      locale: "zh-TW",
    });
    expect(built.ok && built.body.comment).toBe("too high");
  });
  it("refuses no stars", () => {
    expect(buildSubmission({ stars: null, comment: "", locale: "en" })).toEqual(
      { ok: false, reason: "invalid" },
    );
  });
  it("refuses contact details in the comment", () => {
    expect(
      buildSubmission({ stars: 3, comment: "me@example.com", locale: "en" }),
    ).toEqual({ ok: false, reason: "invalid_feedback" });
  });
});

describe("failureFromStatus", () => {
  it("maps the documented statuses", () => {
    expect(failureFromStatus(409, false)).toBe("conflict");
    expect(failureFromStatus(429, false)).toBe("rate_limited");
    expect(failureFromStatus(400, true)).toBe("invalid_feedback");
    expect(failureFromStatus(400, false)).toBe("invalid");
    expect(failureFromStatus(413, true)).toBe("invalid");
    expect(failureFromStatus(404, false)).toBe("network");
    expect(failureFromStatus(500, false)).toBe("network");
  });
});

const reply = (status: number, body: unknown) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe("fetchAnswered", () => {
  it("reads answered", async () => {
    expect(
      await fetchAnswered("s", undefined, reply(200, { answered: true })),
    ).toBe(true);
    expect(
      await fetchAnswered("s", undefined, reply(200, { answered: false })),
    ).toBe(false);
  });
  it("fails quiet", async () => {
    expect(await fetchAnswered("s", undefined, reply(404, {}))).toBeNull();
    expect(
      await fetchAnswered("s", undefined, reply(200, { x: 1 })),
    ).toBeNull();
    expect(
      await fetchAnswered("s", undefined, async () => {
        throw new Error("offline");
      }),
    ).toBeNull();
  });
});

describe("sendFeedback", () => {
  const body = {
    notice: RESULT_FEEDBACK_NOTICE_VERSION,
    stars: 5,
    locale: "en",
  } as const;
  it("returns withdrawable from a 201", async () => {
    expect(
      await sendFeedback(
        "s",
        body,
        reply(201, { stored: true, withdrawable: true }),
      ),
    ).toEqual({ ok: true, withdrawable: true });
  });
  it("maps a refusal and a network error", async () => {
    expect(await sendFeedback("s", body, reply(409, {}))).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(
      await sendFeedback("s", body, async () => {
        throw new Error("offline");
      }),
    ).toEqual({ ok: false, reason: "network" });
  });
});

describe("local memory", () => {
  it("remembers per scan and survives missing storage", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    expect(readFeedbackDone("a", () => storage)).toBe(false);
    expect(markFeedbackDone("a", () => storage)).toBe(true);
    expect(readFeedbackDone("a", () => storage)).toBe(true);
    expect(readFeedbackDone("b", () => storage)).toBe(false);
    expect(markFeedbackDone("a", () => null)).toBe(false);
    expect(
      readFeedbackDone("a", () => {
        throw new Error("blocked");
      }),
    ).toBe(false);
  });
});
