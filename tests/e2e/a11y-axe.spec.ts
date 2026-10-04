import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { contrast, overWhite } from "./fixtures/contrast";
import {
  assertMeasured,
  measureOverPicture,
  scanForUnlisted,
} from "./fixtures/live-picture";
import { installLoopFreeze, loopFrozen } from "./fixtures/freeze-loop";
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
 * every state of the scan screen that this work touches, in the dark theme
 * (the site's only theme).
 *
 * `@axe-core/playwright` is a devDependency (MPL-2.0, like the axe-core it
 * wraps; neither ships to users). Any rule that cannot be fixed is listed in
 * `DISABLED_RULES` for that one state, with the reason: never a whole page.
 *
 * Violations fail. What axe could not decide ("incomplete", needs review) is
 * not dropped either: every run attaches the full list, and each state must
 * name the rules it leaves open in `NEEDS_REVIEW`, with why and a check that
 * settles it here. A new open item fails until someone has looked at it.
 * The other way round is tolerated only where a review says `mayResolve`: axe
 * may decide such a rule itself (and pass it) on a run where the thing that
 * made it undecidable is not there; or `sometimes`: axe leaves it open only
 * where the system font wraps the text a certain way, and its check runs
 * either way. Any other review that axe no longer needs fails, so the list
 * cannot go stale.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** state -> rule id -> why it is off there. Empty on purpose. */
const DISABLED_RULES: Record<string, Record<string, string>> = {};

interface Review {
  /** Why axe cannot decide it. */
  readonly why: string;
  /**
   * What settles it instead: fails if the claim stops being true. It is given
   * every node axe left open for this rule (its target selectors), so a
   * review can be a closed list and not just a rule name.
   */
  readonly check: (page: Page, targets: readonly string[]) => Promise<void>;
  /**
   * Axe may legitimately decide this rule itself on some runs (the picture it
   * could not see through is not there that time). Then it is not open, there
   * is nothing to review, and that is not a failure. Never set it to excuse a
   * rule that axe has simply stopped asking about.
   */
  readonly mayResolve?: true;
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
 * background. Since scan v2 the photo is moved up so that the paper, the hand
 * and the drawn labels lie above the sheet, so normally nothing of it is under
 * the text. Part of the drawing can still lie under the sheet on a short
 * screen, once the photo's scale has reached its floor of 0.4 (see the build
 * notes of scan v2). This review is the fallback for that and for a font wide
 * enough to wrap the numbers (the Linux font CI renders with does, Windows'
 * and phones' usually do not): the lines can then sit over different things,
 * a label's SVG rect under one and nothing under the other, and axe gives up:
 * "partially overlaps other elements". axe leaves it open only in such
 * environments, so it is `sometimes`. The check runs either way: it says that
 * nothing is drawn under or over the text and measures the contrast against
 * the sheet itself.
 */
const MEASURED_SHEET_REVIEW: Review = {
  sometimes: true,
  why: "The numbers sit on the sheet's own opaque background, and the photo is above the sheet. As a fallback for a font that wraps the numbers (or a short screen where part of the drawing is under the sheet), axe may find different elements under each line and cannot tell which background applies.",
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

/**
 * What may sit over the live picture (scan v2). Each is white text on a
 * translucent dark fill, and axe cannot see through the fill to the picture.
 *
 * This is a CLOSED list, and three things hold for it
 * (fixtures/live-picture.ts has the detail):
 *
 * 1. Axe's side (`overLivePicture`): every element axe leaves open for colour
 *    contrast must be on it (or inside one that is).
 * 2. Ours, on every audit of the live camera and whatever axe reports:
 *    every listed element that is on screen AND every visible descendant of it
 *    that carries text (an icon, a nested span, a ::before or ::after) is
 *    measured over the worst picture, a white one: its text colour with alpha,
 *    and the fill and opacity of it and each ancestor inside the screen. It must
 *    keep 4.5:1. If any of them uses a style the measure does not model (a
 *    filter, a blend mode, a background image, a text fill that is not the
 *    colour) the test fails and names it, unless it is allowed in
 *    ALLOWED_FEATURES with a reason.
 * 3. Ours again: a walk of everything visible in the screen that carries text
 *    or a fill finds nothing that is neither listed, inside a listed element,
 *    nor decoration (DECORATION: no text of its own). It does not depend on
 *    axe's colour-contrast rule, so it holds with that rule off.
 *
 * `required` ones are on the live screen whenever the camera is up, so they
 * must be found; the rest are there only with some configurations (the "no
 * paper" link behind the build flag, the detector's pill while the model
 * downloads, the hint while the ring fills), so they are measured when present
 * and never demanded.
 *
 * Only what occurs in the audited live states is listed: each entry below was
 * seen on screen in them (the tally is in the round 3 notes of the PR). The
 * hint line (.easyHint) is on the list because the freeze can land after the
 * ring has started to fill; it is also measured on its own, on a copy, by the
 * test below, because the audits only see it by chance.
 */
const OVER_LIVE_PICTURE: readonly { selector: string; required?: true }[] = [
  { selector: ".cameraCloseButton", required: true },
  { selector: ".easyHelpButton", required: true },
  { selector: ".cameraCue", required: true },
  { selector: ".easyHandChip", required: true },
  { selector: ".easyPaperToggle", required: true },
  { selector: ".easyUploadIconButton", required: true },
  { selector: ".easyNoPaperLink" },
  { selector: ".easyHint" },
  // The download progress pill (white on rgba(0,0,0,.6): 5.74:1 on a white
  // picture): axe names its line of text, and the pill itself carries the fill.
  { selector: ".easyDetectorProgress" },
  { selector: ".easyDetectorText" },
];
const LISTED = OVER_LIVE_PICTURE.map((item) => item.selector);
const REQUIRED = OVER_LIVE_PICTURE.filter((item) => item.required).map(
  (item) => item.selector,
);

/** Axe's side: what it left open must be on the closed list. */
const overLivePicture = async (_page: Page, targets: readonly string[]) => {
  const listed = (target: string) =>
    LISTED.some(
      (selector) =>
        target === selector ||
        target.startsWith(`${selector} `) ||
        target.startsWith(`${selector}>`),
    );
  expect(
    targets.filter((target) => !listed(target)),
    "elements axe could not check that are not on the reviewed list",
  ).toEqual([]);
};

/** Ours: measured directly, and nothing unlisted in the screen. Runs on every live-camera audit. */
const checkLivePicture = async (page: Page) => {
  assertMeasured(await measureOverPicture(page, LISTED), {
    required: REQUIRED,
  });
  expect(
    await scanForUnlisted(page, LISTED),
    "things in the camera screen that carry text or a fill and are not on the list",
  ).toEqual([]);
};

const LIVE_CAMERA_REVIEW: Record<string, Review> = {
  "color-contrast": {
    mayResolve: true,
    why: "The controls, the cue and the detector's progress pill are white text on a translucent black fill laid over the live picture: axe cannot see the picture. A closed list (OVER_LIVE_PICTURE): whatever axe leaves open must be on it, and every element on it that is on screen is measured directly, over a white picture, on every live-camera audit.",
    check: overLivePicture,
  },
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

/**
 * Reduced motion still cross-fades for 120 ms (scan v2), and axe cannot decide
 * a colour under a half-faded surface. Let every finite animation end before
 * auditing, so what is measured is the settled screen. (Endless ones, such as
 * the detector bar's slow pulse, are left running.)
 */
async function settleAnimations(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

async function audit(
  page: Page,
  info: TestInfo,
  state: string,
  /** Checks that run whatever axe decided, after its own. */
  always: readonly ((page: Page) => Promise<void>)[] = [],
) {
  await settleAnimations(page);
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
  const openRules = open.map((item) => item.rule).sort();
  // An open rule nobody has looked at fails...
  expect(
    openRules.filter((rule) => !(rule in reviews)),
    `needs review in "${state}" (add it to NEEDS_REVIEW, with why and a check, once looked at): ${JSON.stringify(open, null, 1)}`,
  ).toEqual([]);
  // ...and so does a review that axe no longer needs, unless axe may decide
  // that rule by itself (`mayResolve`: then it passed, there were no
  // violations above) or leaves it open only in some environments
  // (`sometimes`).
  const decidedByAxe = Object.keys(reviews).filter(
    (rule) => !openRules.includes(rule),
  );
  await info.attach(`axe-decided-itself ${state}.json`, {
    body: JSON.stringify(decidedByAxe),
    contentType: "application/json",
  });
  expect(
    decidedByAxe.filter(
      (rule) => !reviews[rule].mayResolve && !reviews[rule].sometimes,
    ),
    `reviewed in "${state}" but axe no longer leaves it open: remove the review`,
  ).toEqual([]);
  for (const [rule, review] of Object.entries(reviews)) {
    // A `sometimes` check runs either way. A `mayResolve` one has nothing to
    // look at once axe has decided the rule itself.
    if (decidedByAxe.includes(rule) && !review.sometimes) continue;
    const targets = incomplete
      .filter((item) => item.id === rule)
      .flatMap((item) => item.nodes.map((n) => n.target.join(" ")));
    await review.check(page, targets);
  }
  for (const check of always) await check(page);
}

// The site is one dark theme since Home v3 (Kirby, 2026-10-03): the light
// iteration only repeated the dark one under another name, so it is gone. What
// the system asks for is ignored on purpose (tests/e2e/home.spec.ts checks it).
const SCHEMES = ["dark"] as const;

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
      // The camera is asked for when the tip closes and refused a moment
      // later (this project has no camera). Until then the <video> of the
      // request is in the page and axe asks about its captions: one full run
      // audited in that moment. Audit after the answer, as the state intends.
      await expect(page.locator(".cameraErrorCard")).toBeVisible();
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
      await expect(page.locator(".cameraErrorCard")).toBeVisible();
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
      // Freeze the detection loop the moment the picture is playing: once the
      // sheet is found the auto-shutter fires within a second and would replace
      // the viewfinder under the audit. (The green "hold still" cue is checked
      // on its own below, so it does not depend on catching that moment.) Done
      // in the page, in the same tick, not by polling from here.
      await installLoopFreeze(page, {
        selector: "video.cameraVideo.ready",
        count: 1,
      });
      if (loading) await slowModel(page, "gated");
      await page.goto("/scan/easy");
      await dismissTip(page);
      await expect(page.locator(".cameraFrame")).toBeVisible();
      // The picture is transparent until the video is playing (it fades in
      // over 200 ms), and axe rightly sees no picture behind the controls
      // before that: it decides colour contrast itself, where with the picture
      // up it leaves it open. Every live state is audited with the picture up.
      await expect(page.locator("video.cameraVideo.ready")).toBeVisible({
        timeout: 20_000,
      });
      await loopFrozen(page);
      const stream = await page.evaluate(() => {
        const video =
          document.querySelector<HTMLVideoElement>("video.cameraVideo")!;
        return { attached: video.srcObject !== null, state: video.readyState };
      });
      expect(stream.attached).toBe(true);
      expect(stream.state).toBeGreaterThanOrEqual(2); // HAVE_CURRENT_DATA: a frame to show
      if (loading) await expect(pill(page)).toBeVisible();
      await expect(page.locator(".cameraCue")).toBeVisible();
      await audit(page, info, state, [checkLivePicture]);
    });
  }
}

/**
 * The cue turns green when the sheet is found, and the auto-shutter follows
 * within a second, and the hint appears only while the ring fills or the
 * picture is soft: the audits above see them only by chance. Each is measured
 * here instead, on a copy laid into the live screen with the loop held, by the
 * same measure as everything else over the picture (text colour with alpha,
 * fill and opacity of the element and of every ancestor, over white; and the
 * styles the measure does not model fail closed). (The cue was 3.29:1,
 * #f0fff6 on #2f9e5c.)
 */
async function measureProbe(
  page: Page,
  colorScheme: "light" | "dark",
  lay: (page: Page) => Promise<void>,
) {
  await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
  await installLoopFreeze(page, {
    selector: "video.cameraVideo.ready",
    count: 1,
  });
  await page.goto("/scan/easy");
  await dismissTip(page);
  await expect(page.locator("video.cameraVideo.ready")).toBeVisible({
    timeout: 20_000,
  });
  await loopFrozen(page);
  await expect(page.locator(".cameraCue")).toBeVisible();
  await lay(page);
  // Its own fade-in, and any other finite animation, must have ended.
  await settleAnimations(page);
  const measured = await measureOverPicture(page, ["[data-contrast-probe]"]);
  expect(
    measured.present["[data-contrast-probe]"],
    "the probe is on screen",
  ).toBe(1);
  assertMeasured(measured, { label: "probe over a white picture" });
}

for (const colorScheme of SCHEMES) {
  test(`phone: the green "hold still" cue of the live camera keeps 4.5:1 text contrast in ${colorScheme} mode`, async ({
    page,
  }, info) => {
    test.skip(
      info.project.name !== "chromium-camera-paper-edge",
      "Needs the fake camera project.",
    );
    await measureProbe(page, colorScheme, (page) =>
      page.evaluate(() => {
        const cue = document.createElement("div");
        cue.className = "cameraCue perfect";
        cue.setAttribute("data-contrast-probe", "perfect cue");
        cue.textContent = "Got it — hold still";
        document.querySelector(".cameraCueWrap")!.appendChild(cue);
      }),
    );
  });

  test(`phone: the hint line of the live camera keeps 4.5:1 text contrast over a white picture in ${colorScheme} mode`, async ({
    page,
  }, info) => {
    test.skip(
      info.project.name !== "chromium-camera-paper-edge",
      "Needs the fake camera project.",
    );
    await measureProbe(page, colorScheme, (page) =>
      page.evaluate(() => {
        const hint = document.createElement("p");
        hint.className = "easyHint";
        hint.setAttribute("data-contrast-probe", "hint");
        hint.textContent = "Hold still — taking the photo";
        document.querySelector(".easyBottomDock")!.prepend(hint);
      }),
    );
  });
}
