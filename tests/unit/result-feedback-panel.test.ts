import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ResultFeedbackPanel,
  failureText,
  type ResultFeedbackPanelProps,
} from "../../src/components/results/ResultFeedbackPanel";
import {
  RESULT_FEEDBACK_MAX_STARS,
  RESULT_FEEDBACK_NOTICE_VERSION,
} from "../../src/lib/contracts/result-feedback";
import { MAX_FEEDBACK_CHARS } from "../../src/lib/contracts/survey";
import {
  en,
  resultFeedbackCopy,
  zhTW,
} from "../../src/lib/copy/result-feedback";
import { questionnaireCopy } from "../../src/lib/copy/questionnaire";

/**
 * The sheet's screens as static markup (the unit tests run without a DOM): the
 * frames A to E of the v2 design. An interaction (a tap, Escape, the timer) is
 * covered by tests/e2e/result-feedback.spec.ts in a real browser.
 */

const noop = () => undefined;

function render(overrides: Partial<ResultFeedbackPanelProps> = {}): string {
  return renderToStaticMarkup(
    createElement(ResultFeedbackPanel, {
      language: "zh-TW",
      phase: "form",
      stars: null,
      comment: "",
      notesOpen: false,
      failure: null,
      onStars: noop,
      onComment: noop,
      onToggleNotes: noop,
      onSubmit: noop,
      onClose: noop,
      onEscape: noop,
      ...overrides,
    }),
  );
}

describe("frame A: only the stars", () => {
  const html = render();
  it("names the sheet and the group, and has five radios", () => {
    // A dialog that does not block the page: named by its title, not modal.
    expect(html).toMatch(/<section[^>]*role="dialog"/);
    const labelled = html.match(/<section[^>]*aria-labelledby="([^"]+)"/)?.[1];
    expect(labelled).toBeTruthy();
    expect(html).toMatch(
      new RegExp(
        `id="${labelled}" class="results-feedback-title"[^>]*>${zhTW.title}<`,
      ),
    );
    expect(html).not.toContain("aria-modal");
    expect(html).toContain(zhTW.starsGroup);
    expect(html.match(/type="radio"/g)).toHaveLength(RESULT_FEEDBACK_MAX_STARS);
    for (let n = 1; n <= RESULT_FEEDBACK_MAX_STARS; n += 1) {
      expect(html).toContain(
        `aria-label="${zhTW.starName(n, RESULT_FEEDBACK_MAX_STARS)}"`,
      );
    }
    expect(html).not.toContain("checked");
  });
  it("has no submit button, and the comment box is folded away (inert)", () => {
    expect(html).not.toContain("results-feedback-primary");
    expect(html).toMatch(/results-feedback-collapse" data-open="false"/);
    expect(html).toMatch(/results-feedback-collapseInner" inert=""/);
  });
  it("has the data link, collapsed, controlling the notes", () => {
    const link = html.match(/<button[^>]*results-feedback-link[^>]*>/)?.[0];
    expect(link).toContain('aria-expanded="false"');
    const controls = link?.match(/aria-controls="([^"]+)"/)?.[1];
    expect(controls).toBeTruthy();
    expect(html).toContain(`id="${controls}"`);
    expect(html).toContain(zhTW.dataLink);
  });
  it("has the X with the 'we will not ask again' name", () => {
    expect(html).toContain(`aria-label="${zhTW.closeLabel}"`);
    expect(zhTW.closeLabel).toBe("關閉（這台裝置上這次結果不再詢問）");
    expect(en.closeLabel).toBe(
      "Close (we won't ask again for this result on this device)",
    );
  });
  it("no longer carries the old long notice or 'not now'", () => {
    expect(html).not.toContain("稍後再說");
    expect(Object.keys(zhTW)).not.toContain("notice");
    expect(Object.keys(zhTW)).not.toContain("dismiss");
  });
  it("says what 1 and 5 stand for, from the numbers it is given", () => {
    expect(html).toContain(zhTW.lowHint(1));
    expect(html).toContain(zhTW.highHint(RESULT_FEEDBACK_MAX_STARS));
    const ids = [...html.matchAll(/id="([^"]+-(?:low|high))"/g)].map(
      (m) => m[1],
    );
    expect(ids).toHaveLength(2);
    for (const id of ids) {
      expect(html).toContain(`aria-describedby="${id}"`);
    }
    // The end labels themselves stay hidden from a screen reader.
    expect(html).toMatch(/results-feedback-ends" aria-hidden="true"/);
  });
  it("draws the stars as svg, never as a text glyph", () => {
    expect(html).not.toContain("★");
    expect(html.match(/<svg/g)!.length).toBeGreaterThan(5);
  });
});

describe("frame B: a star is chosen", () => {
  const html = render({ stars: 4, comment: "abc" });
  it("checks one radio and fills the stars up to it", () => {
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html.match(/data-filled="true"/g)).toHaveLength(4);
  });
  it("opens the comment box with its label, helper and a counter from MAX_FEEDBACK_CHARS", () => {
    expect(html).toMatch(/results-feedback-collapse" data-open="true"/);
    expect(html).toContain(zhTW.commentLabel);
    expect(html).toContain(zhTW.helper);
    expect(html).toContain(zhTW.count(3, MAX_FEEDBACK_CHARS));
    expect(html).toContain("3 / 500");
    expect(html).toContain(`maxLength="${MAX_FEEDBACK_CHARS}"`);
  });
  it("has the submit pill, and the textarea is described by the helper and the counter", () => {
    expect(html).toContain("results-feedback-primary");
    const area = html.match(/<textarea[^>]*>/)?.[0] ?? "";
    expect(area).toMatch(/aria-describedby="[^"]+-helper [^"]+-count"/);
    expect(area).not.toContain("autofocus");
  });
  it("shows only the word for 'send' and keeps the other two hidden in the same cell", () => {
    const labels = [
      ...html.matchAll(
        /results-feedback-primaryLabel" data-active="(true|false)">([^<]*)</g,
      ),
    ].map((m) => [m[1], m[2]]);
    expect(labels).toEqual([
      ["true", zhTW.send],
      ["false", zhTW.sending],
      ["false", zhTW.retry],
    ]);
  });
});

describe("frame C: the data note", () => {
  const html = render({ notesOpen: true });
  it("expands the link and shows the three rows", () => {
    expect(html).toContain('aria-expanded="true"');
    const notes = html.match(/id="([^"]+-notes)"[^>]*data-open="true"/);
    expect(notes).not.toBeNull();
    for (const text of [
      zhTW.keptTitle,
      zhTW.keptBody,
      zhTW.notKeptTitle,
      zhTW.notKeptBody,
      zhTW.withdrawTitle,
      zhTW.withdrawBody,
    ]) {
      expect(html).toContain(text);
    }
    expect(html.match(/<li>/g)).toHaveLength(3);
  });
  it("is not inert once open", () => {
    expect(html).not.toMatch(/results-feedback-notes[^>]*inert/);
    expect(html).not.toMatch(
      /data-open="true"><div class="results-feedback-collapseInner" inert/,
    );
  });
});

describe("sending", () => {
  const html = render({ phase: "sending", stars: 3 });
  it("disables the stars, marks the button busy, and shows the sending word as the active one", () => {
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).toMatch(/results-feedback-primary"[^>]*aria-disabled="true"/);
    expect(html).toContain(`data-active="true">${zhTW.sending}<`);
    expect(html).toMatch(/results-feedback-close"[^>]*aria-disabled="true"/);
  });
});

describe("frame D: thanks", () => {
  const html = render({ phase: "thanks", stars: 5 });
  it("shows the check and the thanks, no form", () => {
    expect(html).toContain(zhTW.done);
    expect(html).toContain("results-feedback-bigCheck");
    expect(html).not.toContain("<fieldset");
    expect(html).not.toContain("<textarea");
    expect(html).toContain(`aria-label="${zhTW.closeLabel}"`);
  });
});

describe("already sent", () => {
  it("says so and offers the done button", () => {
    const html = render({ phase: "already" });
    expect(html).toContain(zhTW.already);
    expect(html).toContain(`>${zhTW.ok}<`);
  });
});

describe("frame E: a failed send", () => {
  const html = render({ stars: 2, failure: "network" });
  it("shows the message under the box with an alert role and an icon", () => {
    expect(html).toMatch(/role="alert"/);
    expect(html).toContain(zhTW.sendFailed);
    expect(html).toContain('aria-invalid="true"');
    const area = html.match(/<textarea[^>]*>/)?.[0] ?? "";
    expect(area).toMatch(/aria-describedby="[^"]+-error [^"]+-count"/);
    expect(html).not.toContain(zhTW.helper);
  });
  it("the primary button says 'try again'", () => {
    expect(html).toContain(`data-active="true">${zhTW.retry}<`);
  });
  it("maps each reason to its words, sharing the questionnaire's where it has them", () => {
    for (const lang of ["zh-TW", "en"] as const) {
      const copy = resultFeedbackCopy(lang);
      const qn = questionnaireCopy(lang);
      expect(failureText(null, copy, qn)).toBeNull();
      expect(failureText("rate_limited", copy, qn)).toBe(qn.rateLimited);
      expect(failureText("invalid", copy, qn)).toBe(qn.sendInvalid);
      expect(failureText("invalid_feedback", copy, qn)).toBe(
        qn.sendFeedbackInvalid,
      );
      expect(failureText("invalid_comment", copy, qn)).toBe(copy.commentChars);
      expect(failureText("network", copy, qn)).toBe(copy.sendFailed);
    }
  });
});

describe("English", () => {
  it("shows the English words, with Submit and not Send", () => {
    const html = render({ language: "en", stars: 3 });
    expect(html).toContain(en.title);
    expect(html).toContain(">Submit<");
    expect(html).not.toContain(">Send<");
    expect(html).toContain(en.commentLabel);
    expect(html).toContain(en.dataLink);
    expect(html).toContain(
      `aria-label="${en.starName(3, RESULT_FEEDBACK_MAX_STARS)}"`,
    );
  });
});

describe("the copy tables", () => {
  const keys = (o: object) => Object.keys(o).sort();
  it("zh-TW and English have the same keys", () => {
    expect(keys(zhTW)).toEqual(keys(en));
  });
  it("write no number into a string: the star and the counter come in as arguments", () => {
    const strings = (c: typeof zhTW) =>
      Object.entries(c)
        .filter(([, v]) => typeof v === "string")
        .map(([k, v]) => [k, v as string]);
    for (const c of [zhTW, en]) {
      for (const [key, value] of strings(c)) {
        expect(value, key).not.toMatch(/\d/);
      }
    }
    expect(zhTW.starName(4, 5)).toContain("4");
    expect(en.count(7, 500)).toBe("7 / 500");
  });
  it("carry the agreed candidate words", () => {
    expect(zhTW.title).toBe("這次的推薦符合你的感覺嗎？");
    expect(zhTW.send).toBe("送出");
    expect(zhTW.retry).toBe("再試一次");
    expect(zhTW.sendFailed).toBe("送出失敗，請確認網路後再試一次。");
    expect(en.title).toBe("Do these picks feel right for your hand?");
    expect(en.send).toBe("Submit");
    expect(en.sending).toBe("Submitting…");
    expect(en.retry).toBe("Try again");
  });
  it("the notice version is the v2 one", () => {
    expect(RESULT_FEEDBACK_NOTICE_VERSION).toBe(
      "result-feedback-notice-v2-draft",
    );
  });
});
