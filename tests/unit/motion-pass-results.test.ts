/**
 * V3.2 motion pass, builder B (candidate / 未拍板): the results pages, the
 * account and questionnaire pages, the mice catalogue and the shared dialogs
 * no longer pop in or out. These are source pins: the repo has no DOM test
 * environment, so the CSS rules and the wiring are read as text (the way
 * loader-handoff.test.ts pins its CSS).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const css = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "");

const CSS_FILES = [
  "src/app/globals.css",
  "src/app/account/account.css",
  "src/app/account/questionnaire.css",
  "src/components/nav/nav-menu.css",
  "src/components/consent/cookie-banner.css",
  "src/components/results/share/share.css",
  "src/components/results/results.css",
  "src/components/results/filter/filter.css",
  "src/components/viewer/viewer.css",
];

/** Innermost rules: [selector, body]. */
function rules(source: string): Array<[string, string]> {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [
    m[1]!.trim(),
    m[2]!,
  ]);
}

/** The properties a `transition` value names. */
function transitioned(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0]!)
    .filter(Boolean);
}

const MOVED = /^(opacity|transform)$/;

describe("only transform and opacity move", () => {
  for (const file of CSS_FILES) {
    const source = css(file);
    it(`${file}: every transition timed by a motion token is on transform or opacity`, () => {
      for (const [selector, body] of rules(source)) {
        for (const m of body.matchAll(/(?:^|;)\s*transition:\s*([^;]+)/g)) {
          if (!m[1]!.includes("var(--motion-")) continue;
          for (const property of transitioned(m[1]!))
            expect(property, `${selector} in ${file}`).toMatch(MOVED);
        }
      }
    });

    it(`${file}: the leaving and entering states change nothing but transform and opacity`, () => {
      for (const [selector, body] of rules(source)) {
        if (!/data-leaving|data-enter|data-state="entering"/.test(selector))
          continue;
        for (const m of body.matchAll(/(?:^|;)\s*([a-z-]+)\s*:/g))
          expect(m[1], `${selector} in ${file}`).toMatch(
            /^(opacity|transform|pointer-events|animation|animation-duration|transition|transition-duration|--motion-enter-x)$/,
          );
      }
    });
  }

  it("the shared keyframes and the new ones move only transform and opacity", () => {
    const all = CSS_FILES.map(css).join("\n");
    const names = [
      "motion-fade-in",
      "motion-fade-out",
      "motion-sheet-up",
      "motion-shift-in",
      "sharePreview-grow",
    ];
    for (const name of names) {
      const at = all.indexOf(`@keyframes ${name} {`);
      expect(at, name).toBeGreaterThanOrEqual(0);
      const end = all.indexOf("\n}", at);
      const block = all.slice(at, end);
      for (const m of block.matchAll(/([a-z-]+)\s*:/g))
        expect(m[1], name).toMatch(MOVED);
    }
  });
});

describe("reduced motion is a --motion-reduced fade everywhere it was touched", () => {
  for (const file of CSS_FILES) {
    it(file, () => {
      const source = css(file);
      const blocks = [
        ...source.matchAll(/@media \(prefers-reduced-motion: reduce\) \{/g),
      ];
      expect(blocks.length, file).toBeGreaterThan(0);
      expect(source).toMatch(
        /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?var\(--motion-reduced\)/,
      );
    });
  }

  it("no leaving state moves under reduced motion", () => {
    for (const [file, selector] of [
      ["src/app/globals.css", '.dialog[data-leaving="true"]'],
      [
        "src/app/account/account.css",
        'dialog.profile-sheet[data-leaving="true"]',
      ],
      [
        "src/app/account/questionnaire.css",
        'dialog.qn-confirm[data-leaving="true"]',
      ],
      ["src/components/nav/nav-menu.css", '.navMenu[data-leaving="true"]'],
      [
        "src/components/results/filter/filter.css",
        'dialog.results-sheet[data-leaving="true"]',
      ],
      [
        "src/components/results/results.css",
        '.results-feedback[data-leaving="true"] .results-feedback-sheet',
      ],
    ] as const) {
      const source = css(file);
      const media = source.slice(
        source.lastIndexOf("@media (prefers-reduced-motion: reduce)"),
      );
      const reducedBlocks = [
        ...source.matchAll(
          /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g,
        ),
      ]
        .map((m) => m[1]!)
        .join("\n");
      expect(media.length).toBeGreaterThan(0);
      const rule = rules(reducedBlocks).find(([s]) =>
        s.split(",").some((part) => part.trim() === selector),
      );
      expect(rule, `${selector} under reduced motion in ${file}`).toBeDefined();
      expect(rule![1], selector).toMatch(/transform:\s*none/);
    }
  });
});

describe("the wiring", () => {
  it("a native dialog's Esc goes through the same leaving path, never the instant close", () => {
    for (const file of [
      "src/components/nav/NavMenu.tsx",
      "src/app/account/AccountView.tsx",
      "src/components/results/PhotoZoom.tsx",
    ]) {
      expect(read(file), file).toMatch(
        /onCancel=\{\(event\) => \{[\s\S]{0,160}?event\.preventDefault\(\);/,
      );
    }
    // The account and questionnaire sheets and the removal confirmation.
    expect(read("src/app/account/modal.ts")).toMatch(
      /event\?\.preventDefault\(\);\s*if \(!unmounting\.current\) closeRef\.current\(\);/,
    );
  });

  it("every leave is timed by leaveMs() (no millisecond number of its own)", () => {
    expect(read("src/components/consent/CookieBanner.tsx")).not.toMatch(
      /EXIT_MS|360/,
    );
    expect(read("src/components/consent/CookieBanner.tsx")).toContain(
      'leaveMs("sheet", reducedMotionNow())',
    );
    const filterSheet = read("src/components/results/filter/FilterSheet.tsx");
    expect(filterSheet).toContain('leaveMs("sheet", prefersReducedMotion())');
    // #30: reduced motion no longer closes in 0 ms.
    expect(filterSheet).not.toMatch(
      /if \(prefersReducedMotion\(\)\) \{\s*finish\(\);/,
    );
    expect(read("src/components/motion/Presence.tsx")).toContain(
      "leaveMs(kind, reducedMotionNow())",
    );
  });

  it("the owners keep their dialogs and sheets for the way out", () => {
    const pins: Array<[string, RegExp]> = [
      ["src/components/nav/NavMenu.tsx", /usePresence\(open, "sheet"\)/],
      [
        "src/components/results/DeleteScanAction.tsx",
        /usePresence\(open, "fade"\)/,
      ],
      ["src/app/account/AccountView.tsx", /usePresence\(confirmOpen, "fade"\)/],
      ["src/app/account/AccountView.tsx", /<Presence\s+kind="sheet"/],
      [
        "src/app/account/AccountClient.tsx",
        /<Presence kind="sheet">\{renderOverlay\(\)\}<\/Presence>/,
      ],
      [
        "src/app/account/AccountClient.tsx",
        /<Presence kind="fade">\{renderRemove\(\)\}<\/Presence>/,
      ],
      ["src/app/account/QuestionnaireForm.tsx", /<Presence kind="sheet">/],
      [
        "src/components/results/share/ShareCardButton.tsx",
        /usePresence\(open, "fade"/,
      ],
      [
        "src/components/results/ResultFeedbackSheet.tsx",
        /usePresence\(visible, "sheet"\)/,
      ],
      [
        "src/components/viewer/ViewerRegion.tsx",
        /usePresence\(\s*status === "idle" \|\| status === "loading",\s*"fade",?\s*\)/,
      ],
      ["src/components/results/PhotoZoom.tsx", /useLeaveThenClose\(/],
    ];
    for (const [file, pattern] of pins)
      expect(read(file), file).toMatch(pattern);
  });

  it("the mouse picker's two steps are one dialog that swaps its content (#11)", () => {
    const flow = read("src/app/account/MouseChoice.tsx");
    expect(flow).toMatch(/swapKey=\{step\}/);
    expect(flow).toMatch(/swapDir=\{step === "other" \? 1 : -1\}/);
    expect(read("src/app/account/ProfileEditSheets.tsx")).toMatch(
      /cardMotion\(swapDir, reducedMotionNow\(\)\)/,
    );
  });

  it("a filter change applies at once and only brings the new cards in (#7)", () => {
    const view = read("src/components/results/ResultsView.tsx");
    expect(view).toMatch(
      /swap\(0, \(\) => onFiltersChange\(next, source\), "in"\)/,
    );
    expect(view).toMatch(/onChange=\{filterChange \?\? onFiltersChange\}/);
    expect(view).toMatch(/filterChange\?\.\(next, "no_match"\)/);
  });

  it("the F23 loader handoff is untouched: only the error screens get a fade (#12)", () => {
    const results = css("src/components/results/results.css");
    const handoff = results.slice(
      results.indexOf(".results-page-handoff {"),
      results.indexOf(".results-page-handoff .results-page-handoffLoader {"),
    );
    expect(handoff).not.toMatch(/animation|transition/);
    expect(results).toMatch(
      /\.results-page-error \{\s*animation: motion-fade-in var\(--motion-base\) var\(--ease-out\);/,
    );
  });
});
