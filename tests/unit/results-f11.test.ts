import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FilterSheet } from "@/components/results/filter/FilterSheet";
import { RESULT_FEEDBACK_NOTICE_VERSION } from "@/lib/contracts/result-feedback";
import { emptyFilters } from "@/lib/results/filters";
import {
  FEEDBACK_PROMPT_KEY,
  RESULT_FEEDBACK_COOLDOWN_MS,
  RESULT_FEEDBACK_DWELL_MS,
  RESULT_FEEDBACK_MIN_DWELL_MS,
  markPromptShown,
  promptCoolingDown,
  readLastPrompt,
  shouldShowSheet,
} from "@/lib/results/resultFeedback";
import {
  RESULTS_ACTION_HISTORY,
  RESULTS_HISTORY_KEY,
  customHistoryState,
  notePendingArrival,
  noteScanHandoff,
  parseStamp,
  pendingForPick,
  pickNavigation,
  stampOnArrival,
  takeArrivalMemory,
  topBarBack,
  type PendingArrival,
  type ResultsStamp,
} from "@/lib/results/resultsHistory";
import { filterFit } from "./fixtures/filter-fit";

// ---------------------------------------------------------------- 6. the X

describe("F11-6: the filter sheet's close button", () => {
  const html = renderToStaticMarkup(
    createElement(FilterSheet, {
      response: filterFit([
        { slug: "a1", brand: "Zowie", size: "medium", weightG: 60 },
        { slug: "b2", brand: "Razer", size: "small", weightG: 55 },
      ]),
      language: "zh-TW",
      applied: emptyFilters(),
      onApply: () => {},
      onClosed: () => {},
    }),
  );
  const css = readFileSync(
    fileURLToPath(
      new URL(
        "../../src/components/results/filter/filter.css",
        import.meta.url,
      ),
    ),
    "utf-8",
  );
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    expect(at, selector).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf("}", at));
  };

  it("is a button named for what it does, with a 24 px glyph", () => {
    const button = html.match(
      /<button[^>]*class="results-sheet-close"[^>]*>([\s\S]*?)<\/button>/,
    );
    expect(button).not.toBeNull();
    expect(button![0]).toContain('type="button"');
    expect(button![0]).toContain('aria-label="關閉篩選"');
    expect(button![1]).toMatch(/<svg[^>]*width="24"[^>]*height="24"/);
    expect(button![1]).toContain('aria-hidden="true"');
  });

  it("is at least 44 x 44 (3rem = 48 CSS px) and never shrinks", () => {
    const close = rule(".results-sheet-close");
    const size = (prop: string) =>
      Number(close.match(new RegExp(`\\n\\s*${prop}: ([\\d.]+)rem`))![1]);
    expect(size("width") * 16).toBeGreaterThanOrEqual(44);
    expect(size("height") * 16).toBeGreaterThanOrEqual(44);
    expect(close).toContain("flex: none");
  });

  it("has a visible keyboard focus ring", () => {
    expect(css).toMatch(
      /\.results-sheet-close:focus-visible[\s\S]*?\{[^}]*outline: 2px solid/,
    );
  });
});

// ----------------------------------------------------- 7. the survey timing

/** An in-memory Storage. */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    map,
  };
}

const ready = {
  answered: false as boolean | null,
  dismissedLocally: false,
  scrolledToEnd: true,
  visibleElapsedMs: RESULT_FEEDBACK_MIN_DWELL_MS,
  hasScrolled: true,
  canScroll: true,
  isDemo: false,
  openedDetails: false,
  coolingDown: false,
  questionnaireAnswered: false,
};

describe("F11-7: when the feedback sheet may appear", () => {
  it("never on arrival, whatever happened in the first 20 s", () => {
    for (const ms of [0, 1_000, RESULT_FEEDBACK_MIN_DWELL_MS - 1]) {
      expect(
        shouldShowSheet({
          ...ready,
          visibleElapsedMs: ms,
          openedDetails: true,
        }),
      ).toBe(false);
    }
    expect(RESULT_FEEDBACK_MIN_DWELL_MS).toBe(20_000);
  });

  it("after 20 s once the person reached the end of the list or opened Details", () => {
    expect(shouldShowSheet(ready)).toBe(true);
    expect(
      shouldShowSheet({ ...ready, scrolledToEnd: false, openedDetails: true }),
    ).toBe(true);
    // 20 s and a scroll that did not reach the end: the 45 s rule still waits.
    expect(
      shouldShowSheet({ ...ready, scrolledToEnd: false, openedDetails: false }),
    ).toBe(false);
    expect(
      shouldShowSheet({
        ...ready,
        scrolledToEnd: false,
        visibleElapsedMs: RESULT_FEEDBACK_DWELL_MS,
      }),
    ).toBe(true);
  });

  it("never while this device is cooling down, or when the questionnaire is answered", () => {
    expect(shouldShowSheet({ ...ready, coolingDown: true })).toBe(false);
    expect(shouldShowSheet({ ...ready, questionnaireAnswered: true })).toBe(
      false,
    );
    expect(
      shouldShowSheet({
        ...ready,
        questionnaireAnswered: true,
        visibleElapsedMs: 10 * RESULT_FEEDBACK_DWELL_MS,
      }),
    ).toBe(false);
  });
});

describe("F11-7: the device's memory of the last prompt", () => {
  const NOW = Date.UTC(2026, 9, 21, 4, 0, 0);

  it("nothing stored: no cool-down", () => {
    const storage = memoryStorage();
    expect(readLastPrompt(() => storage)).toBeNull();
    expect(
      promptCoolingDown(
        readLastPrompt(() => storage),
        NOW,
      ),
    ).toBe(false);
  });

  it("a prompt keeps the next one away for 30 days, on any scan", () => {
    const storage = memoryStorage();
    expect(markPromptShown(NOW, () => storage)).toBe(true);
    expect(JSON.parse(storage.map.get(FEEDBACK_PROMPT_KEY)!)).toEqual({
      at: NOW,
      notice: RESULT_FEEDBACK_NOTICE_VERSION,
    });
    const last = readLastPrompt(() => storage);
    expect(RESULT_FEEDBACK_COOLDOWN_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(promptCoolingDown(last, NOW)).toBe(true);
    expect(promptCoolingDown(last, NOW + RESULT_FEEDBACK_COOLDOWN_MS - 1)).toBe(
      true,
    );
    expect(promptCoolingDown(last, NOW + RESULT_FEEDBACK_COOLDOWN_MS)).toBe(
      false,
    );
  });

  it("a new notice version ends the cool-down", () => {
    expect(
      promptCoolingDown({ at: Date.now(), notice: "older-notice" }, Date.now()),
    ).toBe(false);
  });

  it("a time in the future (clock set back) still cools down", () => {
    expect(
      promptCoolingDown(
        { at: NOW + 1_000_000, notice: RESULT_FEEDBACK_NOTICE_VERSION },
        NOW,
      ),
    ).toBe(true);
  });

  it("storage that is missing or throws counts as already shown", () => {
    expect(readLastPrompt(() => null)).toBe("unreadable");
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readLastPrompt(() => throwing)).toBe("unreadable");
    expect(
      readLastPrompt(() => {
        throw new Error("SecurityError");
      }),
    ).toBe("unreadable");
    expect(promptCoolingDown("unreadable", NOW)).toBe(true);
    expect(markPromptShown(NOW, () => throwing)).toBe(false);
    expect(markPromptShown(NOW, () => null)).toBe(false);
  });

  it("a value it cannot read as a prompt is as if there were none", () => {
    for (const raw of ["1", "not json", "{}", '{"at":"x","notice":"n"}']) {
      const storage = memoryStorage();
      storage.setItem(FEEDBACK_PROMPT_KEY, raw);
      expect(
        readLastPrompt(() => storage),
        raw,
      ).toBeNull();
    }
  });

  it("repeated scans on one device: one prompt, then none for 30 days", () => {
    const storage = memoryStorage();
    let shown = 0;
    // Five scans an hour apart, each with the person reading for 20 s.
    for (let scan = 0; scan < 5; scan += 1) {
      const now = NOW + scan * 3_600_000;
      const coolingDown = promptCoolingDown(
        readLastPrompt(() => storage),
        now,
      );
      if (shouldShowSheet({ ...ready, coolingDown })) {
        shown += 1;
        markPromptShown(now, () => storage);
      }
    }
    expect(shown).toBe(1);
    // 31 days later the next scan may ask again.
    const later = NOW + 31 * 24 * 3_600_000;
    expect(
      shouldShowSheet({
        ...ready,
        coolingDown: promptCoolingDown(
          readLastPrompt(() => storage),
          later,
        ),
      }),
    ).toBe(true);
  });
});

// --------------------------------------------------------- 8. the back button

describe("F11-8: what each action does to history", () => {
  it("only opening another mouse's detail page from the main page adds an entry", () => {
    const pushing = Object.entries(RESULTS_ACTION_HISTORY)
      .filter(([, effect]) => effect === "push")
      .map(([action]) => action);
    expect(pushing).toEqual(["openDetailFromMain"]);
    for (const action of [
      "shapeToggle",
      "filterChange",
      "filterSheetOpen",
      "filterSheetClose",
      "detailsToggle",
      "otherMiceToggle",
      "photoZoom",
      "share",
      "feedbackSheet",
    ] as const) {
      expect(RESULTS_ACTION_HISTORY[action], action).toBe("none");
    }
  });

  it("the shape toggle and the filter write the URL with replaceState, keeping the entry's stamp", () => {
    const source = readFileSync(
      fileURLToPath(
        new URL(
          "../../src/app/results/[scanId]/ResultsRankClient.tsx",
          import.meta.url,
        ),
      ),
      "utf-8",
    );
    expect(source).not.toMatch(/history\.pushState|router\.push\(/);
    expect(source).toContain(
      "window.history.replaceState(\n        customHistoryState(window.history.state),",
    );
  });
});

const stamp = (over: Partial<ResultsStamp> = {}): ResultsStamp => ({
  scanId: "s1",
  path: "/results/s1",
  depth: 0,
  scanBehind: true,
  ...over,
});

describe("F11-8: pickNavigation", () => {
  it("main to a detail page pushes; detail to detail replaces", () => {
    expect(
      pickNavigation({ fromMain: true, toMain: false, stamp: stamp() }),
    ).toEqual({ kind: "push" });
    expect(
      pickNavigation({
        fromMain: false,
        toMain: false,
        stamp: stamp({ depth: 1 }),
      }),
    ).toEqual({ kind: "replace" });
  });
  it("detail to the first place goes back when the main entry is right behind, else replaces", () => {
    expect(
      pickNavigation({
        fromMain: false,
        toMain: true,
        stamp: stamp({ depth: 1 }),
      }),
    ).toEqual({ kind: "back" });
    expect(
      pickNavigation({ fromMain: false, toMain: true, stamp: stamp() }),
    ).toEqual({ kind: "replace" });
    expect(
      pickNavigation({ fromMain: false, toMain: true, stamp: null }),
    ).toEqual({ kind: "replace" });
  });
});

describe("F11-8: stamps", () => {
  it("parses only a well-formed stamp", () => {
    expect(parseStamp(null)).toBeNull();
    expect(parseStamp({})).toBeNull();
    expect(parseStamp({ [RESULTS_HISTORY_KEY]: { scanId: "s1" } })).toBeNull();
    expect(
      parseStamp({ [RESULTS_HISTORY_KEY]: { ...stamp(), depth: 2 } }),
    ).toBeNull();
    expect(parseStamp({ __NA: true, [RESULTS_HISTORY_KEY]: stamp() })).toEqual(
      stamp(),
    );
  });

  it("keeps the entry's own stamp on back, forward, reload and filter changes", () => {
    const existing = stamp({ depth: 1, path: "/results/s1/m/g305" });
    expect(
      stampOnArrival({
        scanId: "s1",
        path: "/results/s1/m/g305",
        isMain: false,
        existing,
        pending: null,
        scanHandoff: null,
      }),
    ).toBe(existing);
  });

  it("a main page opened by the scan page knows the scan page is behind", () => {
    expect(
      stampOnArrival({
        scanId: "s1",
        path: "/results/s1",
        isMain: true,
        existing: null,
        pending: null,
        scanHandoff: "s1",
      }),
    ).toEqual(stamp());
    // Another scan's handoff, or none: a page opened directly.
    for (const scanHandoff of ["s2", null]) {
      expect(
        stampOnArrival({
          scanId: "s1",
          path: "/results/s1",
          isMain: true,
          existing: null,
          pending: null,
          scanHandoff,
        }).scanBehind,
      ).toBe(false);
    }
  });

  it("a stamp from another path (stale) is not kept", () => {
    const pending: PendingArrival = {
      scanId: "s1",
      depth: 1,
      scanBehind: true,
    };
    expect(
      stampOnArrival({
        scanId: "s1",
        path: "/results/s1/m/g305",
        isMain: false,
        existing: stamp(),
        pending,
        scanHandoff: null,
      }),
    ).toEqual(stamp({ path: "/results/s1/m/g305", depth: 1 }));
  });

  it("the module memory is read once", () => {
    noteScanHandoff("s9");
    notePendingArrival({ scanId: "s9", depth: 1, scanBehind: false });
    expect(takeArrivalMemory()).toEqual({
      pending: { scanId: "s9", depth: 1, scanBehind: false },
      scanHandoff: "s9",
    });
    expect(takeArrivalMemory()).toEqual({ pending: null, scanHandoff: null });
  });

  it("drops Next.js's own keys before replaceState, keeps the others", () => {
    expect(
      customHistoryState({
        __NA: true,
        __PRIVATE_NEXTJS_INTERNALS_TREE: ["x"],
        _N: 1,
        [RESULTS_HISTORY_KEY]: stamp(),
        other: 2,
      }),
    ).toEqual({ [RESULTS_HISTORY_KEY]: stamp(), other: 2 });
    expect(customHistoryState(null)).toEqual({});
  });
});

describe("F11-8: the top bar's back", () => {
  it("goes back past the results when the scan page is behind them", () => {
    expect(topBarBack(stamp(), "s1")).toEqual({ kind: "history", steps: 1 });
    expect(topBarBack(stamp({ depth: 1 }), "s1")).toEqual({
      kind: "history",
      steps: 2,
    });
  });
  it("is the plain link otherwise", () => {
    expect(topBarBack(null, "s1")).toEqual({ kind: "link" });
    expect(topBarBack(stamp({ scanBehind: false }), "s1")).toEqual({
      kind: "link",
    });
    expect(topBarBack(stamp(), "s2")).toEqual({ kind: "link" });
    expect(topBarBack(stamp(), undefined)).toEqual({ kind: "link" });
  });
});

/**
 * A small model of a tab's history running the rules end to end: each page
 * stamps itself on arrival, cards follow `pickNavigation`, and in-page actions
 * add nothing. After any walk, back from a detail page lands on the list and
 * the next back (or the top bar's back) on the scan page.
 */
describe("F11-8: a simulated walk through the results pages", () => {
  type Entry = { path: string; stamp: ResultsStamp | null };
  function tab() {
    const entries: Entry[] = [{ path: "/scan/easy", stamp: null }];
    let index = 0;
    let pending: PendingArrival | null = null;
    let handoff: string | null = null;
    const current = () => entries[index];
    const arrive = () => {
      const e = current();
      if (!e.path.startsWith("/results/s1")) return;
      e.stamp = stampOnArrival({
        scanId: "s1",
        path: e.path,
        isMain: e.path === "/results/s1",
        existing: e.stamp,
        pending,
        scanHandoff: handoff,
      });
      pending = null;
      handoff = null;
    };
    const push = (path: string) => {
      entries.splice(index + 1);
      entries.push({ path, stamp: null });
      index += 1;
      arrive();
    };
    return {
      entries,
      current,
      submitScan() {
        handoff = "s1";
        push("/results/s1");
      },
      /** In-page actions: toggle, filter, Details, sheets, share, feedback. */
      inPage() {
        // replaceState with the same entry: nothing is added, the stamp stays.
      },
      openCard(toPath: string) {
        const fromMain = current().path === "/results/s1";
        const toMain = toPath === "/results/s1";
        const s = current().stamp;
        const nav = pickNavigation({ fromMain, toMain, stamp: s });
        pending = pendingForPick(nav, { scanId: "s1", toMain, stamp: s });
        if (nav.kind === "push") push(toPath);
        else if (nav.kind === "back") {
          index -= 1;
          arrive();
        } else {
          entries[index] = { path: toPath, stamp: null };
          arrive();
        }
      },
      back() {
        index -= 1;
        arrive();
      },
      topBarBack() {
        const b = topBarBack(current().stamp, "s1");
        if (b.kind === "link") push("/scan/easy");
        else index -= b.steps;
      },
    };
  }

  it("toggle, filter, Details, then back: leaves the results", () => {
    const t = tab();
    t.submitScan();
    t.inPage();
    t.inPage();
    t.inPage();
    t.back();
    expect(t.current().path).toBe("/scan/easy");
  });

  it("main, #2, #3, #1, #4: two backs reach the scan page", () => {
    const t = tab();
    t.submitScan();
    t.openCard("/results/s1/m/g305");
    t.openCard("/results/s1/m/viper");
    t.openCard("/results/s1");
    t.openCard("/results/s1/m/zowie");
    expect(t.entries.map((e) => e.path)).toEqual([
      "/scan/easy",
      "/results/s1",
      "/results/s1/m/zowie",
    ]);
    t.back();
    expect(t.current().path).toBe("/results/s1");
    t.back();
    expect(t.current().path).toBe("/scan/easy");
  });

  it("the top bar's back from a detail page goes to the scan page in one press", () => {
    const t = tab();
    t.submitScan();
    t.openCard("/results/s1/m/g305");
    t.inPage();
    t.topBarBack();
    expect(t.current().path).toBe("/scan/easy");
  });
});
