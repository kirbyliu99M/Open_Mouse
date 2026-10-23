import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// The cookie banner and GA4 need a measurement ID at build time, and the
// default e2e server has none (analytics-off.spec.ts relies on that), so this
// spec runs only when one is set:
//   NEXT_PUBLIC_GA_ID=G-TEST123456 PLAYWRIGHT_PORT=3217 npx playwright test cookie-consent
// Google is stubbed: gtag.js is answered with an empty script and every request
// to a Google host is recorded, so nothing leaves the machine.
test.skip(
  !process.env.NEXT_PUBLIC_GA_ID,
  "needs NEXT_PUBLIC_GA_ID at server start",
);

const UUID = "3f2b8c1e-5d4a-4e6f-9a0b-1c2d3e4f5a6b";

async function stubGoogle(page: Page): Promise<string[]> {
  const seen: string[] = [];
  await page.route(/(googletagmanager|google-analytics)\.com/, (route) => {
    seen.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: "",
    });
  });
  return seen;
}

/** The gtag() calls so far, as plain arrays. */
function dataLayer(page: Page): Promise<unknown[][]> {
  return page.evaluate(() =>
    (
      (window as unknown as { dataLayer?: ArrayLike<unknown>[] }).dataLayer ??
      []
    ).map((entry) => Array.from(entry)),
  );
}

test("nothing is requested from Google before a choice, and Decline keeps it that way", async ({
  page,
}) => {
  const seen = await stubGoogle(page);
  await page.goto("/");
  const banner = page.getByTestId("cookie-banner");
  await expect(banner).toBeVisible();
  await page.waitForTimeout(1500);
  expect(seen).toEqual([]);

  await banner.getByRole("button", { name: "Decline" }).click();
  await expect(banner).toBeHidden();
  await page.reload();
  await page.waitForTimeout(1500);
  await expect(banner).toBeHidden();
  expect(seen).toEqual([]);
  expect(await dataLayer(page)).toEqual([]);
});

test("Accept loads gtag with the ads signals denied and a redacted page_view, and survives a reload", async ({
  page,
}) => {
  const seen = await stubGoogle(page);
  await page.goto(`/results/${UUID}`);
  const banner = page.getByTestId("cookie-banner");
  await expect(banner).toBeVisible();
  expect(seen).toEqual([]);

  await banner.getByRole("button", { name: "Accept" }).click();
  await expect.poll(() => seen.length).toBeGreaterThan(0);
  expect(seen[0]).toContain("googletagmanager.com/gtag/js?id=");

  const calls = await dataLayer(page);
  const names = calls.map((c) => c.slice(0, 2).join(":"));
  expect(names).toContain("consent:default");
  expect(names).toContain("config:" + process.env.NEXT_PUBLIC_GA_ID);
  const consent = calls.find((c) => c[0] === "consent" && c[1] === "default");
  expect(consent?.[2]).toMatchObject({
    analytics_storage: "granted",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  const config = calls.find((c) => c[0] === "config")?.[2] as Record<
    string,
    unknown
  >;
  expect(config).toMatchObject({
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  const pageView = calls.find((c) => c[0] === "event" && c[1] === "page_view");
  const location = (pageView?.[2] as { page_location: string }).page_location;
  expect(location).toMatch(/\/results\/\[scanId\]$/);
  // The real ID appears nowhere in anything handed to gtag.
  expect(JSON.stringify(calls)).not.toContain(UUID);

  // Reload: no banner, and GA4 loads again without asking.
  seen.length = 0;
  await page.reload();
  await expect(banner).toBeHidden();
  await expect.poll(() => seen.length).toBeGreaterThan(0);
});

test("Cookie settings in the footer reopens the banner; Decline then switches GA4 off and deletes its cookies", async ({
  page,
  context,
}) => {
  await stubGoogle(page);
  await page.goto("/");
  const banner = page.getByTestId("cookie-banner");
  await banner.getByRole("button", { name: "Accept" }).click();
  await expect(banner).toBeHidden();
  await expect
    .poll(async () => (await dataLayer(page)).length)
    .toBeGreaterThan(0);

  // Pretend gtag set its cookies.
  const host = new URL(page.url()).hostname;
  await context.addCookies([
    { name: "_ga", value: "x", domain: host, path: "/" },
    { name: "_ga_TEST123456", value: "x", domain: host, path: "/" },
  ]);

  await page
    .getByTestId("site-footer")
    .getByRole("button", { name: "Cookie settings" })
    .click();
  await expect(banner).toBeVisible();
  await expect(page.getByTestId("cookie-current")).toHaveText(
    "Current setting: accepted",
  );
  await banner.getByRole("button", { name: "Decline" }).click();
  await expect(banner).toBeHidden();

  await expect
    .poll(async () =>
      (await context.cookies()).filter((c) => c.name.startsWith("_ga")),
    )
    .toEqual([]);
  const calls = await dataLayer(page);
  const update = calls.filter((c) => c[0] === "consent" && c[1] === "update");
  expect(update.at(-1)?.[2]).toMatchObject({ analytics_storage: "denied" });
});

test("the cookie statement is in the banner and names what is not sent", async ({
  page,
}) => {
  await stubGoogle(page);
  await page.goto("/");
  const banner = page.getByTestId("cookie-banner");
  await banner.getByText("Details").click();
  await expect(banner).toContainText("No photos, hand measurements");
  await expect(banner).toContainText("_ga");
});

// axe cannot decide the banner's text colour: the bar is fixed over page
// content, and a paragraph that wraps has a different page element under each
// line, which axe reads as "partially overlaps other elements" (needs review,
// not a violation). The generic audit (a11y-axe.spec.ts) never sees the banner
// because the default e2e server has no GA ID, so this settles it here: axe may
// report nothing but that one open item, and the contrast is measured from the
// computed colours of every text element in the bar (the bar's own fill is
// opaque, so the page beneath never shows through the text).
test("the banner has no axe violations, and its text keeps 4.5:1 on the bar", async ({
  page,
}) => {
  await stubGoogle(page);
  await page.goto("/");
  const banner = page.getByTestId("cookie-banner");
  await banner.getByText("Details").click();
  await expect(banner).toContainText("No photos");

  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .include(".cookieBanner")
    .analyze();
  expect(result.violations).toEqual([]);
  for (const open of result.incomplete) {
    expect(open.id).toBe("color-contrast");
    for (const node of open.nodes) {
      expect(JSON.stringify(node.any)).toContain("elmPartiallyObscuring");
    }
  }

  const ratios = await page.evaluate(() => {
    const channels = (css: string) =>
      (css.match(/[\d.]+/g) ?? []).slice(0, 4).map(Number);
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const bar = document.querySelector(".cookieBanner")!;
    const fill = channels(getComputedStyle(bar).backgroundColor);
    const out: Array<{ text: string; ratio: number; alpha: number }> = [];
    for (const el of bar.querySelectorAll("p, summary, dt, dd, button")) {
      const own = [...el.childNodes].some(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
      );
      if (!own) continue;
      const c = channels(getComputedStyle(el).color);
      const alpha = c[3] ?? 1;
      const blended = c
        .slice(0, 3)
        .map((v, i) => alpha * v + (1 - alpha) * fill[i]!);
      const [a, b] = [lum(blended), lum(fill)];
      out.push({
        text: (el.textContent ?? "").slice(0, 24),
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        alpha: fill[3] ?? 1,
      });
    }
    return out;
  });
  expect(ratios.length).toBeGreaterThan(5);
  for (const r of ratios) {
    expect(r.alpha, "the bar's fill is opaque").toBe(1);
    expect(r.ratio, r.text).toBeGreaterThanOrEqual(4.5);
  }
});
