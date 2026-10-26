import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResultsView } from "../../src/components/results/ResultsView";
import { SimilarHandsView } from "../../src/components/results/SimilarHands";
import { SurveyReminderView } from "../../src/components/results/SurveyReminderLink";
import { FIXTURES } from "../../src/components/results/fixtures";
import { en, zhTW } from "../../src/lib/copy/results-additions";
import {
  fetchSimilar,
  formatSatisfaction,
  type SimilarState,
} from "../../src/lib/results/similarHands";
import {
  fetchReminderStatus,
  markSurveyAnswered,
  readAnsweredFlag,
  SURVEY_ANSWERED_KEY,
  surveyIsAnswered,
  type FlagStorage,
} from "../../src/lib/results/surveyReminder";

const mouse = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  brand: "Logitech",
  model: `Model ${slug}`,
  raters: 9,
  meanSatisfaction: 4.4,
  ...extra,
});
const available = (mice: unknown[], neighbours = 17) => ({
  available: true,
  neighbours,
  basis: { handLengthBinMm: 180, palmWidthBinMm: 85, gripStyle: "claw" },
  mice,
});

/** A fetch that answers with a status and a body, and remembers what it was asked. */
function answer(status: number, body: unknown) {
  const calls: { url: string; init?: { cache?: string } }[] = [];
  const impl = async (url: string, init?: { cache?: "no-store" }) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  };
  return { impl, calls };
}
const failing = async () => {
  throw new Error("offline");
};

describe("formatSatisfaction: the mean as 4.4/5", () => {
  it("is one decimal, over five, with a half-width slash", () => {
    expect(formatSatisfaction(4.4)).toBe("4.4/5");
    expect(formatSatisfaction(4)).toBe("4.0/5");
    expect(formatSatisfaction(5)).toBe("5.0/5");
    expect(formatSatisfaction(1)).toBe("1.0/5");
    expect(formatSatisfaction(3.949)).toBe("3.9/5");
    expect(formatSatisfaction(4.333333)).toBe("4.3/5");
  });
  it("rounds a half up even where binary floats would round it down", () => {
    expect(formatSatisfaction(4.35)).toBe("4.4/5");
    expect(formatSatisfaction(4.45)).toBe("4.5/5");
  });
  it("never uses a full-width slash", () => {
    expect(formatSatisfaction(4.2)).not.toContain("／");
  });
});

describe("fetchSimilar: one answer per case, never a throw", () => {
  it("asks the scan's similar route without a cache", async () => {
    const { impl, calls } = answer(200, available([mouse("a")]));
    await fetchSimilar("scan 1", undefined, impl);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/scans/scan%201/similar");
    expect(calls[0].init?.cache).toBe("no-store");
  });

  it("available: true is ready, with the count and the mice", async () => {
    const { impl } = answer(200, available([mouse("a"), mouse("b")], 17));
    const state = await fetchSimilar("s", undefined, impl);
    expect(state.status).toBe("ready");
    if (state.status !== "ready") throw new Error("not ready");
    expect(state.neighbours).toBe(17);
    expect(state.mice.map((m) => m.slug)).toEqual(["a", "b"]);
  });

  it("available: false is unavailable", async () => {
    const { impl } = answer(200, {
      available: false,
      reason: "insufficient_data",
    });
    expect(await fetchSimilar("s", undefined, impl)).toEqual({
      status: "unavailable",
    });
  });

  it.each([404, 429, 500, 503])("status %i draws nothing", async (status) => {
    const { impl } = answer(status, {});
    expect(await fetchSimilar("s", undefined, impl)).toEqual({
      status: "hidden",
    });
  });

  it("a network error draws nothing", async () => {
    expect(await fetchSimilar("s", undefined, failing)).toEqual({
      status: "hidden",
    });
  });

  it("a body the contract refuses draws nothing, never a count under 2", async () => {
    for (const body of [
      { nonsense: true },
      available([mouse("a")], 1), // neighbours under the floor
      available([mouse("a", { raters: 1 })]), // raters under the floor
      available([mouse("a", { raters: 30 })], 17), // more raters than neighbours
      available([]), // no mice
      available([1, 2, 3, 4, 5, 6].map((n) => mouse(`m${n}`))), // over five
    ]) {
      const { impl } = answer(200, body);
      expect(await fetchSimilar("s", undefined, impl)).toEqual({
        status: "hidden",
      });
    }
  });
});

const ready = (n: number, neighbours = 17): SimilarState => ({
  status: "ready",
  neighbours,
  mice: Array.from({ length: n }, (_, i) =>
    mouse(`m${i}`, {
      model: `Model ${i}`,
      meanSatisfaction: 4.4 - i * 0.1,
      raters: 9 - i,
    }),
  ) as never,
});

const view = (state: SimilarState, language: "zh-TW" | "en" = "zh-TW") =>
  renderToStaticMarkup(createElement(SimilarHandsView, { state, language }));

describe("SimilarHandsView: the three states", () => {
  it("loading and hidden draw nothing at all", () => {
    expect(view({ status: "loading" })).toBe("");
    expect(view({ status: "hidden" })).toBe("");
  });

  it("not enough data: the heading and the one line", () => {
    const html = view({ status: "unavailable" });
    expect(html).toContain("手掌大小相近的人這樣評價");
    expect(html).toContain("目前資料還不夠，暫時無法顯示。");
    expect(html).not.toContain("<ul");
  });

  it("ready: an h2, the neighbours line and one list row per mouse", () => {
    const html = view(ready(5));
    expect(html).toMatch(/<h2[^>]*>手掌大小相近的人這樣評價<\/h2>/);
    expect(html).toContain("17 位手掌大小相近的人評分");
    expect(html.match(/<li /g)).toHaveLength(5);
    expect(html).toContain("<ul");
    expect(html).toContain("4.4/5");
    expect(html).toContain("9 人評分");
    expect(html).toContain("Logitech");
    expect(html).toContain("Model 0");
    // aria-labelledby points at the heading.
    expect(html).toContain('aria-labelledby="results-similar-heading"');
    expect(html).toContain('id="results-similar-heading"');
  });

  it("the rows are plain: no link, no button, no rank, nothing about the own score", () => {
    const html = view(ready(5));
    expect(html).not.toMatch(/<a[\s>]/);
    expect(html).not.toMatch(/<button[\s>]/);
    expect(html).not.toMatch(/badge|rank|best|最佳|第一名|適配/i);
  });

  it("speaks English too, and never claims accuracy in either language", () => {
    const html = view(ready(2, 5), "en");
    expect(html).toContain("Rated by 5 people with a similar hand size");
    expect(html).toContain("9 ratings");
    for (const table of [zhTW, en]) {
      const all = [
        table.similarHeading,
        table.similarNeighbours(7),
        table.similarRaters(7),
        table.similarUnavailable,
      ].join(" ");
      expect(all).not.toMatch(/更準|準確|accurate|accuracy/i);
    }
  });
});

describe("the copy table", () => {
  it("has the same keys in zh-TW and English", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhTW).sort());
  });
  it("puts the counts in with TypeScript numbers, never one under 2 of its own", () => {
    expect(zhTW.similarNeighbours(17)).toBe("17 位手掌大小相近的人評分");
    expect(zhTW.similarRaters(9)).toBe("9 人評分");
  });
  it("says the unanswered state in words, not by the dot alone", () => {
    expect(zhTW.reminderName).toBe("回答問卷");
    expect(zhTW.reminderNameUnanswered).toBe("回答問卷（尚未填答）");
    expect(en.reminderNameUnanswered).not.toBe(en.reminderName);
  });
});

const rating = (slug: string) => ({
  slug,
  satisfaction: 4,
  painPoints: [],
  current: false,
});
const mineBody = (extra: Record<string, unknown> = {}) => ({
  mainUse: null,
  ratings: [],
  otherMice: [],
  feedback: null,
  ...extra,
});
const SIGNED_IN = [
  200,
  { user: { id: "u1", name: "A", image: null } },
] as const;
const SIGNED_OUT = [200, null] as const;
type Reply = readonly [number, unknown];

/** A fetch that routes the session and survey URLs and records what it was asked. */
function routed(replies: { session: Reply; survey: Reply }) {
  const urls: string[] = [];
  const impl = async (url: string) => {
    urls.push(url);
    const [status, body] =
      url === "/api/auth/session" ? replies.session : replies.survey;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  };
  return { impl, urls };
}
const storageWith = (value: string | null): FlagStorage => ({
  getItem: (key) => (key === SURVEY_ANSWERED_KEY ? value : null),
  setItem: () => {},
});
const throwingStorage = (): FlagStorage => ({
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
});

describe("the dot rule", () => {
  it("signed in: empty answers mean not answered", () => {
    expect(surveyIsAnswered(mineBody() as never)).toBe(false);
    // A comment or a main use alone is not the questionnaire's mice.
    expect(
      surveyIsAnswered(
        mineBody({ mainUse: "gaming", feedback: "hi" }) as never,
      ),
    ).toBe(false);
  });

  it("signed in: a rating, or an other mouse, means answered", () => {
    expect(
      surveyIsAnswered(mineBody({ ratings: [rating("a")] }) as never),
    ).toBe(true);
    expect(
      surveyIsAnswered(
        mineBody({
          otherMice: [
            { brand: "other", sizeFeel: "just_right", current: false },
          ],
        }) as never,
      ),
    ).toBe(true);
  });

  it("signed in: /api/survey decides, the device flag is ignored", async () => {
    const empty = routed({ session: SIGNED_IN, survey: [200, mineBody()] });
    expect(
      await fetchReminderStatus(undefined, empty.impl, () => storageWith("1")),
    ).toBe("unanswered");
    expect(empty.urls).toEqual(["/api/auth/session", "/api/survey"]);
    const full = routed({
      session: SIGNED_IN,
      survey: [200, mineBody({ ratings: [rating("a")] })],
    });
    expect(
      await fetchReminderStatus(undefined, full.impl, () => storageWith(null)),
    ).toBe("answered");
  });

  it("signed out: the flag decides and /api/survey is never called", async () => {
    for (const session of [SIGNED_OUT, [200, {}] as const]) {
      const r = routed({ session, survey: [401, {}] });
      expect(
        await fetchReminderStatus(undefined, r.impl, () => storageWith(null)),
      ).toBe("unanswered");
      expect(
        await fetchReminderStatus(undefined, r.impl, () => storageWith("1")),
      ).toBe("answered");
      expect(r.urls).not.toContain("/api/survey");
    }
  });

  it("signed out with storage missing or throwing: the page still works, with the dot", async () => {
    const r = routed({ session: SIGNED_OUT, survey: [401, {}] });
    expect(await fetchReminderStatus(undefined, r.impl, () => null)).toBe(
      "unanswered",
    );
    expect(await fetchReminderStatus(undefined, r.impl, throwingStorage)).toBe(
      "unanswered",
    );
    expect(
      await fetchReminderStatus(undefined, r.impl, () => {
        throw new Error("no window.localStorage");
      }),
    ).toBe("unanswered");
    expect(r.urls).not.toContain("/api/survey");
  });

  it("a session that cannot be read is unknown, and asks nothing more", async () => {
    for (const session of [
      [500, {}],
      [503, {}],
      [200, { user: "nobody" }],
      [200, "text"],
      [200, [1, 2]],
    ] as const) {
      const r = routed({ session, survey: [200, mineBody()] });
      expect(
        await fetchReminderStatus(undefined, r.impl, () => storageWith(null)),
      ).toBe("unknown");
      expect(r.urls).toEqual(["/api/auth/session"]);
    }
    expect(await fetchReminderStatus(undefined, failing)).toBe("unknown");
  });

  it("signed in but /api/survey fails or is unreadable: unknown", async () => {
    for (const survey of [
      [429, {}],
      [500, {}],
      [401, {}],
      [200, { not: "a survey" }],
    ] as const) {
      const r = routed({ session: SIGNED_IN, survey });
      expect(await fetchReminderStatus(undefined, r.impl)).toBe("unknown");
    }
    const down = async (url: string) => {
      if (url === "/api/survey") throw new Error("offline");
      return { ok: true, status: 200, json: async () => SIGNED_IN[1] };
    };
    expect(await fetchReminderStatus(undefined, down)).toBe("unknown");
  });

  it("the flag is read and written without ever throwing", () => {
    expect(readAnsweredFlag(() => storageWith("1"))).toBe(true);
    expect(readAnsweredFlag(() => storageWith(null))).toBe(false);
    expect(readAnsweredFlag(() => null)).toBe(false);
    expect(readAnsweredFlag(throwingStorage)).toBe(false);
    const written: string[] = [];
    expect(
      markSurveyAnswered(() => ({
        getItem: () => null,
        setItem: (key) => {
          written.push(key);
        },
      })),
    ).toBe(true);
    expect(written).toEqual([SURVEY_ANSWERED_KEY]);
    expect(markSurveyAnswered(throwingStorage)).toBe(false);
    expect(markSurveyAnswered(() => null)).toBe(false);
  });
});

const reminder = (
  status: "unknown" | "unanswered" | "answered",
  language: "zh-TW" | "en" = "zh-TW",
) =>
  renderToStaticMarkup(createElement(SurveyReminderView, { status, language }));

describe("SurveyReminderView", () => {
  it("is a link to /account named 回答問卷, with no dot while answered or unknown", () => {
    for (const status of ["answered", "unknown"] as const) {
      const html = reminder(status);
      expect(html).toContain('href="/account"');
      expect(html).toContain('aria-label="回答問卷"');
      expect(html).not.toContain("results-topBar-reminderDot");
    }
  });

  it("unanswered: the dot, and the name says so in words", () => {
    const html = reminder("unanswered");
    expect(html).toContain("results-topBar-reminderDot");
    expect(html).toContain('aria-label="回答問卷（尚未填答）"');
    // The dot is decorative: the name carries the meaning.
    expect(html).toMatch(/reminderDot"[^>]*aria-hidden="true"/);
    expect(reminder("unanswered", "en")).toContain("(not answered yet)");
  });
});

describe("on the results page", () => {
  const html = renderToStaticMarkup(
    createElement(ResultsView, {
      response: FIXTURES["many-results"],
      language: "zh-TW",
      scanId: "scan-1",
    }),
  );
  it("puts the reminder in the top bar, before the menu button (2026-10-26)", () => {
    const bar = html.indexOf("results-topBar");
    const link = html.indexOf('href="/account"');
    const menu = html.indexOf("navMenuTrigger");
    expect(bar).toBeGreaterThanOrEqual(0);
    expect(link).toBeGreaterThan(bar);
    expect(link).toBeLessThan(menu);
  });
  it("shows no similar block before its answer arrives (nothing flashes)", () => {
    expect(html).not.toContain("results-similar");
  });
});
