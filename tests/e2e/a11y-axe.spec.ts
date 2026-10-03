import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { contrast, overWhite } from "./fixtures/contrast";
import {
  LOAD_FAILED,
  MODEL_URL,
  openLengthFlow,
  pill,
  slowModel,
  uploadGreyPhoto,
} from "./fixtures/slow-model";

/**
 * WCAG 2.2 AA rules (and the A rules under them) on the main pages and on
 * every state of the scan screen that this work touches, in the light and the
 * dark theme.
 *
 * `@axe-core/playwright` is a devDependency (MPL-2.0, like the axe-core it
 * wraps; neither ships to users). Any rule that cannot be fixed is listed in
 * `DISABLED_RULES` for that one state, with the reason: never a whole page.
 *
 * Violations fail. What axe could not decide ("incomplete", needs review) is
 * not dropped either: every run attaches the full list, and each state must
 * name the rules it leaves open in `NEEDS_REVIEW`, with why and a check that
 * settles it here. A new open item fails until someone has looked at it.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** state -> rule id -> why it is off there. Empty on purpose. */
const DISABLED_RULES: Record<string, Record<string, string>> = {};

interface Review {
  /** Why axe cannot decide it. */
  readonly why: string;
  /** What settles it instead: fails if the claim stops being true. */
  readonly check: (page: Page) => Promise<void>;
  /**
   * axe leaves this open only in some environments (it depends on how the
   * system font wraps the text), so it is expected only where it is open. The
   * check runs either way.
   */
  readonly sometimes?: boolean;
}

/** The text sits on a translucent pill over a photo; axe cannot see the photo. */
const overPhotoPill =
  (textSelector: string, pillSelector: string) => async (page: Page) => {
    const s = await page.evaluate(
      ({ textSelector, pillSelector }) => {
        const textEl = document.querySelector(textSelector)!;
        const text = getComputedStyle(textEl);
        const back = getComputedStyle(document.querySelector(pillSelector)!);
        const svg = textEl instanceof SVGElement;
        return {
          fg: svg ? text.fill : text.color,
          bg: svg ? back.fill : back.backgroundColor,
          opacity: Number(back.opacity),
        };
      },
      { textSelector, pillSelector },
    );
    // Worst case: white photo pixels under the pill.
    expect(contrast(s.fg, overWhite(s.bg, s.opacity))).toBeGreaterThanOrEqual(
      4.5,
    );
  };

/**
 * The numbers on the measured sheet. They sit on the sheet's own opaque
 * background, but the sheet floats over the photo, and under it lie the photo's
 * drawn labels. axe works out the background from the elements stacked under
 * each line of text. With a font wide enough to wrap the numbers (the Linux
 * font CI renders with does, Windows' and phones' usually do not) the lines
 * sit over different things, a label's SVG rect under one and nothing under the
 * other, and axe gives up: "partially overlaps other elements". The labels are
 * hidden behind the sheet, so nothing is drawn under or over the text. The
 * check says so and measures the contrast against the sheet itself.
 */
const MEASURED_SHEET_REVIEW: Review = {
  sometimes: true,
  why: "The numbers sit on the sheet's own opaque background, but when a wide font wraps them axe finds different elements of the photo under each line and cannot tell which background applies.",
  check: async (page) => {
    const s = await page.evaluate(() => {
      const sheet = document.querySelector(".easySheet")!;
      const numbers = document.querySelector(".easySheetNumbers")!;
      const range = document.createRange();
      range.selectNodeContents(numbers);
      const lines = [...range.getClientRects()];
      const sheetBox = sheet.getBoundingClientRect();
      return {
        fg: getComputedStyle(numbers).color,
        bg: getComputedStyle(sheet).backgroundColor,
        lines: lines.length,
        // Nothing is drawn over a line of the text: it is the topmost thing there.
        onTop: lines.every(
          (line) =>
            document.elementFromPoint(
              line.left + line.width / 2,
              line.top + line.height / 2,
            ) === numbers,
        ),
        // And every line lies inside the sheet.
        inside: lines.every(
          (line) =>
            line.left >= sheetBox.left &&
            line.right <= sheetBox.right &&
            line.top >= sheetBox.top &&
            line.bottom <= sheetBox.bottom,
        ),
      };
    });
    expect(s.lines).toBeGreaterThan(0);
    expect(s.onTop).toBe(true);
    expect(s.inside).toBe(true);
    // The sheet is opaque, so what lies under it does not show through.
    expect(Number(s.bg.match(/[\d.]+/g)?.[3] ?? 1)).toBe(1);
    expect(contrast(s.fg, s.bg)).toBeGreaterThanOrEqual(4.5);
  },
};

/** state -> rule id -> the review. */
const NEEDS_REVIEW: Record<string, Record<string, Review>> = {
  "how it works": {
    "color-contrast": {
      why: "The badge on the illustration is white text on a 62% black pill over a photo: axe cannot see the photo.",
      check: overPhotoPill(".home-hero-badge", ".home-hero-badge"),
    },
  },
  "printed-sheet scan, measured": {
    "color-contrast": {
      why: "The measurement labels are SVG text on a dark pill drawn over the photo: axe cannot see the photo.",
      check: overPhotoPill(
        ".overlayMeasureLabelText",
        ".overlayMeasureLabelBg",
      ),
    },
  },
  "calibration sheet": {
    "color-contrast": {
      why: "The labels are SVG text laid over the sheet's own white page rectangle, which axe reads as an overlap.",
      check: async (page) => {
        const s = await page.evaluate(() => {
          const svg = document.querySelector(".printPage svg")!;
          return {
            fills: [...svg.querySelectorAll("text")].map(
              (t) => getComputedStyle(t).fill,
            ),
            page: getComputedStyle(svg.querySelector("rect")!).fill,
          };
        });
        expect(s.fills.length).toBeGreaterThan(0);
        for (const fill of s.fills)
          expect(contrast(fill, s.page)).toBeGreaterThanOrEqual(4.5);
      },
    },
  },
};

NEEDS_REVIEW["measured sheet"] = { "color-contrast": MEASURED_SHEET_REVIEW };
NEEDS_REVIEW["measured sheet, typed hand length"] = {
  "color-contrast": MEASURED_SHEET_REVIEW,
};

const LIVE_CAMERA_REVIEW: Record<string, Review> = {
  "video-caption": {
    why: "axe asks for captions on every <video>. This one is the live camera preview: muted, no audio track, nothing spoken to caption.",
    check: async (page) => {
      const s = await page.evaluate(() => {
        const video = document.querySelector("video.cameraVideo")!;
        const stream = (video as HTMLVideoElement).srcObject as MediaStream;
        return {
          muted: (video as HTMLVideoElement).muted,
          audioTracks: stream.getAudioTracks().length,
        };
      });
      expect(s).toEqual({ muted: true, audioTracks: 0 });
    },
  },
};
NEEDS_REVIEW["live camera"] = LIVE_CAMERA_REVIEW;
NEEDS_REVIEW["live camera, detector still loading"] = LIVE_CAMERA_REVIEW;

async function audit(page: Page, info: TestInfo, state: string) {
  const builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  const disabled = Object.keys(DISABLED_RULES[state] ?? {});
  if (disabled.length) builder.disableRules(disabled);
  const { violations, incomplete } = await builder.analyze();
  const open = incomplete.map((item) => ({
    rule: item.id,
    impact: item.impact,
    nodes: item.nodes.map(
      (n) =>
        `${n.target.join(" ")}: ${[...n.any, ...n.all, ...n.none]
          .map((check) => check.message)
          .join(" / ")}`,
    ),
  }));
  await info.attach(`axe-needs-review ${state}.json`, {
    body: JSON.stringify(open, null, 2),
    contentType: "application/json",
  });
  expect(
    violations.map((v) => ({
      rule: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary}`),
    })),
  ).toEqual([]);
  const reviews = NEEDS_REVIEW[state] ?? {};
  const openRules = open.map((item) => item.rule);
  const expected = Object.entries(reviews)
    .filter(([rule, review]) => !review.sometimes || openRules.includes(rule))
    .map(([rule]) => rule);
  expect(
    openRules.sort(),
    `needs review in "${state}" (add it to NEEDS_REVIEW, with why and a check, once looked at): ${JSON.stringify(open, null, 1)}`,
  ).toEqual(expected.sort());
  for (const review of Object.values(reviews)) await review.check(page);
}

const SCHEMES = ["light", "dark"] as const;

// ── Pages ───────────────────────────────────────────────────────────────────

const PAGES: readonly (readonly [string, string])[] = [
  ["/", "home"],
  ["/how-it-works", "how it works"],
  ["/account", "account"],
  ["/scan/easy", "scan entry (desktop)"],
  ["/scan/measured-demo", "printed-sheet scan, measured"],
  ["/results/demo", "results demo"],
  // The presentation view opens with the written-analysis card showing.
  [
    "/results/demo?presentation=1",
    "results demo, presentation view (written-analysis card)",
  ],
  ["/sheet", "calibration sheet"],
];

for (const [path, name] of PAGES) {
  for (const colorScheme of SCHEMES) {
    test(`${name} (${path}) has no WCAG 2.2 AA violations in ${colorScheme} mode`, async ({
      page,
    }, info) => {
      test.skip(info.project.name !== "chromium");
      // No transitions: a colour read mid-fade is neither theme's.
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.goto(path, { timeout: 60_000 });
      await expect(page.locator("main, [role=main]").first()).toBeVisible();
      if (path === "/scan/easy")
        await expect(page.locator(".easyDeviceEntry")).toBeVisible();
      if (path.startsWith("/results/demo"))
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if (path.includes("presentation"))
        await expect(page.locator(".results-analysis")).toBeVisible();
      if (path === "/scan/measured-demo")
        await expect(page.getByTestId("scan-unverified-note")).toBeVisible();
      await audit(page, info, name);
    });
  }
}

// ── The phone screens: they are the product, and they use the same rules ───

/** Opens the hand-length step from the first-run tip's "no paper" button. */
async function openLengthStep(page: Page) {
  await page.goto("/scan/easy");
  const noPaper = page.getByRole("button", {
    name: "No paper? Use a ruler instead",
  });
  // One button once the tip is modal (before that the link behind it counts).
  await expect(noPaper).toHaveCount(1);
  await noPaper.click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Hand length" }),
  ).toBeVisible();
}

const dismissTip = async (page: Page) => {
  await page.getByRole("button", { name: "Got it" }).click();
};

const MOBILE_STATES: readonly (readonly [
  string,
  (page: Page) => Promise<void>,
])[] = [
  [
    "camera screen, first-run tip open",
    async (page) => {
      await page.goto("/scan/easy");
      await expect(
        page.getByRole("dialog", { name: "One blank sheet is all you need" }),
      ).toBeVisible();
    },
  ],
  [
    "camera screen, camera refused",
    async (page) => {
      await page.goto("/scan/easy");
      await dismissTip(page);
      await expect(page.locator(".cameraErrorCard")).toBeVisible();
    },
  ],
  [
    "camera screen, no camera at all",
    async (page) => {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "mediaDevices", { value: undefined });
      });
      await page.goto("/scan/easy");
      await dismissTip(page);
      await expect(page.locator(".easyScanNoCamera")).toBeVisible();
    },
  ],
  ["hand-length step", openLengthStep],
  [
    "measured sheet",
    async (page) => {
      await page.goto("/scan/easy/measured-demo");
      await expect(
        page.getByRole("dialog", { name: "Hand measured" }),
      ).toBeVisible();
      await expect(page.getByTestId("easy-sheet-numbers")).toBeVisible();
    },
  ],
  [
    "measured sheet, typed hand length",
    async (page) => {
      await page.goto("/scan/easy/measured-length-demo");
      await expect(
        page.getByRole("dialog", { name: "Hand measured" }),
      ).toBeVisible();
      await expect(page.getByTestId("easy-sheet-numbers")).toContainText(
        "(entered)",
      );
    },
  ],
  [
    "detector loading (progress notice)",
    async (page) => {
      await slowModel(page, "gated");
      await page.goto("/scan/easy");
      await dismissTip(page);
      await expect(pill(page)).toBeVisible();
    },
  ],
  [
    "detector could not be loaded (notice with retry)",
    async (page) => {
      await page.route("**/mediapipe/models/hand_landmarker.task", (route) =>
        route.abort(),
      );
      await page.goto("/scan/easy");
      await dismissTip(page);
      await expect(pill(page)).toHaveAttribute("data-state", "failed", {
        timeout: 30_000,
      });
    },
  ],
  [
    "retake sheet, no hand in the photo",
    async (page) => {
      await openLengthFlow(page);
      await uploadGreyPhoto(page);
      await expect(
        page.getByRole("dialog", { name: "Retake needed" }),
      ).toContainText("couldn't find a hand", { timeout: 30_000 });
    },
  ],
  [
    "retake sheet, detector could not be loaded",
    async (page) => {
      await page.route(`**${MODEL_URL}`, (route) => route.abort());
      await openLengthFlow(page);
      await uploadGreyPhoto(page);
      await expect(
        page.getByRole("dialog", { name: "Retake needed" }),
      ).toContainText(LOAD_FAILED, { timeout: 30_000 });
    },
  ],
];

// Not reachable here, and why: a *measured* sheet from a real photo needs
// MediaPipe to find a hand, and no synthetic image makes it do that, so the
// measured sheet above is the demo route's fixed measurements (including the
// text of the numbers). The typed-length wording of that sheet is covered by
// tests/unit/measured-numbers.test.ts.

for (const [state, setup] of MOBILE_STATES) {
  for (const colorScheme of SCHEMES) {
    test(`phone: ${state} has no violations in ${colorScheme} mode`, async ({
      page,
    }, info) => {
      test.skip(info.project.name !== "mobile", "Runs in the mobile project.");
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await setup(page);
      await audit(page, info, state);
    });
  }
}

// ── The live camera: only a phone with a (fake) camera can show it ─────────

for (const colorScheme of SCHEMES) {
  for (const loading of [false, true]) {
    const state = loading
      ? "live camera, detector still loading"
      : "live camera";
    test(`phone: ${state} has no violations in ${colorScheme} mode`, async ({
      page,
    }, info) => {
      test.skip(
        info.project.name !== "chromium-camera-paper-edge",
        "Needs the fake camera project.",
      );
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      if (loading) await slowModel(page, "gated");
      await page.goto("/scan/easy");
      // Freeze the detection loop before it can start: it starts when the tip
      // closes, and once it finds the sheet the auto-shutter fires within about
      // a second and would replace the viewfinder under the audit. So the
      // freeze goes in the very task that closes the tip and the loop never
      // gets a frame, however slow the machine is. (Placed after the waits
      // below, it lost that race on CI: the shutter had already fired and the
      // audit saw the "Measuring your hand…" screen instead.) The green "hold
      // still" cue is checked on its own below, so it does not depend on
      // catching that moment.
      await page.getByRole("button", { name: "Got it" }).evaluate((button) => {
        window.requestAnimationFrame = () => 0;
        (button as HTMLElement).click();
      });
      await expect(page.locator(".cameraFrame")).toBeVisible();
      await expect(page.locator("video.cameraVideo")).toBeVisible();
      // The stream is attached a moment after the element shows.
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (document.querySelector("video.cameraVideo") as HTMLVideoElement)
                .srcObject !== null,
          ),
        )
        .toBe(true);
      if (loading) await expect(pill(page)).toBeVisible();
      await expect(page.locator(".cameraCue")).toBeVisible();
      await audit(page, info, state);
    });
  }
}

// The cue turns green when the sheet is found, and the auto-shutter follows
// within a second, so it is measured on a copy laid into the live screen
// rather than by catching that moment. (It was 3.29:1, #f0fff6 on #2f9e5c.)
for (const colorScheme of SCHEMES) {
  test(`phone: the green "hold still" cue of the live camera keeps 4.5:1 text contrast in ${colorScheme} mode`, async ({
    page,
  }, info) => {
    test.skip(
      info.project.name !== "chromium-camera-paper-edge",
      "Needs the fake camera project.",
    );
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.goto("/scan/easy");
    await dismissTip(page);
    await expect(page.locator(".cameraCue")).toBeVisible();
    const probe = await page.evaluate(() => {
      const cue = document.createElement("div");
      cue.className = "cameraCue perfect";
      cue.textContent = "Got it — hold still";
      document.querySelector(".cameraCueWrap")!.appendChild(cue);
      const style = getComputedStyle(cue);
      return { color: style.color, background: style.backgroundColor };
    });
    expect(contrast(probe.color, probe.background)).toBeGreaterThanOrEqual(4.5);
  });
}
