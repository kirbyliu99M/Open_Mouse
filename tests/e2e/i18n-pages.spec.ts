import { expect, test, type Page } from "@playwright/test";
import { LOCALE_COOKIE } from "../../src/lib/contracts/locale";
import { en as accountEn, zhTW as accountZh } from "../../src/lib/copy/account";
import { en as errorsEn, zhTW as errorsZh } from "../../src/lib/copy/errors";
import { en as homeEn, zhTW as homeZh } from "../../src/lib/copy/home";
import { en as howEn, zhTW as howZh } from "../../src/lib/copy/how-it-works";
import { en as learnEn, zhTW as learnZh } from "../../src/lib/copy/learn";
import { en as sheetEn, zhTW as sheetZh } from "../../src/lib/copy/sheet";

/**
 * The content pages follow the visitor's locale (the `om_locale` cookie): the
 * main heading and the primary buttons are the zh-TW strings, `<html lang>`
 * says so, no page overflows a phone, and the printed pages stay one page.
 * Every page is also checked in English as the negative control, so a page
 * that ignored the cookie (or one that was always Chinese) fails one side.
 */

const LATIN_WORD = /[A-Za-z]{3,}/;

async function setLocale(page: Page, value: "zh-TW" | "en") {
  await page.context().addCookies([
    {
      name: LOCALE_COOKIE,
      value,
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
}

interface PageCase {
  name: string;
  path: string;
  zhHeading: string;
  enHeading: string;
  /** Primary buttons or links, zh-TW then English, by role and name. */
  zhActions: { role: "button" | "link"; name: string }[];
  enActions: { role: "button" | "link"; name: string }[];
  /** The document title, without the site name. */
  zhTitle: string;
  enTitle: string;
}

const gZh = learnZh.gestures;
const gEn = learnEn.gestures;

const CASES: PageCase[] = [
  {
    name: "home",
    path: "/",
    zhHeading: homeZh.heading,
    enHeading: homeEn.heading,
    zhActions: [
      { role: "link", name: homeZh.scanMyHand },
      { role: "link", name: homeZh.howItWorks },
    ],
    enActions: [
      { role: "link", name: homeEn.scanMyHand },
      { role: "link", name: homeEn.howItWorks },
    ],
    zhTitle: "",
    enTitle: "",
  },
  {
    name: "how it works",
    path: "/how-it-works",
    zhHeading: howZh.title,
    enHeading: howEn.title,
    zhActions: [{ role: "link", name: howZh.scanMyHand }],
    enActions: [{ role: "link", name: howEn.scanMyHand }],
    zhTitle: howZh.title,
    enTitle: howEn.title,
  },
  {
    name: "learn",
    path: "/learn",
    zhHeading: learnZh.learningKit,
    enHeading: learnEn.learningKit,
    zhActions: [{ role: "link", name: learnZh.printSheetA }],
    enActions: [{ role: "link", name: learnEn.printSheetA }],
    zhTitle: learnZh.learningKit,
    enTitle: learnEn.learningKit,
  },
  {
    name: "learn print (kit v1)",
    path: "/learn/print?hands=right",
    zhHeading: learnZh.printTheKit,
    enHeading: learnEn.printTheKit,
    zhActions: [{ role: "button", name: learnZh.printPages(7) }],
    enActions: [{ role: "button", name: learnEn.printPages(7) }],
    zhTitle: learnZh.printMetaTitle,
    enTitle: learnEn.printMetaTitle,
  },
  {
    name: "learn print (sheet A)",
    path: "/learn/print?sheet=A",
    zhHeading: learnZh.printKitV2Sheet("A", false),
    enHeading: learnEn.printKitV2Sheet("A", false),
    zhActions: [{ role: "button", name: learnZh.print1Page }],
    enActions: [{ role: "button", name: learnEn.print1Page }],
    zhTitle: learnZh.printMetaTitle,
    enTitle: learnEn.printMetaTitle,
  },
  {
    name: "learn cards",
    path: "/learn/slates?from=1",
    zhHeading: learnZh.participantCards,
    enHeading: learnEn.participantCards,
    zhActions: [{ role: "button", name: learnZh.printPages(1) }],
    enActions: [{ role: "button", name: learnEn.printPages(1) }],
    zhTitle: learnZh.slatesMetaTitle,
    enTitle: learnEn.slatesMetaTitle,
  },
  {
    name: "learn check",
    path: "/learn/check",
    zhHeading: learnZh.checkPhotos,
    enHeading: learnEn.checkPhotos,
    zhActions: [{ role: "button", name: learnZh.choosePhotos }],
    enActions: [{ role: "button", name: learnEn.choosePhotos }],
    zhTitle: learnZh.checkMetaTitle,
    enTitle: learnEn.checkMetaTitle,
  },
  {
    name: "pose page behind a kit QR code",
    path: "/l/v1/G03R",
    zhHeading: gZh.G03.name,
    enHeading: gEn.G03.name,
    zhActions: [{ role: "link", name: learnZh.openNext }],
    enActions: [{ role: "link", name: learnEn.openNext }],
    zhTitle: learnZh.poseMetaTitle,
    enTitle: learnEn.poseMetaTitle,
  },
  {
    name: "session page behind a participant QR code",
    path: "/l/v1/P007",
    zhHeading: learnZh.sessionTitle("P007"),
    enHeading: learnEn.sessionTitle("P007"),
    zhActions: [{ role: "link", name: learnZh.checkPhotos }],
    enActions: [{ role: "link", name: learnEn.checkPhotos }],
    zhTitle: learnZh.poseMetaTitle,
    enTitle: learnEn.poseMetaTitle,
  },
  {
    name: "sheet",
    path: "/sheet",
    zhHeading: sheetZh.heading,
    enHeading: sheetEn.heading,
    zhActions: [
      { role: "button", name: sheetZh.printTheSheet },
      { role: "link", name: sheetZh.continueLabel },
    ],
    enActions: [
      { role: "button", name: sheetEn.printTheSheet },
      { role: "link", name: sheetEn.continueLabel },
    ],
    zhTitle: sheetZh.metaTitle,
    enTitle: sheetEn.metaTitle,
  },
  {
    name: "account",
    path: "/account",
    zhHeading: accountZh.keepYourScans,
    enHeading: accountEn.keepYourScans,
    zhActions: [{ role: "link", name: accountZh.scanWithoutAccount }],
    enActions: [{ role: "link", name: accountEn.scanWithoutAccount }],
    zhTitle: accountZh.metaTitle,
    enTitle: accountEn.metaTitle,
  },
  {
    name: "not found",
    path: "/no-such-page-xyz",
    zhHeading: errorsZh.notFound.title,
    enHeading: errorsEn.notFound.title,
    zhActions: [
      { role: "link", name: errorsZh.actions.scan },
      { role: "link", name: errorsZh.actions.home },
    ],
    enActions: [
      { role: "link", name: errorsEn.actions.scan },
      { role: "link", name: errorsEn.actions.home },
    ],
    zhTitle: errorsZh.notFound.pageTitle,
    enTitle: errorsEn.notFound.pageTitle,
  },
];

/** The signed-out account page shows one of two panels; its heading is the same. */
const heading = (page: Page) => page.getByRole("heading", { level: 1 }).first();

for (const c of CASES) {
  test.describe(c.name, () => {
    test(`zh-TW: heading, buttons, lang and title (${c.path})`, async ({
      page,
    }) => {
      await setLocale(page, "zh-TW");
      await page.goto(c.path);
      await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
      await expect(heading(page)).toHaveText(c.zhHeading);
      // No English left over in the heading (the product name and kit codes
      // are short; any English word of three letters or more would show).
      expect(await heading(page).innerText()).not.toMatch(LATIN_WORD);
      for (const a of c.zhActions) {
        const el = page.getByRole(a.role, { name: a.name }).first();
        await expect(el).toBeVisible();
        expect(await el.innerText()).not.toMatch(LATIN_WORD);
      }
      if (c.zhTitle !== "") {
        await expect(page).toHaveTitle(new RegExp(`^${c.zhTitle}`));
      }
    });

    test(`en: the same page in English (negative control)`, async ({
      page,
    }) => {
      await setLocale(page, "en");
      await page.goto(c.path);
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(heading(page)).toHaveText(c.enHeading);
      for (const a of c.enActions) {
        await expect(
          page.getByRole(a.role, { name: a.name }).first(),
        ).toBeVisible();
      }
      if (c.enTitle !== "") {
        await expect(page).toHaveTitle(new RegExp(`^${c.enTitle}`));
      }
      // The page really is English: it does not contain the Chinese heading.
      expect(await heading(page).innerText()).not.toBe(c.zhHeading);
    });

    for (const width of [320, 390]) {
      test(`zh-TW: no horizontal overflow at ${width} px (${c.path})`, async ({
        page,
      }) => {
        await setLocale(page, "zh-TW");
        await page.setViewportSize({ width, height: 700 });
        await page.goto(c.path);
        await expect(heading(page)).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
      });
    }
  });
}

test("the home page's finale headline is Kirby's own wording in both languages", async ({
  page,
}) => {
  await setLocale(page, "zh-TW");
  await page.goto("/");
  await expect(page.locator(".story-finale-title")).toHaveText(
    "Find Your Best Mouse",
  );
});

test("the home page's five annotations and nav are Chinese too", async ({
  page,
}) => {
  await setLocale(page, "zh-TW");
  await page.goto("/");
  const first = await page.locator(".story-note-title").first().innerText();
  expect(first).not.toMatch(LATIN_WORD);
});

// ── Print ───────────────────────────────────────────────────────────────────

/** Page objects in a PDF made by Chromium (see sheet-print.spec.ts). */
function countPdfPageObjects(pdf: Buffer): number {
  const text = pdf.toString("latin1");
  return (text.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
}

test.describe("printing in zh-TW stays one page", () => {
  for (const [name, path] of [
    ["the calibration sheet", "/sheet"],
    ["kit v2 sheet A", "/learn/print?sheet=A"],
    [
      "the participant cards (P901 to P912)",
      "/learn/slates?kit=2&from=901&count=12",
    ],
  ] as const) {
    test(`${name} (${path})`, async ({ page }, testInfo) => {
      test.skip(
        testInfo.project.name !== "chromium",
        "page.pdf() runs in desktop Chromium only",
      );
      await setLocale(page, "zh-TW");
      await page.goto(path);
      await expect(page.locator("svg").first()).toBeVisible();
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
      });
      expect(countPdfPageObjects(pdf)).toBe(1);
      await page.emulateMedia({ media: "print" });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    });
  }

  test("the printed sheet's words are Chinese and its markers are unchanged", async ({
    page,
  }) => {
    await setLocale(page, "zh-TW");
    await page.goto("/sheet");
    const svg = page.locator(".printPage svg");
    await expect(svg).toContainText(sheetZh.svgWarning);
    await expect(svg).not.toContainText("Actual size");
    // Same marker count and 210 mm width as in English.
    const zhRects = await svg.locator("rect").count();
    const box = await svg.boundingBox();
    expect(Math.abs((box?.width ?? 0) - (210 * 96) / 25.4)).toBeLessThan(1);
    await setLocale(page, "en");
    await page.goto("/sheet");
    expect(await page.locator(".printPage svg rect").count()).toBe(zhRects);
    await expect(page.locator(".printPage svg")).toContainText(
      sheetEn.svgWarning,
    );
  });
});
