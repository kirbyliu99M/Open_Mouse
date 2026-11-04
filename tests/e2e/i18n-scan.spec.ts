import { expect, test, type Page } from "@playwright/test";
import { LOCALE_COOKIE } from "../../src/lib/contracts/locale";
import {
  en as commonEn,
  zhTW as commonZh,
} from "../../src/lib/copy/scan-common";
import { en as easyEn, zhTW as easyZh } from "../../src/lib/copy/easy-scan";
import { zhTW as sheetZh } from "../../src/lib/copy/scan-sheet";
import { en as tourEn, zhTW as tourZh } from "../../src/lib/copy/scan-tour";

/**
 * The scan flow follows the visitor's locale (cookie `om_locale`), with
 * English as the negative control. The phone's live cue is read from the
 * fake camera project, the rest from the static and demo routes.
 */

const CJK = /[㐀-鿿]/;
const CUE = "[data-testid='camera-cue']";

async function setLocale(page: Page, value: "zh-TW" | "en") {
  await page.context().addCookies([
    {
      name: LOCALE_COOKIE,
      value,
      url: `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? 3100}`,
    },
  ]);
}

async function htmlLang(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.lang);
}

test.describe("desktop entry of the easy scan", () => {
  test("zh-TW: words, lang, and an upload button", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium");
    await setLocale(page, "zh-TW");
    await page.goto("/scan/easy");
    expect(await htmlLang(page)).toBe("zh-TW");
    await expect(
      page.getByRole("heading", { name: easyZh.device.desktopTitle }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: easyZh.device.copyLink }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: easyZh.device.uploadPhoto }),
    ).toBeVisible();
    await expect(page.getByText(commonZh.privacyDevice)).toBeVisible();
    await expect(page).toHaveTitle(new RegExp(easyZh.metaTitle));
  });

  test("en: unchanged (negative control)", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium");
    await setLocale(page, "en");
    await page.goto("/scan/easy");
    expect(await htmlLang(page)).toBe("en");
    await expect(
      page.getByRole("heading", { name: easyEn.device.desktopTitle }),
    ).toBeVisible();
    await expect(page.getByText(commonEn.privacyDevice)).toBeVisible();
    await expect(page.locator("main")).not.toContainText(CJK);
  });
});

test.describe("easy scan on a phone without a camera", () => {
  test("zh-TW: first-run tip, length step, and a failure sheet", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Uses the upload path.");
    await setLocale(page, "zh-TW");
    await page.goto("/scan/easy/length-failure-demo");
    expect(await htmlLang(page)).toBe("zh-TW");
    await expect(
      page.getByRole("heading", { name: easyZh.heading, includeHidden: true }),
    ).toBeAttached();
    // v3.4: the first-run screen is the tour's question (the paper tip is
    // gone); its words and the photo promise are in Chinese.
    const tour = page.getByRole("dialog", { name: tourZh.welcomeTitle });
    await expect(tour).toBeVisible();
    await expect(
      tour.getByRole("button", { name: tourZh.welcomeFirst }),
    ).toBeVisible();
    await expect(tour).toContainText(tourZh.welcomeFinePrint);
    await tour.getByRole("button", { name: tourZh.welcomeReturning }).click();
    await page.getByRole("button", { name: easyZh.noPaperEntry }).click();

    await expect(
      page.getByRole("heading", { name: easyZh.lengthHeading }),
    ).toBeVisible();
    await page.getByLabel(easyZh.lengthFieldLabel).fill("186");
    await page.getByRole("button", { name: easyZh.lengthContinue }).click();
    await page.locator("#easy-scan-upload").setInputFiles({
      name: "hand.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    });

    const sheet = page.getByRole("dialog", { name: commonZh.retakeNeeded });
    const message = sheet.locator(".easySheetErrorMessage");
    await expect(message).toHaveText(
      (
        await import("../../src/lib/copy/scan-issues")
      ).zhTW.measurementOutOfRangeTyped("186"),
    );
    await expect(
      sheet.getByRole("button", { name: commonZh.tryAgain }),
    ).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: easyZh.editHandLength }),
    ).toBeVisible();
  });

  test("zh-TW: a length out of range shows the range in Chinese", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Uses the upload path.");
    await setLocale(page, "zh-TW");
    await page.goto("/scan/easy/length-failure-demo");
    await page
      .getByRole("dialog", { name: tourZh.welcomeTitle })
      .getByRole("button", { name: tourZh.welcomeReturning })
      .click();
    await page.getByRole("button", { name: easyZh.noPaperEntry }).click();
    await page.getByLabel(easyZh.lengthFieldLabel).fill("5");
    await page.getByRole("button", { name: easyZh.lengthContinue }).click();
    await expect(page.locator("#easy-length-error")).toHaveText(
      /^請輸入 135 到 265/,
    );
  });

  test("en: the same flow stays English (negative control)", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Uses the upload path.");
    await setLocale(page, "en");
    await page.goto("/scan/easy/length-failure-demo");
    expect(await htmlLang(page)).toBe("en");
    const tour = page.getByRole("dialog", { name: tourEn.welcomeTitle });
    await expect(tour).toBeVisible();
    await expect(tour).not.toContainText(CJK);
  });
});

test.describe("/scan, the printed-sheet page", () => {
  test("zh-TW: headings, pickers, buttons", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile");
    await setLocale(page, "zh-TW");
    await page.goto("/scan");
    expect(await htmlLang(page)).toBe("zh-TW");
    await expect(
      page.getByRole("heading", { name: sheetZh.headingSheet }),
    ).toBeVisible();
    await expect(page.getByText(sheetZh.hintSheet)).toBeVisible();
    await expect(page.getByText(sheetZh.whichHand)).toBeVisible();
    await expect(
      page.getByRole("button", { name: commonZh.handLeft }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: commonZh.gripClaw }),
    ).toBeVisible();
    await expect(page.getByText(commonZh.privacyPhone)).toBeVisible();
    await expect(
      page.getByRole("link", { name: sheetZh.printSheetLink }),
    ).toBeVisible();
    await expect(page).toHaveTitle(new RegExp(sheetZh.metaTitle));
  });

  test("en: unchanged (negative control)", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile");
    await setLocale(page, "en");
    await page.goto("/scan");
    await expect(
      page.getByRole("heading", { name: "Photograph your hand on the sheet" }),
    ).toBeVisible();
    await expect(page.locator("main")).not.toContainText(CJK);
  });
});

test.describe("the live camera, with the fake paper camera", () => {
  const ONLY = "chromium-camera-paper-edge";

  test("zh-TW: cue line, tip and shutter label in Chinese", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== ONLY, "Needs the fake camera.");
    await setLocale(page, "zh-TW");
    await page.goto("/scan/easy");
    expect(await htmlLang(page)).toBe("zh-TW");
    const tour = page.getByRole("dialog", { name: tourZh.welcomeTitle });
    await expect(tour).toBeVisible();
    await tour.getByRole("button", { name: tourZh.welcomeReturning }).click();
    await expect(
      page.getByRole("button", { name: commonZh.takePhoto }),
    ).toBeVisible();
    await expect(page.getByLabel(easyZh.showTip)).toBeVisible();
    const cue = page.locator(CUE);
    // Whatever the cue is at this instant (the shutter may fire by itself), it
    // is Chinese; none of the English cue words appear.
    await expect(cue).toHaveText(CJK, { timeout: 15_000 });
    await expect(cue).not.toHaveText(/[A-Za-z]{3,}/);
    // The chip shows the hand in Chinese too.
    await expect(page.locator(".easyScanTopRight .easyHandChip")).toHaveText(
      /右手/,
    );
  });

  test("en: the same screen stays English (negative control)", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== ONLY, "Needs the fake camera.");
    await setLocale(page, "en");
    await page.goto("/scan/easy");
    expect(await htmlLang(page)).toBe("en");
    await page
      .getByRole("dialog", { name: tourEn.welcomeTitle })
      .getByRole("button", { name: tourEn.welcomeReturning })
      .click();
    const cue = page.locator(CUE);
    await expect(cue).toHaveText(/[A-Za-z]{3,}/, { timeout: 15_000 });
    await expect(cue).not.toHaveText(CJK);
  });
});
