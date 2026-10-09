import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { contrast } from "./fixtures/contrast";

// The merged footer (Pencil v17 / v18, 2026-10-10). Kirby: no explanatory text
// in the footer for now: the two texts it used to carry (an Early preview note
// and a non-affiliation statement) were deleted and must stay absent, here and
// so from the whole site, until he decides otherwise.

const HEADLINE = "Ready to Find Yours?";
const GITHUB = "https://github.com/kirbyliu99M/Open_Mouse";
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

/** The six links in the order the footer lays them out: href and visible name. */
const LINKS: readonly (readonly [href: string, name: string])[] = [
  ["/scan/easy", "Scan"],
  ["/learn", "Learn"],
  ["/how-it-works", "How it works"],
  ["/how-it-works#privacy", "Privacy"],
  ["/account", "Account"],
  [GITHUB, "GitHub"],
];

async function box(page: Page, name: string) {
  const b = await page
    .getByTestId("site-footer")
    .getByRole("link", { name, exact: true })
    .boundingBox();
  if (!b) throw new Error(`no box for ${name}`);
  return b;
}

test.describe("the site footer, in English", () => {
  for (const path of ["/", "/how-it-works", "/account"]) {
    test(`${path} has the one merged footer: name, headline, three groups, six links`, async ({
      page,
    }) => {
      await page.goto(path);
      const footer = page.getByTestId("site-footer");
      await expect(page.locator("footer")).toHaveCount(1);
      await expect(footer).toBeVisible();
      await expect(footer.getByText("Palmate", { exact: true })).toBeVisible();
      // Kirby's own line, as a statement: not a link, not a button.
      const headline = footer.getByText(HEADLINE, { exact: true });
      await expect(headline).toBeVisible();
      await expect(footer.getByRole("link", { name: HEADLINE })).toHaveCount(0);
      await expect(footer.getByRole("button")).toHaveCount(0);

      const nav = footer.getByRole("navigation", { name: "Site links" });
      await expect(nav.getByRole("link")).toHaveCount(LINKS.length);
      for (const [group, names] of [
        ["Product", ["Scan", "Learn"]],
        ["Trust", ["How it works", "Privacy"]],
        ["Project", ["Account", "GitHub"]],
      ] as const) {
        await expect(
          nav.getByRole("heading", { level: 2, name: group }),
        ).toBeVisible();
        // The list is named by its heading.
        const list = nav.getByRole("list", { name: group });
        await expect(list.getByRole("link")).toHaveText(names as never);
      }
      for (const [href, name] of LINKS) {
        await expect(
          nav.getByRole("link", { name, exact: true }),
        ).toHaveAttribute("href", href);
      }
      // GitHub leaves the site: an ordinary external link, no new tab forced.
      const github = nav.getByRole("link", { name: "GitHub" });
      await expect(github).toHaveAttribute("rel", "noopener noreferrer");
      // The other five stay on the site and carry no rel.
      for (const [, name] of LINKS.filter(([, n]) => n !== "GitHub")) {
        await expect(
          nav.getByRole("link", { name, exact: true }),
        ).not.toHaveAttribute("rel", /.+/);
      }
      // English is the page's own language: nothing is marked zh-TW.
      await expect(footer.locator('[lang="zh-TW"]')).toHaveCount(0);
    });
  }

  test("the footer carries no explanatory text: no Early preview note, no non-affiliation statement", async ({
    page,
  }) => {
    for (const path of ["/", "/how-it-works", "/account"]) {
      await page.goto(path);
      const footer = page.getByTestId("site-footer");
      await expect(footer).toBeVisible();
      await expect(footer.getByText("Early preview")).toHaveCount(0);
      await expect(footer.getByText("Not affiliated")).toHaveCount(0);
      await expect(page.getByText("Not affiliated")).toHaveCount(0);
    }
  });

  test("the decorative parts are hidden from assistive technology, and the background mount is empty", async ({
    page,
  }) => {
    await page.goto("/how-it-works");
    const footer = page.getByTestId("site-footer");
    const backdrop = footer.getByTestId("site-footer-backdrop");
    await expect(backdrop).toHaveAttribute("aria-hidden", "true");
    expect(await backdrop.evaluate((el) => el.childElementCount)).toBe(0);
    expect((await backdrop.evaluate((el) => el.textContent ?? "")).trim()).toBe(
      "",
    );
    const mark = footer.locator("img");
    await expect(mark).toHaveCount(1);
    await expect(mark).toHaveAttribute("alt", "");
    await expect(mark).toHaveAttribute("src", "/images/brand/palmate-mark.svg");
    // Every icon is hidden from the reading order.
    const icons = footer.locator("svg.siteFooter-icon");
    await expect(icons).toHaveCount(LINKS.length);
    for (let i = 0; i < LINKS.length; i += 1)
      await expect(icons.nth(i)).toHaveAttribute("aria-hidden", "true");
  });

  test("the Privacy link lands on the privacy card", async ({ page }) => {
    await page.goto("/");
    await page
      .getByTestId("site-footer")
      .getByRole("link", { name: "Privacy" })
      .click();
    await expect(page).toHaveURL(/\/how-it-works#privacy$/);
    await expect(page.locator("#privacy")).toBeVisible();
  });

  test("the Scan link goes to the same place as the home page's Scan button", async ({
    page,
  }) => {
    await page.goto("/");
    const target = await page
      .getByTestId("home-hero")
      .getByRole("link", { name: "Scan my hand" })
      .getAttribute("href");
    await expect(
      page
        .getByTestId("site-footer")
        .getByRole("link", { name: "Scan", exact: true }),
    ).toHaveAttribute("href", target!);
  });

  for (const size of [
    { width: 320, height: 640 },
    { width: 375, height: 667 },
    PHONE,
    DESKTOP,
  ]) {
    test(`${size.width} px: the footer is below the content, the page does not scroll sideways, the mark covers no link`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await page.goto("/how-it-works");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      const [mainBottom, footerTop] = await page.evaluate(() => [
        document.querySelector("main")!.getBoundingClientRect().bottom,
        document
          .querySelector('[data-testid="site-footer"]')!
          .getBoundingClientRect().top,
      ]);
      expect(footerTop).toBeGreaterThanOrEqual(mainBottom);
      // The brand mark must not sit on any link, and nothing in the footer
      // may reach past the right edge.
      const overlaps = await page.evaluate(() => {
        const rect = (el: Element) => el.getBoundingClientRect();
        const mark = rect(document.querySelector(".siteFooter-mark")!);
        const hits: string[] = [];
        for (const a of document.querySelectorAll(".siteFooter a")) {
          const r = rect(a);
          if (
            r.left < mark.right &&
            r.right > mark.left &&
            r.top < mark.bottom &&
            r.bottom > mark.top
          )
            hits.push(a.textContent ?? "");
          if (r.right > window.innerWidth + 0.5)
            hits.push(`edge: ${a.textContent}`);
        }
        return hits;
      });
      expect(overlaps).toEqual([]);
    });
  }

  test("200 % text on a phone does not break the layout", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/how-it-works");
    await page.addStyleTag({ content: "html { font-size: 200%; }" });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    // Every link is still fully inside the viewport's width.
    for (const [, name] of LINKS) {
      const b = await box(page, name);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(375 + 0.5);
    }
  });

  test("on a phone: Product and Trust side by side, Project below with Account on the left and GitHub on the right, rows 44 px", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/how-it-works");
    const [scan, learn, how, privacy, account, github] = await Promise.all(
      LINKS.map(([, name]) => box(page, name)),
    );
    // Two columns: Product | Trust, rows aligned.
    expect(scan!.x).toBeLessThan(how!.x);
    expect(Math.abs(scan!.y - how!.y)).toBeLessThan(1);
    expect(Math.abs(learn!.y - privacy!.y)).toBeLessThan(1);
    expect(Math.abs(scan!.x - learn!.x)).toBeLessThan(1);
    // The Project row is lower than both columns; Account left, GitHub right,
    // on the same line.
    expect(account!.y).toBeGreaterThan(learn!.y + learn!.height);
    expect(Math.abs(account!.y - github!.y)).toBeLessThan(1);
    expect(account!.x).toBeLessThan(github!.x);
    // Touch rows are at least 44 px high.
    for (const b of [scan, learn, how, privacy, account, github])
      expect(b!.height).toBeGreaterThanOrEqual(44);
    // The mark sits at the right, level with the two lines of text.
    const mark = await page.locator(".siteFooter-mark").boundingBox();
    const name = await page
      .getByTestId("site-footer")
      .getByText("Palmate", { exact: true })
      .boundingBox();
    expect(mark!.x).toBeGreaterThan(PHONE.width / 2);
    expect(Math.abs(mark!.width - 92)).toBeLessThan(1);
    expect(mark!.y).toBeLessThanOrEqual(name!.y + 1);
  });

  test("on a desktop: three groups side by side, 236 px wide each, in the order Product, Trust, Project", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/how-it-works");
    const [scan, learn, how, privacy, account, github] = await Promise.all(
      LINKS.map(([, name]) => box(page, name)),
    );
    expect(scan!.x).toBeLessThan(how!.x);
    expect(how!.x).toBeLessThan(account!.x);
    // Within a group the second link is below the first.
    expect(learn!.y).toBeGreaterThan(scan!.y);
    expect(privacy!.y).toBeGreaterThan(how!.y);
    expect(github!.y).toBeGreaterThan(account!.y);
    expect(Math.abs(learn!.x - scan!.x)).toBeLessThan(1);
    // The groups are 236 px wide, 32 px apart.
    const groups = await page.locator(".siteFooter-group").evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return [r.x, r.width] as const;
      }),
    );
    for (const [, width] of groups)
      expect(Math.abs(width - 236)).toBeLessThan(1);
    expect(Math.abs(groups[1]![0] - groups[0]![0] - 236 - 32)).toBeLessThan(1);
    // The mark is the large one, on the right of the groups.
    const mark = await page.locator(".siteFooter-mark").boundingBox();
    expect(Math.abs(mark!.width - 220)).toBeLessThan(1);
    expect(mark!.x).toBeGreaterThan(github!.x + github!.width);
  });

  test("the keyboard reaches the links in the order they are laid out", async ({
    page,
  }) => {
    for (const size of [PHONE, DESKTOP]) {
      await page.setViewportSize(size);
      await page.goto("/how-it-works");
      await page
        .getByTestId("site-footer")
        .getByRole("link", { name: "Scan", exact: true })
        .focus();
      const seen: string[] = [];
      for (let i = 0; i < LINKS.length; i += 1) {
        seen.push(
          await page.evaluate(
            () => document.activeElement?.getAttribute("href") ?? "",
          ),
        );
        await page.keyboard.press("Tab");
      }
      expect(seen, `${size.width} px`).toEqual(LINKS.map(([href]) => href));
    }
  });

  test("every link shows a 2 px focus ring from the keyboard, fully drawn", async ({
    page,
  }) => {
    for (const size of [PHONE, DESKTOP]) {
      await page.setViewportSize(size);
      await page.goto("/how-it-works");
      for (const [, name] of LINKS) {
        const link = page
          .getByTestId("site-footer")
          .getByRole("link", { name, exact: true });
        await link.focus();
        const ring = await link.evaluate((el) => {
          const s = getComputedStyle(el);
          return [s.outlineStyle, s.outlineWidth, s.outlineColor];
        });
        expect(ring.slice(0, 2), `${name} at ${size.width} px`).toEqual([
          "solid",
          "2px",
        ]);
        // The ring itself must be seen against the footer (3:1 for a
        // non-text indicator).
        const footerBg = await page.evaluate(
          () =>
            getComputedStyle(document.querySelector(".siteFooter")!)
              .backgroundColor,
        );
        expect(
          contrast(ring[2]!, footerBg),
          `${name} ring ${ring[2]} on ${footerBg}`,
        ).toBeGreaterThanOrEqual(3);
        // Nothing clips it: no ancestor up to the footer hides overflow.
        const clipped = await link.evaluate((el) => {
          for (
            let p = el.parentElement;
            p && p.tagName !== "BODY";
            p = p.parentElement
          ) {
            const o = getComputedStyle(p).overflow;
            if (o !== "visible") return p.className || p.tagName;
          }
          return null;
        });
        expect(clipped, `${name} clipped by`).toBeNull();
      }
    }
  });

  test("the headings and links keep 4.5:1 on the footer's own colour", async ({
    page,
  }) => {
    await page.goto("/how-it-works");
    const c = await page.evaluate(() => {
      const bg = getComputedStyle(
        document.querySelector(".siteFooter")!,
      ).backgroundColor;
      const colour = (selector: string) =>
        getComputedStyle(document.querySelector(selector)!).color;
      return {
        bg,
        heading: colour(".siteFooter-groupTitle"),
        link: colour(".siteFooter-group a"),
        name: colour(".siteFooter-name"),
        headline: colour(".siteFooter-headline"),
        icon: colour(".siteFooter-icon"),
      };
    });
    for (const key of ["heading", "link", "name", "headline", "icon"] as const)
      expect(
        contrast(c[key], c.bg),
        `${key} ${c[key]} on ${c.bg}`,
      ).toBeGreaterThanOrEqual(4.5);
  });

  test("the fade above the footer takes no clicks", async ({ page }) => {
    await page.goto("/how-it-works");
    const style = await page.evaluate(() => {
      const s = getComputedStyle(document.querySelector(".siteFooter-fade")!);
      return [s.pointerEvents, s.position, s.zIndex];
    });
    expect(style).toEqual(["none", "absolute", "-1"]);
  });

  for (const size of [PHONE, DESKTOP]) {
    test(`axe finds no WCAG 2.2 AA violation in the footer at ${size.width} px`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await page.goto("/how-it-works");
      await page.getByTestId("site-footer").scrollIntoViewIfNeeded();
      const result = await new AxeBuilder({ page })
        .include('[data-testid="site-footer"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(
        result.violations.map((v) => `${v.id}: ${v.nodes.length}`),
      ).toEqual([]);
    });
  }
});

const FOOTER_RECTS = () => {
  const r = (selector: string) => {
    const b = document.querySelector(selector)!.getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
  };
  const links = [...document.querySelectorAll(".siteFooter-group a")].map(
    (a) => a.getBoundingClientRect().top,
  );
  return {
    footer: r(".siteFooter"),
    name: r(".siteFooter-name"),
    headline: r(".siteFooter-headline"),
    title: r(".siteFooter-groupTitle"),
    groups: r(".siteFooter-groups"),
    firstLink: r(".siteFooter-group a"),
    linkTops: links,
    fine: matchMedia("(hover: hover) and (pointer: fine)").matches,
  };
};

test.describe("the footer's spacing follows the design (candidate values from Pencil v17 / v18)", () => {
  test("390 px: 8 px under the name, 8 px under a group title, room before the groups", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/how-it-works");
    const f = await page.evaluate(FOOTER_RECTS);
    expect(f.headline.top - f.name.bottom).toBeCloseTo(8, 0);
    expect(f.firstLink.top - f.title.bottom).toBeCloseTo(8, 0);
    expect(f.groups.top - f.headline.bottom).toBeGreaterThanOrEqual(16);
  });

  test("1440 px: name at 48, headline at 92, group titles at 164, links 24 px under a title, rows 32 px apart", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/how-it-works");
    const f = await page.evaluate(FOOTER_RECTS);
    const at = (top: number) => top - f.footer.top;
    expect(at(f.name.top)).toBeCloseTo(48, 0);
    expect(at(f.headline.top)).toBeCloseTo(92.5, 0);
    expect(at(f.title.top)).toBeCloseTo(164.5, 0);
    expect(f.firstLink.top - f.title.top).toBeCloseTo(24, 0);
    if (f.fine) {
      // Mouse: the drawn one-line rows, 32 px apart (Pencil's pitch).
      expect(f.linkTops[1]! - f.linkTops[0]!).toBeCloseTo(32, 0);
    } else {
      // Touch on a wide screen: 44 px rows.
      expect(f.linkTops[1]! - f.linkTops[0]!).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("big text does not push the name and headline under the mark", () => {
  const SIZES = [
    { width: 320, height: 640 },
    { width: 375, height: 667 },
    PHONE,
    { width: 1024, height: 768 },
    { width: 1100, height: 800 },
    { width: 1250, height: 800 },
  ];
  for (const zoom of ["100%", "200%"]) {
    for (const size of SIZES) {
      test(`${size.width} px at ${zoom} text: no box of the name, headline or mark meets another, nothing runs past its box, no sideways scroll`, async ({
        page,
      }) => {
        await page.setViewportSize(size);
        await page.goto("/how-it-works");
        await page.addStyleTag({ content: `html { font-size: ${zoom}; }` });
        const f = await page.evaluate(() => {
          const rect = (el: Element) => {
            const b = el.getBoundingClientRect();
            return {
              top: b.top,
              bottom: b.bottom,
              left: b.left,
              right: b.right,
            };
          };
          const overflow = (selector: string) => {
            const el = document.querySelector(selector)!;
            return el.scrollWidth - el.clientWidth;
          };
          return {
            name: rect(document.querySelector(".siteFooter-name")!),
            headline: rect(document.querySelector(".siteFooter-headline")!),
            mark: rect(document.querySelector(".siteFooter-mark img")!),
            nameOver: overflow(".siteFooter-name"),
            headlineOver: overflow(".siteFooter-headline"),
            // What the footer adds to the page's own width (at 320 px and
            // 200 % the page's hero badge alone is 7 px too wide).
            scroll: (() => {
              const withFooter = document.documentElement.scrollWidth;
              document.querySelector(".siteFooter")!.remove();
              const without = document.documentElement.scrollWidth;
              return withFooter - Math.max(without, window.innerWidth);
            })(),
          };
        });
        const meets = (
          a: { top: number; bottom: number; left: number; right: number },
          b: { top: number; bottom: number; left: number; right: number },
        ) =>
          a.left < b.right &&
          a.right > b.left &&
          a.top < b.bottom &&
          a.bottom > b.top;
        // The mark does not grow with the text size: on a phone it stays at
        // most a quarter of the width, so the words keep the rest of the row.
        if (size.width < 1024)
          expect(f.mark.right - f.mark.left, "mark width").toBeLessThanOrEqual(
            size.width * 0.25 + 0.5,
          );
        else
          expect(f.mark.right - f.mark.left, "mark width").toBeLessThanOrEqual(
            220.5,
          );
        expect(meets(f.name, f.mark), "name meets mark").toBe(false);
        expect(meets(f.headline, f.mark), "headline meets mark").toBe(false);
        // Text wider than its box would paint under the mark.
        expect(f.nameOver, "name overflows its box").toBeLessThanOrEqual(0);
        expect(
          f.headlineOver,
          "headline overflows its box",
        ).toBeLessThanOrEqual(0);
        expect(f.scroll, "sideways scroll").toBeLessThanOrEqual(0);
      });
    }
  }
});

test.describe("on a touch screen as wide as a desktop", () => {
  test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });
  test("the links keep 44 px rows (design-guidelines.md: touch targets)", async ({
    page,
  }) => {
    await page.goto("/how-it-works");
    expect(
      await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
      "this context counts as touch",
    ).toBe(true);
    for (const [, name] of LINKS)
      expect((await box(page, name)).height, name).toBeGreaterThanOrEqual(44);
  });
});

test.describe("the site footer, for a browser that prefers Chinese", () => {
  test.use({ locale: "zh-TW" });

  test("switches to zh-TW after mount, marks that text lang=zh-TW, keeps the headline as written", async ({
    page,
  }) => {
    await page.goto("/how-it-works");
    const footer = page.getByTestId("site-footer");
    for (const name of ["掃描", "學習", "運作方式", "隱私", "帳號", "GitHub"])
      await expect(
        footer.getByRole("link", { name, exact: true }),
      ).toBeVisible();
    for (const name of ["產品", "信任", "專案"])
      await expect(
        footer.getByRole("heading", { level: 2, name }),
      ).toBeVisible();
    await expect(footer.locator('[lang="zh-TW"]')).not.toHaveCount(0);
    // Kirby's own line is shown as he wrote it, in either language.
    await expect(footer.getByText(HEADLINE, { exact: true })).toBeVisible();
    await expect(footer).not.toContainText("Early preview");
    await expect(footer).not.toContainText("Not affiliated");
  });
});

test.describe("pages with their own print layout have no footer", () => {
  for (const path of [
    "/learn/print",
    "/learn/slates",
    "/sheet",
    "/scan/easy",
  ]) {
    test(`${path}`, async ({ page }) => {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      // Ready when the page's <main> is in the DOM. Attached, not visible: on
      // a phone /scan/easy is a full-bleed viewfinder and Playwright counts
      // its <body> as hidden, so a visibility check would fail there.
      await expect(page.locator("main").first()).toBeAttached();
      await expect(page.getByTestId("site-footer")).toHaveCount(0);
      await page.emulateMedia({ media: "print" });
      await expect(page.getByTestId("site-footer")).toHaveCount(0);
    });
  }
});

test("on paper the footer prints dark text on white, with no fade, glow or mark", async ({
  page,
}) => {
  await page.goto("/how-it-works");
  await page.emulateMedia({ media: "print" });
  const colours = await page.evaluate(() =>
    [
      ".siteFooter-name",
      ".siteFooter-headline",
      ".siteFooter-groupTitle",
      ".siteFooter-group a",
    ].map((selector) => {
      const el = document.querySelector(selector)!;
      return [selector, getComputedStyle(el).color] as const;
    }),
  );
  for (const [selector, colour] of colours) {
    expect(contrast(colour, "rgb(255, 255, 255)"), selector).toBeGreaterThan(7);
  }
  const facts = await page.evaluate(() => {
    const footer = document.querySelector(".siteFooter")!;
    return {
      bg: getComputedStyle(footer).backgroundColor,
      before: getComputedStyle(document.querySelector(".siteFooter-fade")!)
        .display,
      after: getComputedStyle(document.querySelector(".siteFooter-horizon")!)
        .display,
      mark: getComputedStyle(document.querySelector(".siteFooter-mark")!)
        .display,
    };
  });
  expect(["rgba(0, 0, 0, 0)", "rgb(255, 255, 255)"]).toContain(facts.bg);
  expect([facts.before, facts.after, facts.mark]).toEqual([
    "none",
    "none",
    "none",
  ]);
});

test.describe("with more contrast asked for", () => {
  test.use({ contrast: "more" });
  test("the fade and the glow are gone and the edge is a line", async ({
    page,
  }) => {
    await page.goto("/how-it-works");
    const facts = await page.evaluate(() => {
      const footer = document.querySelector(".siteFooter")!;
      const s = getComputedStyle(footer);
      return {
        before: getComputedStyle(document.querySelector(".siteFooter-fade")!)
          .display,
        after: getComputedStyle(document.querySelector(".siteFooter-horizon")!)
          .display,
        glow: getComputedStyle(
          document.querySelector(".siteFooter-mark")!,
          "::before",
        ).display,
        border: s.borderTopWidth,
      };
    });
    expect(facts).toEqual({
      before: "none",
      after: "none",
      glow: "none",
      border: "1px",
    });
  });
});
