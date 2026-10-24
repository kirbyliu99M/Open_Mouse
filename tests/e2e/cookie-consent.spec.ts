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

  // Decline is not on the first view; it appears with the details.
  await expect(banner.getByRole("button", { name: "Decline" })).toHaveCount(0);
  await banner.getByRole("button", { name: "Details" }).click();
  await banner.getByRole("button", { name: "Decline" }).click();
  await expect(banner).toBeHidden();
  await page.reload();
  await page.waitForTimeout(1500);
  await expect(banner).toBeHidden();
  expect(seen).toEqual([]);
  expect(await dataLayer(page)).toEqual([]);
});

test("an answer slides the banner down and fades it before it is removed", async ({
  page,
}) => {
  await stubGoogle(page);
  await page.goto("/");
  const banner = page.getByTestId("cookie-banner");
  await expect(banner).toHaveAttribute("data-state", "open");
  await banner.getByRole("button", { name: "Accept" }).click();
  // Still in the page, leaving: same text, no longer answerable.
  await expect(banner).toHaveAttribute("data-state", "closing");
  await expect(banner).toHaveAttribute("inert", "");
  await expect(banner.getByTestId("cookie-current")).toHaveCount(0);
  // Part way through, it is neither in place nor gone.
  await expect
    .poll(async () =>
      banner.evaluate((el) => Number(getComputedStyle(el).opacity)),
    )
    .toBeLessThan(1);
  await expect(banner).toHaveCount(0);
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
  await banner.getByRole("button", { name: "Details" }).click();
  await expect(banner).toContainText("No photos, hand measurements");
  await expect(banner).toContainText("_ga");
});

// axe cannot decide the banner's text colour: the bar is fixed over page
// content, and a paragraph that wraps has a different page element under each
// line, which axe reads as "partially overlaps other elements"; and on a
// short screen the strip covers part of the page's own button ("partially
// obscured by another element"). Those are needs review, not violations. The generic audit (a11y-axe.spec.ts) never sees the banner
// because the default e2e server has no GA ID, so this settles it here: axe may
// report nothing but those open items, and the contrast is measured from the
// computed colours of every text element, worst case: the pane is translucent
// glass, so it is blended over a white page (the brightest there can be).
test("the banner has no axe violations, and its text keeps 4.5:1 even over a white page", async ({
  page,
}) => {
  await stubGoogle(page);
  await page.goto("/");
  const banner = page.getByTestId("cookie-banner");
  await banner.getByRole("button", { name: "Details" }).click();
  await expect(banner).toContainText("No photos");

  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .include(".cookieBanner")
    .analyze();
  expect(result.violations).toEqual([]);
  for (const open of result.incomplete) {
    expect(open.id).toBe("color-contrast");
    for (const node of open.nodes) {
      expect(JSON.stringify(node.any)).toMatch(
        /elmPartiallyObscur(ing|ed)|bgGradient/,
      );
    }
  }

  const glass = await page.evaluate(() => {
    const channels = (css: string) => {
      const n = (css.match(/[\d.]+(?:e-?\d+)?/g) ?? []).map(Number);
      // color-mix() comes back as color(srgb r g b / a), channels 0..1.
      return css.startsWith("color(")
        ? [n[0]! * 255, n[1]! * 255, n[2]! * 255, n[3] ?? 1]
        : n.slice(0, 4);
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const over = (top: number[], alpha: number, below: number[]) =>
      below.map((v, i) => alpha * top[i]! + (1 - alpha) * v);
    const bar = document.querySelector(".cookieBanner")!;
    const style = getComputedStyle(bar);
    const tint = channels(style.backgroundColor);
    // The sheen is a gradient of white: its strongest stop is the worst case.
    const sheen = Math.max(
      0,
      ...[
        ...style.backgroundImage.matchAll(/rgba\(255, 255, 255, ([\d.]+)\)/g),
      ].map((m) => Number(m[1])),
    );
    // The brightest page there can be (white) behind the pane, then the tint,
    // then the sheen: the lightest the pane can ever be under its text.
    // brightness(x) in the backdrop filter darkens the page behind the glass.
    const filter =
      style.backdropFilter || style.getPropertyValue("-webkit-backdrop-filter");
    const dim = Number(/brightness\(([\d.]+)\)/.exec(filter)?.[1] ?? 1);
    const backdrop = [255 * dim, 255 * dim, 255 * dim];
    let pane = over(tint.slice(0, 3), tint[3] ?? 1, backdrop);
    pane = over([255, 255, 255], sheen, pane);
    const out: Array<{ text: string; ratio: number }> = [];
    for (const el of bar.querySelectorAll("p, summary, dt, dd, button")) {
      const own = [...el.childNodes].some(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
      );
      if (!own) continue;
      // A button is a glass pill on the pane: its hover fill (14 % white, --hairline, the pressed state) is its worst case.
      const behind = el.classList.contains("cookieBanner-button")
        ? over([255, 255, 255], 0.14, pane)
        : pane;
      const c = channels(getComputedStyle(el).color);
      const text = over(c.slice(0, 3), c[3] ?? 1, behind);
      const [a, b] = [lum(text), lum(behind)];
      out.push({
        text: (el.textContent ?? "").slice(0, 24),
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      });
    }
    return { out, blur: filter };
  });
  // It really is glass: the backdrop is blurred and dimmed.
  expect(glass.blur).toContain("blur");
  expect(glass.blur).toContain("brightness");
  // The sentence, the details link, the statement and the two answers.
  expect(glass.out.length).toBeGreaterThanOrEqual(5);
  for (const r of glass.out) {
    expect(r.ratio, r.text).toBeGreaterThanOrEqual(4.5);
  }
});

// A banner: it runs across the whole screen at every width, never scrolls the
// page sideways, keeps its content to a readable width on a wide screen, and
// puts the two answers beside the text only when there is room.
for (const [name, width, height, sideBySide, maxHeight] of [
  ["phone", 390, 844, false, 150],
  ["small phone", 320, 568, false, 190],
  ["tablet", 768, 1024, true, 100],
  ["laptop", 1440, 900, true, 76],
  ["ultrawide", 2560, 1080, true, 76],
] as const) {
  test(`the banner spans the screen and adapts on a ${name} (${width} px)`, async ({
    page,
  }) => {
    await stubGoogle(page);
    await page.setViewportSize({ width, height });
    await page.goto("/");
    const banner = page.getByTestId("cookie-banner");
    await expect(banner).toBeVisible();
    const m = await page.evaluate(() => {
      const box = (selector: string) => {
        const r = document.querySelector(selector)!.getBoundingClientRect();
        return {
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          width: r.width,
        };
      };
      return {
        bar: box(".cookieBanner"),
        inner: box(".cookieBanner-inner"),
        text: box(".cookieBanner-text"),
        actions: box(".cookieBanner-actions"),
        viewport: { w: innerWidth, h: innerHeight },
        overflowX:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      };
    });
    // Edge to edge, resting on the bottom edge, inside the screen.
    expect(m.bar.left).toBe(0);
    expect(m.bar.right).toBe(m.viewport.w);
    expect(m.bar.bottom).toBe(m.viewport.h);
    expect(m.bar.top).toBeGreaterThanOrEqual(0);
    // Slim: it must not take the page (Kirby: too big).
    expect(m.bar.bottom - m.bar.top, "banner height").toBeLessThanOrEqual(
      maxHeight,
    );
    expect(m.overflowX).toBe(false);
    // The content keeps to a readable width, centred.
    expect(m.inner.width).toBeLessThanOrEqual(64 * 16 + 1);
    expect(
      Math.abs(m.inner.left - (m.viewport.w - m.inner.right)),
    ).toBeLessThanOrEqual(1);
    // The answers sit beside the text when there is room, under it when not.
    if (sideBySide) expect(m.actions.left).toBeGreaterThanOrEqual(m.text.right);
    else expect(m.actions.top).toBeGreaterThanOrEqual(m.text.bottom);
    // The details link stays on the same line as the end of the sentence.
    expect(
      await page.evaluate(
        () =>
          document.querySelector(".cookieBanner-tail")!.getClientRects().length,
      ),
      "the sentence end and the link are one unbroken piece",
    ).toBe(1);
    // Details: at the end of the sentence on a phone, left of Accept beside the
    // text (Kirby, 2026-10-24). Exactly one of them is ever visible.
    const detailsBox = (await banner
      .getByRole("button", { name: "Details" })
      .boundingBox())!;
    const acceptBox = (await banner
      .getByRole("button", { name: "Accept" })
      .boundingBox())!;
    if (sideBySide) {
      expect(detailsBox.x + detailsBox.width).toBeLessThanOrEqual(acceptBox.x);
      expect(detailsBox.height).toBeGreaterThanOrEqual(44);
      expect(
        Math.abs(
          detailsBox.y +
            detailsBox.height / 2 -
            (acceptBox.y + acceptBox.height / 2),
        ),
      ).toBeLessThanOrEqual(2);
    } else {
      expect(detailsBox.y).toBeLessThan(acceptBox.y);
    }
    // At first only Accept shows, and it is tall enough to tap and on screen.
    await expect(banner.getByRole("button", { name: "Decline" })).toHaveCount(
      0,
    );
    const first = (await banner
      .getByRole("button", { name: "Accept" })
      .boundingBox())!;
    expect(first.height).toBeGreaterThanOrEqual(44);
    expect(first.x).toBeGreaterThanOrEqual(0);
    expect(first.x + first.width).toBeLessThanOrEqual(m.viewport.w);
    // Opening the details brings Decline in beside it.
    // On a phone the link is inline text; its invisible tap layer reaches 10 px
    // above the line, so a tap there still opens the details.
    await banner
      .getByRole("button", { name: "Details" })
      .click(sideBySide ? {} : { position: { x: 4, y: -10 } });
    await expect(banner.getByRole("button", { name: "Decline" })).toBeVisible();
    // Accept is on the left of Decline (Kirby, 2026-10-24).
    const [ax, dx] = [
      (await banner.getByRole("button", { name: "Accept" }).boundingBox())!.x,
      (await banner.getByRole("button", { name: "Decline" }).boundingBox())!.x,
    ];
    expect(ax).toBeLessThan(dx);
    // The two answers are the same size.
    const [aw, dw] = [
      (await banner.getByRole("button", { name: "Accept" }).boundingBox())!
        .width,
      (await banner.getByRole("button", { name: "Decline" }).boundingBox())!
        .width,
    ];
    expect(Math.abs(aw - dw)).toBeLessThanOrEqual(1);
    // Both buttons stay reachable: inside the screen and tall enough to tap.
    for (const label of ["Decline", "Accept"]) {
      const b = (await banner
        .getByRole("button", { name: label })
        .boundingBox())!;
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(m.viewport.w);
    }
  });
}

test("opened on a short screen the banner scrolls inside itself and keeps the buttons reachable", async ({
  page,
}) => {
  await stubGoogle(page);
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto("/");
  const banner = page.getByTestId("cookie-banner");
  await banner.getByRole("button", { name: "Details" }).click();
  const top = await banner.evaluate((el) => el.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(0);
  await banner.getByRole("button", { name: "Accept" }).scrollIntoViewIfNeeded();
  await expect(banner.getByRole("button", { name: "Accept" })).toBeInViewport();
});
