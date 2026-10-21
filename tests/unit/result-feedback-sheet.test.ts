import { describe, expect, it } from "vitest";
import { RESULT_FEEDBACK_NOTICE_VERSION } from "@/lib/contracts/result-feedback";
import {
  RESULT_FEEDBACK_AUTOCLOSE_MS,
  RESULT_FEEDBACK_DRAG_CLOSE_PX,
  RESULT_FEEDBACK_DWELL_MS,
  RESULT_FEEDBACK_MIN_DWELL_MS,
  RESULT_FEEDBACK_TICK_MS,
  addVisibleTime,
  buildSubmission,
  canPageScroll,
  commentVisible,
  dismissedEventDue,
  dragClosesSheet,
  escapeCloses,
  failureFromStatus,
  fetchAnswered,
  markFeedbackDone,
  primaryLabel,
  reachedEnd,
  readFeedbackDone,
  sendFeedback,
  shouldShowSheet,
  showSubmit,
  shownEvent,
  submittedEvent,
} from "@/lib/results/resultFeedback";

// A page that can scroll, that the person has not scrolled, in a visible tab.
const base = {
  answered: false,
  dismissedLocally: false,
  scrolledToEnd: false,
  visibleElapsedMs: 0,
  hasScrolled: false,
  canScroll: true,
  isDemo: false,
  openedDetails: false,
  coolingDown: false,
  questionnaire: "unanswered" as const,
};

describe("the constants", () => {
  it("keep the v2 timing", () => {
    expect(RESULT_FEEDBACK_DWELL_MS).toBe(45_000);
    expect(RESULT_FEEDBACK_AUTOCLOSE_MS).toBe(3_000);
    expect(RESULT_FEEDBACK_DRAG_CLOSE_PX).toBe(64);
    expect(RESULT_FEEDBACK_TICK_MS).toBeGreaterThan(0);
  });
});

describe("shouldShowSheet", () => {
  it("stays away on load", () => {
    expect(shouldShowSheet(base)).toBe(false);
  });
  it("no longer shows at once at the end of the list: 20 s visible first (V3.2 F11)", () => {
    expect(shouldShowSheet({ ...base, scrolledToEnd: true })).toBe(false);
    expect(
      shouldShowSheet({
        ...base,
        scrolledToEnd: true,
        visibleElapsedMs: RESULT_FEEDBACK_MIN_DWELL_MS - 1,
      }),
    ).toBe(false);
    expect(
      shouldShowSheet({
        ...base,
        scrolledToEnd: true,
        visibleElapsedMs: RESULT_FEEDBACK_MIN_DWELL_MS,
      }),
    ).toBe(true);
  });
  it("does not show on 45 s alone when the page can scroll and was not scrolled", () => {
    expect(
      shouldShowSheet({ ...base, visibleElapsedMs: RESULT_FEEDBACK_DWELL_MS }),
    ).toBe(false);
    expect(
      shouldShowSheet({
        ...base,
        visibleElapsedMs: 10 * RESULT_FEEDBACK_DWELL_MS,
      }),
    ).toBe(false);
  });
  it("shows after the visible dwell once the person has scrolled, not before", () => {
    const scrolled = { ...base, hasScrolled: true };
    expect(
      shouldShowSheet({
        ...scrolled,
        visibleElapsedMs: RESULT_FEEDBACK_DWELL_MS - 1,
      }),
    ).toBe(false);
    expect(
      shouldShowSheet({
        ...scrolled,
        visibleElapsedMs: RESULT_FEEDBACK_DWELL_MS,
      }),
    ).toBe(true);
  });
  it("shows after the dwell when the page cannot scroll at all", () => {
    const short = { ...base, canScroll: false };
    expect(
      shouldShowSheet({
        ...short,
        visibleElapsedMs: RESULT_FEEDBACK_DWELL_MS - 1,
      }),
    ).toBe(false);
    expect(
      shouldShowSheet({
        ...short,
        visibleElapsedMs: RESULT_FEEDBACK_DWELL_MS,
      }),
    ).toBe(true);
  });
  it("never shows when answered, unknown, dismissed or in the demo", () => {
    const ready = {
      ...base,
      scrolledToEnd: true,
      visibleElapsedMs: RESULT_FEEDBACK_MIN_DWELL_MS,
    };
    expect(shouldShowSheet({ ...ready, answered: true })).toBe(false);
    expect(shouldShowSheet({ ...ready, answered: null })).toBe(false);
    expect(shouldShowSheet({ ...ready, dismissedLocally: true })).toBe(false);
    expect(shouldShowSheet({ ...ready, isDemo: true })).toBe(false);
    const dwelled = {
      ...base,
      hasScrolled: true,
      visibleElapsedMs: RESULT_FEEDBACK_DWELL_MS,
    };
    expect(shouldShowSheet(dwelled)).toBe(true);
    expect(shouldShowSheet({ ...dwelled, answered: null })).toBe(false);
    expect(shouldShowSheet({ ...dwelled, answered: true })).toBe(false);
    expect(shouldShowSheet({ ...dwelled, dismissedLocally: true })).toBe(false);
    expect(shouldShowSheet({ ...dwelled, isDemo: true })).toBe(false);
  });
});

describe("the visible-time clock", () => {
  it("adds a tick while the tab is visible", () => {
    expect(addVisibleTime(0, RESULT_FEEDBACK_TICK_MS, true)).toBe(
      RESULT_FEEDBACK_TICK_MS,
    );
  });
  it("adds nothing while the tab is in the background", () => {
    let ms = 0;
    for (let i = 0; i < 600; i += 1) {
      ms = addVisibleTime(ms, RESULT_FEEDBACK_TICK_MS, false);
    }
    expect(ms).toBe(0);
  });
  it("only the visible ticks count toward the 45 s", () => {
    let ms = 0;
    // 30 s visible, 5 minutes hidden, then 14 s visible: 44 s in all.
    for (let i = 0; i < 30; i += 1) ms = addVisibleTime(ms, 1000, true);
    for (let i = 0; i < 300; i += 1) ms = addVisibleTime(ms, 1000, false);
    for (let i = 0; i < 14; i += 1) ms = addVisibleTime(ms, 1000, true);
    expect(ms).toBe(44_000);
    expect(
      shouldShowSheet({ ...base, hasScrolled: true, visibleElapsedMs: ms }),
    ).toBe(false);
    ms = addVisibleTime(ms, 1000, true);
    expect(
      shouldShowSheet({ ...base, hasScrolled: true, visibleElapsedMs: ms }),
    ).toBe(true);
  });
  it("ignores a bad step", () => {
    expect(addVisibleTime(5, -1, true)).toBe(5);
    expect(addVisibleTime(5, Number.NaN, true)).toBe(5);
    expect(addVisibleTime(5, 0, true)).toBe(5);
  });
});

describe("canPageScroll", () => {
  it("is true only when the content is taller than the window", () => {
    expect(canPageScroll({ scrollHeight: 2400, viewportHeight: 844 })).toBe(
      true,
    );
    expect(canPageScroll({ scrollHeight: 844, viewportHeight: 844 })).toBe(
      false,
    );
    // A one-pixel rounding difference is not a scrollable page.
    expect(canPageScroll({ scrollHeight: 845, viewportHeight: 844 })).toBe(
      false,
    );
  });
});

describe("dragClosesSheet", () => {
  it("closes only past 64 px downward", () => {
    expect(dragClosesSheet(64)).toBe(false);
    expect(dragClosesSheet(65)).toBe(true);
    expect(dragClosesSheet(0)).toBe(false);
    expect(dragClosesSheet(-200)).toBe(false);
  });
});

describe("escapeCloses", () => {
  const form = { phase: "form", composing: false, comment: "" } as const;
  it("closes an empty form", () => {
    expect(escapeCloses(form)).toBe(true);
    expect(escapeCloses({ ...form, comment: "   " })).toBe(true);
  });
  it("ignores an Escape that belongs to the input method", () => {
    expect(escapeCloses({ ...form, composing: true })).toBe(false);
    expect(escapeCloses({ ...form, phase: "thanks", composing: true })).toBe(
      false,
    );
  });
  it("does not throw away a typed comment", () => {
    expect(escapeCloses({ ...form, comment: "G305 too low" })).toBe(false);
  });
  it("closes after thanks or 'already sent' even if the text is still there", () => {
    expect(escapeCloses({ ...form, phase: "thanks", comment: "x" })).toBe(true);
    expect(escapeCloses({ ...form, phase: "already", comment: "x" })).toBe(
      true,
    );
  });
});

describe("what the sheet shows", () => {
  it("draws no submit button and no comment box before a star is chosen", () => {
    expect(showSubmit(null)).toBe(false);
    expect(commentVisible(null)).toBe(false);
    expect(showSubmit(1)).toBe(true);
    expect(commentVisible(5)).toBe(true);
  });
  it("names the primary button by phase and failure", () => {
    expect(primaryLabel("form", null)).toBe("send");
    expect(primaryLabel("sending", null)).toBe("sending");
    expect(primaryLabel("sending", "network")).toBe("sending");
    expect(primaryLabel("form", "network")).toBe("retry");
    expect(primaryLabel("form", "rate_limited")).toBe("retry");
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

describe("reachedEnd", () => {
  it("needs the marker in view and a real scroll", () => {
    expect(reachedEnd({ markerInView: true, scrollMovedPx: 0 })).toBe(false);
    expect(reachedEnd({ markerInView: false, scrollMovedPx: 300 })).toBe(false);
    expect(reachedEnd({ markerInView: true, scrollMovedPx: 1 })).toBe(true);
  });
});

describe("buildSubmission comment refusals", () => {
  it("tells control characters from contact details", () => {
    expect(
      buildSubmission({ stars: 3, comment: "bad\u0001char", locale: "en" }),
    ).toEqual({ ok: false, reason: "invalid_comment" });
    expect(
      buildSubmission({ stars: 3, comment: "call 0912345678", locale: "en" }),
    ).toEqual({ ok: false, reason: "invalid_feedback" });
  });
});

describe("analytics events", () => {
  it("shown carries the trigger that fired first", () => {
    expect(shownEvent(true)).toEqual({
      name: "result_feedback_shown",
      props: { trigger: "scrolled" },
    });
    expect(shownEvent(false).props).toEqual({ trigger: "dwell" });
  });
  it("submitted carries stars and commented, never the text", () => {
    expect(submittedEvent({ stars: 4, comment: "too high" })).toEqual({
      name: "result_feedback_submitted",
      props: { stars: 4, commented: true },
    });
    expect(submittedEvent({ stars: 2 }).props).toEqual({
      stars: 2,
      commented: false,
    });
  });
  it("dismissed only while the form is open", () => {
    expect(dismissedEventDue("form")).toBe(true);
    expect(dismissedEventDue("thanks")).toBe(false);
    expect(dismissedEventDue("already")).toBe(false);
    expect(dismissedEventDue("sending")).toBe(false);
  });
});
