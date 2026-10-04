import { devices, expect, test } from "@playwright/test";
import { contrast } from "./fixtures/contrast";
import { installLoopFreeze, loopFrozen } from "./fixtures/freeze-loop";

// ── Page titles: each page names itself; the template adds the site ────────

const TITLES: readonly (readonly [string, string])[] = [
  ["/", "Open_Mouse"],
  ["/scan/easy", "Scan your hand · Open_Mouse"],
  ["/scan", "Scan on a printed sheet · Open_Mouse"],
  ["/sheet", "Calibration sheet · Open_Mouse"],
  ["/how-it-works", "How it works · Open_Mouse"],
  ["/account", "Account · Open_Mouse"],
  [
    "/results/a1b2c3d4-1111-4a2b-8c3d-9e0f1a2b3c4d",
    "Your results · Open_Mouse",
  ],
  ["/results/demo", "Results (mock data) · Open_Mouse"],
];

// One test per page: the dev server compiles a route on its first visit, so
// eight visits in one test can outlast the test timeout on a cold start.
for (const [path, title] of TITLES) {
  test(`${path} is titled "${title}"`, async ({ page }, info) => {
    test.skip(info.project.name !== "chromium");
    await page.goto(path, { timeout: 60_000 });
    expect(await page.title()).toBe(title);
  });
}

// ── /scan/easy: a main landmark and one h1 in every state ─────────────────

test("the scan screen is a <main> with one heading before scripts run", async ({
  browser,
}, info) => {
  test.skip(info.project.name !== "chromium");
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/scan/easy");
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Scan your hand",
  );
  await context.close();
});

test("the desktop entry is a <main> with one heading", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium");
  await page.goto("/scan/easy");
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Scan with your phone",
  );
});

test("the camera screen is the <main>, with a visually hidden h1, and the hand-length step is an h2 under it", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "Runs in the mobile project.");
  await page.goto("/scan/easy");
  await expect(
    page.getByRole("dialog", { name: "One blank sheet is all you need" }),
  ).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.locator("main.cameraViewfinder")).toHaveCount(1);
  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1).toHaveText("Scan your hand");
  // Hidden from the eye, not from assistive technology.
  const box = await h1.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(1);
  // The full-screen shell must not pick up the global `main` margins.
  const { top, width } = await page
    .locator("main.cameraViewfinder")
    .evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { top: rect.top, width: rect.width };
    });
  expect(top).toBe(0);
  expect(width).toBe(page.viewportSize()!.width);

  // Until the page has hydrated the tip is not modal yet, so the link behind
  // it is still reachable and there are two such buttons. Wait for the modal
  // (one button left), which is also when the click handler is attached.
  const noPaper = page.getByRole("button", {
    name: "No paper? Use a ruler instead",
  });
  await expect(noPaper).toHaveCount(1);
  await noPaper.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(
    page.getByRole("heading", { level: 2, name: "Hand length" }),
  ).toBeVisible();
});

// ── The upload control's name matches what is written on it ───────────────

async function uploadNames(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const input =
      document.querySelector<HTMLInputElement>("#easy-scan-upload")!;
    const labels = [
      ...document.querySelectorAll<HTMLLabelElement>(
        "label[for=easy-scan-upload]",
      ),
    ];
    return {
      name: input.getAttribute("aria-label"),
      labels: labels.map((label) => ({
        text: (label.textContent ?? "").trim(),
        ariaLabel: label.getAttribute("aria-label"),
      })),
    };
  });
}

test("with a camera, the upload icon is named by hidden text and the input's name contains it", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-camera-paper-edge");
  await page.goto("/scan/easy");
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.locator(".cameraFrame")).toBeVisible();
  const { name, labels } = await uploadNames(page);
  expect(labels).toHaveLength(1);
  // A <label> may not carry aria-label (axe: aria-prohibited-attr).
  expect(labels[0].ariaLabel).toBeNull();
  expect(labels[0].text).toBe("Upload a photo instead");
  expect(name).toBe("Upload a photo instead");
});

test("with no camera to open, the visible label says 'Upload a photo' and so does the input", async ({
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
  const { name, labels } = await uploadNames(page);
  expect(labels.map((l) => l.text)).toEqual(["Upload a photo"]);
  expect(name).toBe("Upload a photo");
  await context.close();
});

test("when the camera is refused, the visible label and the input's name agree", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "Runs in the mobile project.");
  await page.goto("/scan/easy");
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.locator(".cameraErrorCard")).toBeVisible();
  const { name, labels } = await uploadNames(page);
  expect(labels.map((l) => l.text)).toEqual(["Upload a photo instead"]);
  expect(name).toBe("Upload a photo instead");
  // Label in name: the words on screen are in the accessible name.
  for (const label of labels)
    expect(name!.toLowerCase()).toContain(label.text.toLowerCase());
});

// ── The hidden file input's keyboard focus shows on the label you can see ──
// (WCAG 2.4.7). The input is visually hidden and comes after its labels, so
// the ring has to be drawn on the label.

async function tabToUpload(page: import("@playwright/test").Page) {
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    if (
      await page.evaluate(
        () => document.activeElement?.id === "easy-scan-upload",
      )
    )
      return;
  }
  throw new Error("Tab never reached the upload input");
}

async function focusRing(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const input =
      document.querySelector<HTMLInputElement>("#easy-scan-upload")!;
    const label = document.querySelector<HTMLLabelElement>(
      "label[for=easy-scan-upload]",
    )!;
    const style = getComputedStyle(label);
    return {
      focusVisible: input.matches(":focus-visible"),
      outlineStyle: style.outlineStyle,
      outlineWidth: parseFloat(style.outlineWidth),
      outlineColor: style.outlineColor,
      shell: getComputedStyle(document.querySelector("main.easyScanShell")!)
        .backgroundColor,
    };
  });
}

// One dark theme since Home v3: the light iteration is gone.
for (const colorScheme of ["dark"] as const) {
  test(`Tab to the upload input shows a ring on the visible "Upload a photo instead" label (camera refused, ${colorScheme})`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "mobile", "Runs in the mobile project.");
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.goto("/scan/easy");
    await page.getByRole("button", { name: "Got it" }).click();
    await expect(page.locator(".cameraErrorCard")).toBeVisible();
    await tabToUpload(page);
    const ring = await focusRing(page);
    expect(ring.focusVisible).toBe(true);
    expect(ring.outlineStyle).toBe("solid");
    expect(ring.outlineWidth).toBeGreaterThanOrEqual(2);
    // Non-text contrast (WCAG 1.4.11): the ring against the screen behind it.
    expect(contrast(ring.outlineColor, ring.shell)).toBeGreaterThanOrEqual(3);
  });

  test(`Tab to the upload input shows a ring on the "Upload a photo" label when there is no camera (${colorScheme})`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "mobile", "Runs in the mobile project.");
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "mediaDevices", { value: undefined });
    });
    await page.goto("/scan/easy");
    await page.getByRole("button", { name: "Got it" }).click();
    await expect(page.locator(".easyScanNoCamera")).toBeVisible();
    await tabToUpload(page);
    const ring = await focusRing(page);
    expect(ring.focusVisible).toBe(true);
    expect(ring.outlineStyle).toBe("solid");
    expect(ring.outlineWidth).toBeGreaterThanOrEqual(2);
    expect(contrast(ring.outlineColor, ring.shell)).toBeGreaterThanOrEqual(3);
  });
}

test("Tab to the upload input shows a ring on the upload icon next to a live camera", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-camera-paper-edge");
  // This test is about the focus ring, not the shutter. The ring fills as soon
  // as the sheet is found (one noisy sample no longer restarts it), so the
  // auto-shutter fires about a second after the tip closes. Run with the loop
  // alive, this test passed 13 of 13 times on a warm dev server, but failed
  // once on a cold one (slow keyboard, 10.7 s run: the shutter had already
  // fired and the upload icon was gone). Stubbing `requestAnimationFrame`
  // after waiting for an element is the same race the axe live-camera tests
  // lost on CI: the loop gets frames in between. So the loop is stopped in the
  // page, in the same tick in which the picture starts playing, as they do
  // (fixtures/freeze-loop.ts).
  await installLoopFreeze(page, {
    selector: "video.cameraVideo.ready",
    count: 1,
  });
  await page.goto("/scan/easy");
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.locator(".cameraFrame")).toBeVisible();
  await expect(page.locator("video.cameraVideo.ready")).toBeVisible({
    timeout: 20_000,
  });
  await loopFrozen(page);
  await expect(page.locator(".cameraCue")).toBeVisible();
  await tabToUpload(page);
  const ring = await focusRing(page);
  expect(ring.focusVisible).toBe(true);
  expect(ring.outlineStyle).toBe("solid");
  expect(ring.outlineWidth).toBeGreaterThanOrEqual(2);
  expect(contrast(ring.outlineColor, ring.shell)).toBeGreaterThanOrEqual(3);
});

// ── The measured numbers say they are still being validated ───────────────

test("the easy-scan measured sheet says the measurements are still being validated, next to the numbers", async ({
  page,
}) => {
  await page.goto("/scan/easy/measured-demo");
  const sheet = page.getByRole("dialog", { name: "Hand measured" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".easySheetNote")).toHaveText(
    "Measurements are still being validated.",
  );
  // The drawing on the photo shows the numbers, but it is an image to a screen
  // reader, so the sheet says them in text too, and the note is the very next
  // thing after them.
  await expect(page.getByText("Hand 190 mm")).toBeVisible();
  await expect(page.getByText("Palm 84 mm")).toBeVisible();
  const numbers = sheet.getByTestId("easy-sheet-numbers");
  await expect(numbers).toHaveText("Hand length 190 mm · Palm width 84 mm");
  expect(await numbers.evaluate((el) => el.nextElementSibling?.className)).toBe(
    "easySheetNote",
  );
  // The words the drawing shows are in what the sheet says.
  const drawn = await page.evaluate(() =>
    [...document.querySelectorAll(".easyDimLabelText, .easyFrozenSvg text")]
      .map((t) => t.textContent ?? "")
      .filter(Boolean),
  );
  expect(drawn.join(" ")).toMatch(/190/);
  expect(drawn.join(" ")).toMatch(/84/);
});

test("a typed hand length is said to be entered, in the sheet's text and on the drawing", async ({
  page,
}) => {
  await page.goto("/scan/easy/measured-length-demo");
  const sheet = page.getByRole("dialog", { name: "Hand measured" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("easy-sheet-numbers")).toHaveText(
    "Hand length 186 mm (entered) · Palm width 80 mm",
  );
  await expect(sheet.locator(".easySheetNote")).toHaveText(
    "Measurements are still being validated.",
  );
  // The no-paper line says how it was measured and does not compare accuracy.
  await expect(sheet.locator(".easyLengthDisclosure p").last()).toHaveText(
    "Measured without paper.",
  );
  await expect(page.getByText("Entered 186 mm")).toBeVisible();
});

test("the printed-sheet scan page says it too, between the numbers and their caption", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium");
  await page.goto("/scan/measured-demo");
  const note = page.getByTestId("scan-unverified-note");
  await expect(note).toHaveText("Measurements are still being validated.");
  const order = await page.evaluate(() => {
    const list = document.querySelector("[data-testid=scan-measurements]")!;
    const note = document.querySelector("[data-testid=scan-unverified-note]")!;
    const caption = document.querySelector(".feedbackCaption")!;
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return {
      afterNumbers: follows(list, note),
      beforeCaption: follows(note, caption),
    };
  });
  expect(order).toEqual({ afterNumbers: true, beforeCaption: true });
  // Their own margins apply: `.feedback p` used to win over both classes.
  const margins = await page.evaluate(() => {
    const top = (selector: string) =>
      getComputedStyle(document.querySelector(selector)!).marginTop;
    const bottom = (selector: string) =>
      getComputedStyle(document.querySelector(selector)!).marginBottom;
    return {
      noteTop: top("[data-testid=scan-unverified-note]"),
      noteBottom: bottom("[data-testid=scan-unverified-note]"),
      captionTop: top(".feedbackCaption"),
      captionBottom: bottom(".feedbackCaption"),
    };
  });
  expect(margins).toEqual({
    noteTop: "8px",
    noteBottom: "0px",
    captionTop: "12px",
    captionBottom: "0px",
  });
});
