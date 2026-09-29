import { devices, expect, test, type Page } from "@playwright/test";
import { PHOTO_PRIVACY_COPY } from "../../src/components/privacy-copy";

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
  await expect(page.locator(".cameraCornerDot")).toHaveCount(0);
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

function contrast(fg: string, bg: string): number {
  const rgb = (c: string) =>
    (c.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => Number(v) / 255);
  const lum = ([r, g, b]: number[]) => {
    const f = (v: number) =>
      v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const [a, b] = [lum(rgb(fg)), lum(rgb(bg))].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

test("desktop entry fills the screen with no extra scroll, and shows the privacy promise", async ({
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
  await expect(page.getByText(PHOTO_PRIVACY_COPY)).toBeVisible();
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

test("the desktop entry follows dark mode, including the copy-link fallback box", async ({
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
  expect(styles.entry.background).toBe("rgb(22, 22, 23)");
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
  await page.getByRole("button", { name: "Back to camera" }).click();
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

// ── Contrast in both themes ────────────────────────────────────────────────

test("the length step is themed: focus ring, link, hint and button keep their contrast in light and dark", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-camera-paper-edge");
  await openLengthStepFromTip(page);
  for (const scheme of ["light", "dark"] as const) {
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

test("the tip's no-paper link and the measured sheet's precision note keep their contrast in dark mode", async ({
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
