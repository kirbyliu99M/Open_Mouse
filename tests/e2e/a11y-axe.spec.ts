import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * WCAG 2.2 AA rules on the main pages, in the light and the dark theme.
 *
 * `@axe-core/playwright` is a devDependency (MPL-2.0, like axe-core it wraps;
 * neither ships to users). Any rule that cannot be fixed is listed in
 * `DISABLED_RULES` for that one page, with the reason: never a whole page.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

/** page -> rule id -> why it is off there. Empty on purpose. */
const DISABLED_RULES: Record<string, Record<string, string>> = {};

const PAGES: readonly (readonly [string, string])[] = [
  ["/", "home"],
  ["/scan/easy", "scan entry (desktop)"],
  ["/results/demo", "results demo"],
  // The presentation view opens with the written-analysis card showing.
  [
    "/results/demo?presentation=1",
    "results demo, presentation view (written-analysis card)",
  ],
  ["/sheet", "calibration sheet"],
];

for (const [path, name] of PAGES) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`${name} (${path}) has no WCAG 2.2 AA violations in ${colorScheme} mode`, async ({
      page,
    }, info) => {
      test.skip(info.project.name !== "chromium");
      // No transitions: a colour read mid-fade is neither theme's.
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.goto(path);
      await expect(page.locator("main, [role=main]").first()).toBeVisible();
      if (path === "/scan/easy")
        await expect(page.locator(".easyDeviceEntry")).toBeVisible();
      if (path.startsWith("/results/demo"))
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if (path.includes("presentation"))
        await expect(page.locator(".results-analysis")).toBeVisible();
      const builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
      const disabled = Object.keys(DISABLED_RULES[path] ?? {});
      if (disabled.length) builder.disableRules(disabled);
      const { violations } = await builder.analyze();
      expect(
        violations.map((v) => ({
          rule: v.id,
          impact: v.impact,
          nodes: v.nodes.map(
            (n) => `${n.target.join(" ")}: ${n.failureSummary}`,
          ),
        })),
      ).toEqual([]);
    });
  }
}

// The phone screens too: they are the product, and they use the same rules.
for (const colorScheme of ["light", "dark"] as const) {
  test(`the phone camera screen, with its first-run tip open, has no violations in ${colorScheme} mode`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "mobile", "Runs in the mobile project.");
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.goto("/scan/easy");
    await expect(
      page.getByRole("dialog", { name: "One blank sheet is all you need" }),
    ).toBeVisible();
    const { violations } = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      .analyze();
    expect(
      violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
      ),
    ).toEqual([]);
  });

  test(`the phone camera screen, tip closed and camera refused, has no violations in ${colorScheme} mode`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "mobile", "Runs in the mobile project.");
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.goto("/scan/easy");
    await page.getByRole("button", { name: "Got it" }).click();
    await expect(page.locator(".cameraErrorCard")).toBeVisible();
    const { violations } = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      .analyze();
    expect(
      violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
      ),
    ).toEqual([]);
  });
}
