import { devices, expect, test, type Page } from "@playwright/test";
import { contrast } from "./fixtures/contrast";
import {
  PHOTO_PRIVACY_COPY,
  PHOTO_PRIVACY_COPY_THIS_DEVICE,
} from "../../src/components/privacy-copy";

const output = "docs/design/easy-scan-shell-2026-09-25/built";

test("desktop shows a QR code, the URL and upload path, with no request after load", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium");
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/scan/easy");
  const requestsAfterInitialLoad = requests.length;
  await expect(
    page.getByRole("heading", { name: "Scan with your phone" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("img", { name: "QR code for this scan page" })
      .locator("svg"),
  ).toBeVisible();
  expect(requests.slice(requestsAfterInitialLoad)).toEqual([]);
  await expect(page.getByText(page.url(), { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Or upload a photo" }),
  ).toBeVisible();
  if (process.env.SCREENSHOTS === "1")
    await page.screenshot({ path: `${output}/desktop-qr.png`, fullPage: true });
});

test("desktop displayed link omits query parameters and hash", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium");
  await page.goto("/scan/easy?source=private#camera");
  const canonicalUrl = new URL("/scan/easy", page.url()).toString();
  await expect(page.getByText(canonicalUrl, { exact: true })).toBeVisible();
  await expect(page.getByText(/source=private/)).toHaveCount(0);
  await expect(
    page
      .getByRole("img", { name: "QR code for this scan page" })
      .locator("svg"),
  ).toBeVisible();
});

test("LINE browser shows open-in-browser notice, copy link and upload", async ({
  browser,
}, info) => {
  test.skip(info.project.name !== "chromium");
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (iPhone) AppleWebKit/605 Mobile LINE/14.0",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("/scan/easy");
  await expect(
    page.getByRole("heading", {
      name: "Open in Safari or Chrome to use the camera",
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open in browser" }),
  ).toHaveAttribute("href", /openExternalBrowser=1/);
  await expect(
    page.getByRole("button", { name: "Or upload a photo" }),
  ).toBeVisible();
  if (process.env.SCREENSHOTS === "1")
    await page.screenshot({
      path: `${output}/in-app-notice.png`,
      fullPage: true,
    });
  await context.close();
});

test("copy link offers a selectable URL when Clipboard API is unavailable", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium");
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: undefined });
  });
  await page.goto("/scan/easy");
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(
    page.getByRole("textbox", { name: "Select link to copy" }),
  ).toHaveValue(page.url());
});

test("copy link announces success after the Clipboard API resolves", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium");
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async () => undefined },
    });
  });
  await page.goto("/scan/easy");
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByText("Link copied")).toBeVisible();
});

test("typed-length flow reaches hand detection gate with no requests after camera warm-up", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-camera-paper-edge");
  await page.goto("/scan/easy");
  await page.waitForResponse((res) =>
    res.url().includes("/mediapipe/models/hand_landmarker.task"),
  );
  await page.waitForLoadState("networkidle");
  await page
    .getByRole("dialog", { name: "One blank sheet is all you need" })
    .getByRole("button", { name: "No paper? Use a ruler instead" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Hand length" }),
  ).toBeVisible();
  if (process.env.SCREENSHOTS === "1")
    await page.screenshot({ path: `${output}/typed-length-step.png` });
  await page.getByLabel("Hand length (mm)").fill("186");
  const requests: string[] = [];
  page.on("request", (req) => {
    if (
      !req.url().startsWith("blob:") &&
      !/__nextjs_|__next_hmr|webpack-hmr/.test(req.url())
    )
      requests.push(req.url());
  });
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("camera-cue")).toContainText(
    "Hand flat, fingers together, phone straight above",
  );
  await expect(page.locator(".easyCorner")).toHaveCount(0);
  if (process.env.SCREENSHOTS === "1")
    await page.screenshot({ path: `${output}/no-paper-camera.png` });
  await page.waitForTimeout(1200);
  await expect(page.getByRole("button", { name: "Take photo" })).toBeVisible();
  await page.getByRole("button", { name: "Take photo" }).click();
  await expect(
    page.getByRole("dialog", { name: "Retake needed" }),
  ).toContainText("couldn't find a hand", { timeout: 20000 });
  // No paper in this photo, so its description must not promise paper corners.
  const frozenLabel = await page
    .locator("svg.easyFrozenSvg")
    .getAttribute("aria-label");
  expect(frozenLabel).toContain("hand-length");
  expect(frozenLabel).not.toContain("paper corners");
  expect(requests).toEqual([]);
});

// ── Device entry: layout, theme, accessibility, privacy promise ────────────

test("desktop entry fills the screen with no extra scroll, and shows the device-neutral privacy promise", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/scan/easy");
  await expect(
    page.getByRole("heading", { name: "Scan with your phone" }),
  ).toBeVisible();
  // The global `main { margin: 18vh auto }` used to add ~288px of scroll here.
  const { scrollHeight, innerHeight } = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
  }));
  expect(scrollHeight).toBeLessThanOrEqual(innerHeight);
  await expect(page.getByText(PHOTO_PRIVACY_COPY_THIS_DEVICE)).toBeVisible();
});

test("in-app browser entry shows the privacy promise too", async ({
  browser,
}, info) => {
  test.skip(info.project.name !== "chromium");
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (iPhone) AppleWebKit/605 Mobile LINE/14.0",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("/scan/easy");
  await expect(page.getByText(PHOTO_PRIVACY_COPY)).toBeVisible();
  await context.close();
});

test("the upload picker is not a second control: out of the tab order and hidden from assistive tech", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium");
  await page.goto("/scan/easy");
  const picker = page.locator("input[type=file]");
  await expect(picker).toHaveAttribute("tabindex", "-1");
  await expect(picker).toHaveAttribute("aria-hidden", "true");
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () => (document.activeElement as HTMLInputElement).type,
      ),
    ).not.toBe("file");
  }
});

test("the desktop entry is on the dark theme, including the copy-link fallback box", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: undefined });
  });
  await page.goto("/scan/easy");
  await page.getByRole("button", { name: "Copy link" }).click();
  const styles = await page.evaluate(() => {
    const read = (selector: string) => {
      const style = getComputedStyle(document.querySelector(selector)!);
      return { color: style.color, background: style.backgroundColor };
    };
    return {
      entry: read(".easyDeviceEntry"),
      box: read(".easySelectableUrl"),
      copy: read("button.easyCopyLink"),
    };
  });
  expect(styles.entry.background).toBe("rgb(6, 7, 9)"); // --bg
  expect(contrast(styles.entry.color, styles.entry.background)).toBeGreaterThan(
    7,
  );
  expect(contrast(styles.box.color, styles.box.background)).toBeGreaterThan(
    4.5,
  );
  expect(contrast(styles.copy.color, styles.copy.background)).toBeGreaterThan(
    4.5,
  );
});

test("before the device is known the page is a neutral placeholder, not the dark camera UI", async ({
  browser,
}, info) => {
  test.skip(info.project.name !== "chromium");
  // With scripts off, only the server-rendered first paint exists.
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/scan/easy");
  await expect(page.locator(".easyDevicePlaceholder")).toHaveCount(1);
  await expect(page.locator(".cameraViewfinder")).toHaveCount(0);
  await context.close();
});

// ── The typed hand-length step: focus, keyboard, exits, copy ───────────────

async function openLengthStepFromTip(page: Page) {
  await page.goto("/scan/easy");
  await page.waitForResponse((res) =>
    res.url().includes("/mediapipe/models/hand_landmarker.task"),
  );
  await page.waitForLoadState("networkidle");
  await page
    .getByRole("dialog", { name: "One blank sheet is all you need" })
    .getByRole("button", { name: "No paper? Use a ruler instead" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Hand length" }),
  ).toBeVisible();
}

test("the length step takes focus, keeps the covered top bar out of reach, submits on Enter and hands focus back", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-camera-paper-edge");
  await openLengthStepFromTip(page);
  await expect(
    page.getByRole("heading", { name: "Hand length" }),
  ).toBeFocused();
  await expect(page.locator(".cameraTopBar")).toHaveAttribute("inert", "");
  await expect(page.locator("#easy-scan-upload")).toHaveAttribute("inert", "");
  await expect(
    page.getByRole("button", { name: "Back to camera" }),
  ).toBeVisible();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      return `${el.className} ${el.id}`;
    });
    expect(focused).not.toMatch(
      /cameraCloseButton|easyHelpButton|easyHandChip|easy-scan-upload/,
    );
  }
  await page.getByLabel("Hand length (mm)").fill("186");
  await page.getByLabel("Hand length (mm)").press("Enter");
  await expect(page.getByTestId("camera-cue")).toContainText(
    "Hand flat, fingers together, phone straight above",
  );
  await expect(
    page.getByRole("button", { name: "Edit hand length" }),
  ).toBeFocused();
});

test("the length step names the same range it enforces", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-camera-paper-edge");
  await openLengthStepFromTip(page);
  const input = page.getByLabel("Hand length (mm)");
  await expect(input).toHaveAttribute("min", "135");
  await expect(input).toHaveAttribute("max", "265");
  await expect(page.locator("#easy-length-hint")).toContainText(
    "from 135 to 265",
  );
  for (const bad of ["100", "134", "266", "280"]) {
    await input.fill(bad);
    await input.press("Enter");
    await expect(page.locator("#easy-length-error")).toHaveText(
      "Enter a hand length between 135 and 265 mm.",
    );
  }
  await input.fill("135");
  await input.press("Enter");
  await expect(page.getByTestId("camera-cue")).toBeVisible();
});

test("a user in no-paper mode can go back to paper, and the tip stops talking about a sheet", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-camera-paper-edge");
  await openLengthStepFromTip(page);
  await page.getByLabel("Hand length (mm)").fill("186");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("186 mm entered")).toBeVisible();

  // The tip in no-paper mode.
  await page.getByRole("button", { name: "Show the first-run tip" }).click();
  const tip = page.getByRole("dialog", {
    name: "Your hand length is the ruler",
  });
  await expect(tip).toBeVisible();
  await expect(tip.locator(".easyTipList")).not.toContainText(
    /paper|sheet|A4|Letter/i,
  );
  await tip.getByRole("button", { name: "Got it" }).click();

  await page.getByRole("button", { name: "Use paper instead" }).click();
  await expect(page.getByText("186 mm entered")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^(A4|Letter)/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "No paper? Use a ruler instead" }),
  ).toBeVisible();
});

test("the live loop keeps one animation frame per tick in no-paper mode", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-camera-paper-edge");
  await page.addInitScript(() => {
    const w = window as Window & { __rafCalls?: number };
    w.__rafCalls = 0;
    const original = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      w.__rafCalls = (w.__rafCalls ?? 0) + 1;
      return original(callback);
    };
  });
  await openLengthStepFromTip(page);
  await page.getByLabel("Hand length (mm)").fill("186");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("camera-cue")).toBeVisible();
  const perSecond = async () => {
    const before = await page.evaluate(
      () => (window as Window & { __rafCalls?: number }).__rafCalls ?? 0,
    );
    await page.waitForTimeout(1000);
    const after = await page.evaluate(
      () => (window as Window & { __rafCalls?: number }).__rafCalls ?? 0,
    );
    return after - before;
  };
  await page.waitForTimeout(500);
  const early = await perSecond();
  await page.waitForTimeout(2500);
  const late = await perSecond();
  // One chain runs at the display rate. A chain added per sample (about 8 a
  // second) would multiply the rate within seconds.
  expect(late).toBeLessThan(early * 1.5 + 10);
  expect(late).toBeLessThan(150);
});

test("without a usable camera, the length step goes back to the upload screen, not a camera error", async ({
  browser,
}, info) => {
  test.skip(info.project.name !== "chromium");
  const context = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", { value: undefined });
  });
  await page.goto("/scan/easy");
  await page.getByRole("button", { name: "Got it" }).click();
  const paperCopy =
    "Upload a top-down photo of your hand on a blank sheet of paper.";
  await expect(page.getByText(paperCopy)).toBeVisible();

  await page
    .getByRole("button", { name: "No paper? Use a ruler instead" })
    .click();
  // No camera can open here, so Back does not promise one.
  await expect(
    page.getByRole("button", { name: "Back to camera" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Back to upload" }).click();
  await expect(page.getByText(paperCopy)).toBeVisible();
  await expect(page.getByText(/camera couldn.t be opened/i)).toHaveCount(0);
  await expect(page.getByText(/camera access was blocked/i)).toHaveCount(0);

  await page
    .getByRole("button", { name: "No paper? Use a ruler instead" })
    .click();
  await page.getByLabel("Hand length (mm)").fill("186");
  await page.getByRole("button", { name: "Continue" }).click();
  // No-paper copy on the fallback, with both exits.
  await expect(
    page.getByText(/flat on a plain surface, with your whole hand in view/),
  ).toBeVisible();
  await expect(page.getByText(paperCopy)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Edit hand length" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Use paper instead" }).click();
  await expect(page.getByText(paperCopy)).toBeVisible();
  await context.close();
});

// ── Contrast on the dark theme ─────────────────────────────────────────────

test("the length step is themed: focus ring, link, hint and button keep their contrast on the dark theme", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-camera-paper-edge");
  await openLengthStepFromTip(page);
  for (const scheme of ["dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const input = page.getByLabel("Hand length (mm)");
    await input.focus();
    const onInput = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement as HTMLElement);
      return { color: style.outlineColor, style: style.outlineStyle };
    });
    await page.keyboard.press("Tab");
    const onButton = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const style = getComputedStyle(el);
      return {
        label: el.textContent?.trim(),
        color: style.outlineColor,
        style: style.outlineStyle,
      };
    });
    expect(onButton.label).toBe("Continue");
    const colors = await page.evaluate(() => {
      const read = (selector: string) => {
        const style = getComputedStyle(document.querySelector(selector)!);
        return { color: style.color, background: style.backgroundColor };
      };
      return {
        page: read(".easyLengthStep"),
        back: read(".easyLengthBack"),
        hint: read("#easy-length-hint"),
        button: read(".easyLengthStep .primaryButton"),
        field: read("#easy-hand-length"),
      };
    });
    const pageBg = colors.page.background;
    // Focus ring against the page: the shell's white ring was 1.10:1 here.
    expect(onInput.style).not.toBe("none");
    expect(
      contrast(onInput.color, pageBg),
      `${scheme} input ring`,
    ).toBeGreaterThan(3);
    expect(onButton.style).not.toBe("none");
    expect(
      contrast(onButton.color, pageBg),
      `${scheme} button ring`,
    ).toBeGreaterThan(3);
    expect(
      contrast(colors.page.color, pageBg),
      `${scheme} text`,
    ).toBeGreaterThan(7);
    expect(
      contrast(colors.back.color, pageBg),
      `${scheme} back link`,
    ).toBeGreaterThan(4.5);
    expect(
      contrast(colors.hint.color, pageBg),
      `${scheme} hint`,
    ).toBeGreaterThan(4.5);
    expect(
      contrast(colors.button.color, colors.button.background),
      `${scheme} button text`,
    ).toBeGreaterThan(4.5);
    // The button against the page, not just its own text: a light-blue button
    // on a light page was the mixed-theme problem.
    expect(
      contrast(colors.button.background, pageBg),
      `${scheme} button shape`,
    ).toBeGreaterThan(3);
    expect(
      contrast(colors.field.color, colors.field.background),
      `${scheme} field`,
    ).toBeGreaterThan(7);
  }
});

test("the tip's no-paper link and the measured sheet's precision note keep their contrast on the dark theme", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-camera-paper-edge");
  await page.goto("/scan/easy");
  await page.waitForLoadState("networkidle");
  await page.emulateMedia({ colorScheme: "dark" });
  const tip = page.getByRole("dialog", {
    name: "One blank sheet is all you need",
  });
  await expect(tip).toBeVisible();
  const link = await page.evaluate(() => {
    const sheet = getComputedStyle(document.querySelector(".easyTipSheet")!);
    const el = getComputedStyle(document.querySelector(".easyTipNoPaper")!);
    return { color: el.color, background: sheet.backgroundColor };
  });
  expect(contrast(link.color, link.background)).toBeGreaterThan(4.5);
  // The precision note only shows on a measured no-paper sheet, which needs a
  // real hand photo; check its styling on the sheet it lives in.
  const note = await page.evaluate(() => {
    const sheet = document.querySelector(".easyTipSheet")!;
    const holder = document.createElement("div");
    holder.className = "easyLengthDisclosure";
    holder.innerHTML = "<p>Based on the hand length you entered</p>";
    sheet.appendChild(holder);
    // Read before removing: a computed style is live and empties on detach.
    const color = getComputedStyle(holder).color;
    const background = getComputedStyle(sheet).backgroundColor;
    holder.remove();
    return { color, background };
  });
  expect(contrast(note.color, note.background)).toBeGreaterThan(4.5);
});

// ── Round 3: placeholder, mode change, copy status, wording, labels ────────

const CAMERA_SHELL_BG = "rgb(18, 22, 28)";

test("the length field's placeholder keeps its contrast on the dark theme", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-camera-paper-edge");
  await openLengthStepFromTip(page);
  for (const scheme of ["dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const placeholder = await page.evaluate(() => {
      const input = document.querySelector("#easy-hand-length")!;
      const shown = getComputedStyle(input, "::placeholder");
      return {
        color: shown.color,
        opacity: shown.opacity,
        background: getComputedStyle(input).backgroundColor,
      };
    });
    expect(placeholder.opacity, `${scheme} placeholder opacity`).toBe("1");
    expect(
      contrast(placeholder.color, placeholder.background),
      `${scheme} placeholder`,
    ).toBeGreaterThan(4.5);
  }
});

test("switching back to paper moves focus to the entry and announces the mode; entering no-paper mode announces it too", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-camera-paper-edge");
  await openLengthStepFromTip(page);
  await page.getByLabel("Hand length (mm)").fill("186");
  await page.getByLabel("Hand length (mm)").press("Enter");
  await expect(page.getByTestId("camera-cue")).toBeVisible();
  const announcements = page.locator("[data-testid=mode-announcement]");
  await expect(announcements).toHaveAttribute("aria-live", "polite");
  await expect(announcements).toContainText("186 mm");

  await page.getByRole("button", { name: "Use paper instead" }).click();
  await expect(
    page.getByRole("button", { name: "No paper? Use a ruler instead" }),
  ).toBeFocused();
  // Not just any text with "paper mode" in it: the earlier no-paper message
  // contains that too, so pin the start of the new one.
  await expect(announcements).toHaveText(/^Paper mode:/);
  await expect(announcements).not.toContainText("186 mm");
});

test("copy link says what happened every time: copied, copied again, and failed", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium");
  await page.addInitScript(() => {
    let calls = 0;
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async () => {
          calls += 1;
          if (calls === 3) throw new Error("denied");
        },
      },
    });
  });
  await page.goto("/scan/easy");
  const status = page.getByRole("status");
  await expect(status).toHaveAttribute("aria-live", "polite");
  const copy = page.getByRole("button", { name: "Copy link" });

  await copy.click();
  await expect(status).toHaveText("Link copied");
  const first = await status.locator("span").elementHandle();

  // Copying again re-announces: the message is a new node, not the same text.
  await copy.click();
  await expect
    .poll(() => first!.evaluate((node) => node.isConnected))
    .toBe(false);
  await expect(status).toHaveText("Link copied");

  // A refused copy says so and points at the box that appears.
  await copy.click();
  await expect(status).toContainText("Couldn't copy");
  await expect(
    page.getByRole("textbox", { name: "Select link to copy" }),
  ).toBeVisible();
});

test("without the Clipboard API, copy link still says what to do", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium");
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: undefined });
  });
  await page.goto("/scan/easy");
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("status")).toContainText("Couldn't copy");
});

// --bg (src/app/tokens.css). The site is one dark theme since Home v3, so the
// loops below that used to run once per colour scheme now run once, with the
// scheme the system asks for left at "dark"; tests/e2e/home.spec.ts checks the
// page stays dark whatever the system asks.
const PAGE_BG = { dark: "rgb(6, 7, 9)" };

test("on a desktop the placeholder is the entry screen's own background, with no controls", async ({
  browser,
}, info) => {
  test.skip(info.project.name !== "chromium");
  for (const colorScheme of ["dark"] as const) {
    // Scripts off: only the server-rendered first paint exists.
    const bare = await browser.newContext({
      javaScriptEnabled: false,
      colorScheme,
    });
    const first = await bare.newPage();
    await first.goto("/scan/easy");
    const placeholder = first.locator(".easyDevicePlaceholder");
    await expect(placeholder).toHaveCount(1);
    const before = await placeholder.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    await expect(
      first.locator("button, a, input, select, textarea"),
    ).toHaveCount(0);
    await bare.close();

    // Scripts on: what replaces it.
    const full = await browser.newContext({ colorScheme });
    const second = await full.newPage();
    await second.goto("/scan/easy");
    const after = await second
      .locator(".easyDeviceEntry")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    await full.close();

    expect(before, `${colorScheme} placeholder`).toBe(PAGE_BG[colorScheme]);
    expect(after, `${colorScheme} entry`).toBe(before);
  }
});

test("on a touch device the placeholder is the camera shell's own dark, and the shell that replaces it is the same dark", async ({
  browser,
}, info) => {
  test.skip(info.project.name !== "chromium");
  for (const colorScheme of ["dark"] as const) {
    const bare = await browser.newContext({
      ...devices["Pixel 7"],
      javaScriptEnabled: false,
      colorScheme,
    });
    const first = await bare.newPage();
    await first.goto("/scan/easy");
    expect(
      await first
        .locator(".easyDevicePlaceholder")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      `${colorScheme} placeholder`,
    ).toBe(CAMERA_SHELL_BG);
    await expect(
      first.locator("button, a, input, select, textarea"),
    ).toHaveCount(0);
    await bare.close();

    const full = await browser.newContext({
      ...devices["Pixel 7"],
      colorScheme,
    });
    const second = await full.newPage();
    await second.goto("/scan/easy");
    await expect(second.locator(".cameraViewfinder")).toBeVisible();
    expect(
      await second
        .locator(".cameraViewfinder")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      `${colorScheme} shell`,
    ).toBe(CAMERA_SHELL_BG);
    await full.close();
  }
});

test("a mode announcement that repeats word for word is announced again", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-camera-paper-edge");
  await openLengthStepFromTip(page);
  await page.getByLabel("Hand length (mm)").fill("186");
  await page.getByLabel("Hand length (mm)").press("Enter");
  const announcements = page.locator("[data-testid=mode-announcement]");
  await expect(announcements).toContainText("186 mm");
  const first = await announcements.locator("span").elementHandle();
  const text = await announcements.innerText();

  // Same length entered again: the same words, so only a fresh node makes a
  // screen reader say them once more.
  await page.getByRole("button", { name: "Edit hand length" }).click();
  await page.getByLabel("Hand length (mm)").press("Enter");
  await expect(page.getByTestId("camera-cue")).toBeVisible();
  await expect
    .poll(() => first!.evaluate((node) => node.isConnected))
    .toBe(false);
  await expect(announcements).toHaveText(text);
});

test("the camera shell the placeholder hands over to is the same dark", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-camera-paper-edge");
  await page.goto("/scan/easy");
  await expect(page.locator(".cameraViewfinder")).toBeVisible();
  expect(
    await page
      .locator(".cameraViewfinder")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe(CAMERA_SHELL_BG);
});

test("desktop names no device in its privacy promise, and the in-app browser keeps the phone wording", async ({
  browser,
  page,
}, info) => {
  test.skip(info.project.name !== "chromium");
  await page.goto("/scan/easy");
  await expect(page.getByText(PHOTO_PRIVACY_COPY_THIS_DEVICE)).toBeVisible();
  await expect(page.getByText(PHOTO_PRIVACY_COPY)).toHaveCount(0);

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (iPhone) AppleWebKit/605 Mobile LINE/14.0",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const inApp = await context.newPage();
  await inApp.goto("/scan/easy");
  await expect(inApp.getByText(PHOTO_PRIVACY_COPY)).toBeVisible();
  await expect(inApp.getByText(PHOTO_PRIVACY_COPY_THIS_DEVICE)).toHaveCount(0);
  await context.close();
});

test("a palm that does not fit the typed length gets one instruction and a way to change the number", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "Uses the upload path.");
  await page.goto("/scan/easy/length-failure-demo");
  await page
    .getByRole("dialog", { name: "One blank sheet is all you need" })
    .getByRole("button", { name: "No paper? Use a ruler instead" })
    .click();
  await page.getByLabel("Hand length (mm)").fill("186");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator("#easy-scan-upload").setInputFiles({
    name: "hand.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  });

  const sheet = page.getByRole("dialog", { name: "Retake needed" });
  const message = sheet.locator(".easySheetErrorMessage");
  await expect(message).toContainText("186 mm you entered");
  // One instruction in the message; the retry and the edit are the buttons.
  await expect(message).not.toContainText(/retake|or /i);
  await expect(sheet.getByRole("button", { name: "Try again" })).toBeVisible();

  await sheet.getByRole("button", { name: "Edit hand length" }).click();
  await expect(
    page.getByRole("heading", { name: "Hand length" }),
  ).toBeFocused();
  await expect(page.getByLabel("Hand length (mm)")).toHaveValue("186");
});

test("other no-paper failures offer only Try again", async ({ page }, info) => {
  test.skip(info.project.name !== "chromium-camera-paper-edge");
  await openLengthStepFromTip(page);
  await page.getByLabel("Hand length (mm)").fill("186");
  await page.getByLabel("Hand length (mm)").press("Enter");
  await expect(page.getByTestId("camera-cue")).toBeVisible();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Take photo" }).click();
  const sheet = page.getByRole("dialog", { name: "Retake needed" });
  await expect(sheet).toContainText("couldn't find a hand", {
    timeout: 20000,
  });
  await expect(sheet.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(
    sheet.getByRole("button", { name: "Edit hand length" }),
  ).toHaveCount(0);
});

// ── The first paint follows the device, not just the pointer ──────────────

const LINE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Line/14.0";
const TABLET_DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

/** What the page shows before scripts run, and what replaces it. */
async function firstPaintThenScreen(
  browser: import("@playwright/test").Browser,
  options: import("@playwright/test").BrowserContextOptions,
  screen: ".easyDeviceEntry" | ".cameraViewfinder",
) {
  const bare = await browser.newContext({
    ...options,
    javaScriptEnabled: false,
  });
  const first = await bare.newPage();
  await first.goto("/scan/easy");
  const placeholder = first.locator(".easyDevicePlaceholder");
  const hint = await placeholder.getAttribute("data-device-hint");
  const before = await placeholder.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  await bare.close();

  const full = await browser.newContext(options);
  const second = await full.newPage();
  await second.goto("/scan/easy");
  await expect(second.locator(screen)).toBeVisible();
  const after = await second
    .locator(screen)
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  const fine = await second.evaluate(
    () => window.matchMedia("(pointer: fine)").matches,
  );
  await full.close();
  return { hint, before, after, fine };
}

test("an in-app browser on a touch screen keeps the entry screen's background from the first paint", async ({
  browser,
}, info) => {
  test.skip(info.project.name !== "chromium");
  for (const colorScheme of ["dark"] as const) {
    const paint = await firstPaintThenScreen(
      browser,
      {
        userAgent: LINE_UA,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        colorScheme,
      },
      ".easyDeviceEntry",
    );
    // The client tests the in-app user agent before the pointer, so the entry
    // screen replaces this; the pointer alone would have said "phone, dark".
    expect(paint.hint, colorScheme).toBe("in-app");
    expect(paint.before, `${colorScheme} first paint`).toBe(
      PAGE_BG[colorScheme],
    );
    expect(paint.after, `${colorScheme} entry`).toBe(paint.before);
  }
});

test("an Android phone with a mouse attached still gets the camera's dark from the first paint", async ({
  browser,
}, info) => {
  test.skip(info.project.name !== "chromium");
  for (const colorScheme of ["dark"] as const) {
    const paint = await firstPaintThenScreen(
      browser,
      {
        ...devices["Pixel 7"],
        hasTouch: false,
        isMobile: false,
        colorScheme,
      },
      ".cameraViewfinder",
    );
    expect(paint.fine, "the primary pointer is fine").toBe(true);
    expect(paint.hint, colorScheme).toBe("phone");
    expect(paint.before, `${colorScheme} first paint`).toBe(CAMERA_SHELL_BG);
    expect(paint.after, `${colorScheme} shell`).toBe(paint.before);
  }
});

test("a tablet asking for the desktop site gets the camera's dark from the first paint", async ({
  browser,
}, info) => {
  test.skip(info.project.name !== "chromium");
  for (const colorScheme of ["dark"] as const) {
    const paint = await firstPaintThenScreen(
      browser,
      {
        userAgent: TABLET_DESKTOP_UA,
        viewport: { width: 1024, height: 768 },
        hasTouch: true,
        colorScheme,
      },
      ".cameraViewfinder",
    );
    // The server can only read the user agent, which says desktop; the coarse
    // pointer is what the client goes by.
    expect(paint.hint, colorScheme).toBe("desktop");
    expect(paint.before, `${colorScheme} first paint`).toBe(CAMERA_SHELL_BG);
    expect(paint.after, `${colorScheme} shell`).toBe(paint.before);
  }
});

test("/scan/easy carries the same security headers as a page that is not rendered per request", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium");
  const scan = await page.goto("/scan/easy");
  const headers = scan!.headers();
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["content-security-policy"]).toContain("connect-src 'self'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toContain("camera=(self)");
  // Cache-Control is deliberately not asserted: the dev server sends
  // `no-store` for every route, so it would pass whatever the page does. That
  // the page is rendered per request is checked where it can be:
  // tests/unit/scan-easy-page.test.ts (the page reads the request headers) and
  // the `next build` route table (`ƒ`, dynamic).

  // The security headers do not come from the page, so a page that does not
  // read the user agent carries the same ones.
  const home = await page.goto("/");
  for (const name of [
    "content-security-policy",
    "x-content-type-options",
    "referrer-policy",
    "permissions-policy",
  ])
    expect(home!.headers()[name], name).toBe(headers[name]);
});

test("the server classifies the user agent for the first paint: desktop, phone, in-app", async ({
  browser,
}, info) => {
  test.skip(info.project.name !== "chromium");
  const cases = [
    [
      "desktop",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36",
    ],
    ["phone", devices["Pixel 7"].userAgent],
    ["in-app", LINE_UA],
  ] as const;
  for (const [hint, userAgent] of cases) {
    // Scripts off: the attribute is the server's, not the client's.
    const context = await browser.newContext({
      userAgent,
      javaScriptEnabled: false,
    });
    const page = await context.newPage();
    await page.goto("/scan/easy");
    await expect(page.locator(".easyDevicePlaceholder")).toHaveAttribute(
      "data-device-hint",
      hint,
    );
    await context.close();
  }
});
