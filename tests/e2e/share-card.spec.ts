import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { decodePng } from "./fixtures/png";

/**
 * The share-card button, mounted on the dev-only /scan/share-card-demo (404 in
 * production, like the other demo routes). The results page does not carry the
 * button yet.
 */
const DEMO = "/scan/share-card-demo";

/** Chromium on Windows and Android can share files; make the browser say it cannot, so the download path runs. */
async function withoutWebShare(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(navigator, "share", {
      value: undefined,
      configurable: true,
    });
  });
}

function expectCard(buffer: Buffer) {
  const png = decodePng(buffer);
  expect(png.width).toBe(1080);
  expect(png.height).toBe(1920);
  const px = (x: number, y: number) => {
    const i = (y * png.width + x) * png.channels;
    return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!] as const;
  };
  // The page is the site's dark; the QR code is a white panel in the bottom-right corner.
  const [r, g, b] = px(10, 10);
  expect(r + g + b).toBeLessThan(120);
  let white = 0;
  let dark = 0;
  // The panel is 160 px, on the bottom-right margin (x 836 to 996, y 1676 to 1836).
  for (let y = 1680; y < 1832; y += 3) {
    for (let x = 840; x < 992; x += 3) {
      const [pr, pg, pb] = px(x, y);
      if (pr > 240 && pg > 240 && pb > 240) white += 1;
      else if (pr < 40 && pg < 40 && pb < 40) dark += 1;
    }
  }
  expect(white, "QR panel is mostly white").toBeGreaterThan(500);
  expect(dark, "QR modules are dark").toBeGreaterThan(300);
}

for (const query of [
  "?lang=zh",
  "?lang=zh&handType=0",
  "?lang=zh&photo=1",
  "?longName=1",
]) {
  test(`primary button downloads a 1080 x 1920 PNG (${query})`, async ({
    page,
  }) => {
    await withoutWebShare(page);
    await page.goto(`${DEMO}${query}`);
    const button = page.getByRole("button", {
      name: query.includes("zh") ? "製作我的分享圖" : "Make my share card",
    });
    await expect(button).toBeVisible();
    const download = page.waitForEvent("download");
    await button.click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(
      "palmate-logitech-g-pro-x-superlight-2.png",
    );
    const buffer = readFileSync(await file.path());
    expectCard(buffer);
    if (process.env.SHARE_CARD_OUT)
      await file.saveAs(
        `${process.env.SHARE_CARD_OUT}/card${query.replace(/[^a-z0-9]/gi, "_")}.png`,
      );
    // The button is usable again and no error is shown.
    await expect(page.locator(".shareCard-error")).toHaveCount(0);
    await expect(button).toHaveAttribute("aria-busy", "false");
  });
}

test("the card loads back as an image of the same size", async ({ page }) => {
  await withoutWebShare(page);
  await page.goto(`${DEMO}?lang=zh`);
  const download = page.waitForEvent("download");
  await page.getByTestId("share-card-button").last().click();
  const buffer = readFileSync(await (await download).path());
  const size = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    return [img.naturalWidth, img.naturalHeight];
  }, buffer.toString("base64"));
  expect(size).toEqual([1080, 1920]);
});

test("works from the keyboard and shows a focus ring", async ({ page }) => {
  await withoutWebShare(page);
  await page.goto(`${DEMO}?lang=zh`);
  const link = page.getByRole("button", { name: "分享", exact: true });
  await link.focus();
  const outline = await link.evaluate(
    (el) => getComputedStyle(el).outlineStyle,
  );
  expect(outline).not.toBe("none");
  const download = page.waitForEvent("download");
  await page.keyboard.press("Enter");
  expect((await download).suggestedFilename()).toMatch(/^palmate-.*\.png$/);
});

test("shares the file when the browser can, and a cancelled share is not an error", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __shared: File[][]; __abort: boolean };
    w.__shared = [];
    w.__abort = false;
    Object.defineProperty(navigator, "canShare", {
      value: (data?: ShareData) => Boolean(data?.files?.length),
      configurable: true,
    });
    Object.defineProperty(navigator, "share", {
      value: async (data?: ShareData) => {
        w.__shared.push([...(data?.files ?? [])]);
        if (w.__abort) throw new DOMException("cancelled", "AbortError");
      },
      configurable: true,
    });
  });
  let downloads = 0;
  page.on("download", () => (downloads += 1));
  await page.goto(`${DEMO}?lang=zh`);
  const primary = page.getByRole("button", { name: "製作我的分享圖" });

  await primary.click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as never as { __shared: unknown[] }).__shared.length,
      ),
    )
    .toBe(1);
  const shared = await page.evaluate(() => {
    const f = (window as never as { __shared: File[][] }).__shared[0]![0]!;
    return { name: f.name, type: f.type, size: f.size };
  });
  expect(shared.type).toBe("image/png");
  expect(shared.name).toMatch(/^palmate-.*\.png$/);
  expect(shared.size).toBeGreaterThan(5000);
  expect(downloads).toBe(0);

  await page.evaluate(() => {
    (window as never as { __abort: boolean }).__abort = true;
  });
  await primary.click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as never as { __shared: unknown[] }).__shared.length,
      ),
    )
    .toBe(2);
  await expect(primary).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".shareCard-error")).toHaveCount(0);
  expect(downloads).toBe(0);
});
