import { devices, expect, test } from "@playwright/test";

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

// ── The measured numbers say they are not verified yet ────────────────────

test("the easy-scan measured sheet says the numbers are not yet verified, next to them", async ({
  page,
}) => {
  await page.goto("/scan/easy/measured-demo");
  const sheet = page.getByRole("dialog", { name: "Hand measured" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".easySheetNote")).toHaveText(
    "Not yet verified against a ruler.",
  );
  // The numbers are unchanged.
  await expect(page.getByText("Hand 190 mm")).toBeVisible();
  await expect(page.getByText("Palm 84 mm")).toBeVisible();
});

test("the printed-sheet scan page says it too, between the numbers and their caption", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium");
  await page.goto("/scan/measured-demo");
  const note = page.getByTestId("scan-unverified-note");
  await expect(note).toHaveText("Not yet verified against a ruler.");
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
});
