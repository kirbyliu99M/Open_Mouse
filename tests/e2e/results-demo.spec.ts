import { expect, test } from "@playwright/test";

test.describe("/results/demo", () => {
  test("presentation fixture shows six top scores, unrated tracks, and plain reasons", async ({
    page,
  }) => {
    await page.goto("/results/demo?presentation=1");
    await expect(
      page.getByRole("link", { name: /scan again/i }),
    ).toHaveAttribute("href", "/scan/easy");
    await expect(page.getByText("Your matches")).toBeVisible();
    const scores = page.locator(".results-topPick .results-subscoreBar");
    await expect(scores).toHaveCount(6);
    const unrated = scores.filter({
      has: page.locator('.results-subscoreBar-value:text-is("—")'),
    });
    expect(await unrated.count()).toBeGreaterThan(0);
    await expect(
      unrated.first().locator(".results-subscoreBar-fill"),
    ).toHaveCount(0);
    await expect(
      page.getByText("No weight preference given").first(),
    ).toBeVisible();
    await expect(page.locator(".results-sizeNotice")).toContainText(
      "leans on its size",
    );
    const visible = await page.locator("main").innerText();
    expect(visible).not.toMatch(
      /descriptor_unknown|shape-classified|logitech-mx-master-3s|fallback|gemini|llm/i,
    );
  });
  test("top-pick header shows the total as a big number, drops the old meta row, and shows one honest statement about unrated shape", async ({
    page,
  }) => {
    await page.goto("/results/demo?presentation=1");

    // The big score is the fit entry's real total (55 in low-confidence.json,
    // the fixture this presentation view uses), not any other number on the
    // card.
    await expect(page.locator(".results-topPick-scoreValue")).toHaveText("55");
    await expect(page.locator(".results-topPick-scoreLabel")).toHaveText(
      "fit score / 100",
    );

    // "Best match" and the old Size/Weight/Fit score/Confidence row are gone
    // from the top-pick card (item 1).
    await expect(
      page.locator(".results-topPick").getByText("Best match", {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.locator(".results-topPick .results-mouseHeader-stats"),
    ).toHaveCount(0);

    // Only the "leans on its size" line appears — not also the generic
    // low-confidence note (item 2).
    await expect(page.locator(".results-sizeNotice")).toBeVisible();
    await expect(
      page.locator(".results-topPick .results-confidenceNote"),
    ).toHaveCount(0);

    // The old per-reason "Why it fits" cards are gone (item 3) — the plain
    // per-subscore sentences (SubscoreBar's own reason text) are the only
    // place those reasons appear now.
    await expect(page.locator(".results-topPick-reasons")).toHaveCount(0);
    await expect(page.getByText("Why it fits")).toHaveCount(0);
  });

  test("renders each fixture with no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    const response = await page.goto("/results/demo");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/Results \(mock data\)/);
    // The dev-controls label is styled like a heading but isn't one —
    // ResultsView below supplies the page's one real h1 (item 5).
    await expect(page.getByText("Results (mock data)")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

    // High confidence (default): top pick visible with its scores heading,
    // and no "not yet assessed" placeholder for the top pick.
    await expect(
      page.getByRole("heading", { level: 2, name: /G Pro X Superlight 2/ }),
    ).toBeVisible();
    await expect(page.getByText("How it scores")).toBeVisible();

    // Low confidence: with unrated shape scores, the top pick shows the
    // "leans on its size" line rather than the generic confidence note —
    // one honest statement, not two (item 2).
    await page.getByRole("button", { name: "Low confidence (nulls)" }).click();
    await expect(
      page.getByRole("heading", { level: 2, name: /MX Master 3S/ }),
    ).toBeVisible();
    await expect(page.locator(".results-sizeNotice")).toContainText(
      "leans on its size",
    );
    await expect(
      page.locator(".results-topPick").getByRole("status"),
    ).toHaveCount(0);

    // With exclusions: the "Not shown" group lists the excluded mice.
    await page.getByRole("button", { name: "With exclusions" }).click();
    await expect(
      page.getByRole("heading", { level: 2, name: /Xlite V3 Mini/ }),
    ).toBeVisible();
    const excludedToggle = page.getByRole("button", { name: /Not shown/ });
    await expect(excludedToggle).toBeVisible();
    await expect(excludedToggle).toHaveAttribute("aria-expanded", "false");

    expect(errors).toEqual([]);
  });

  test("an in-range weight says so with the preferred range, not a gap", async ({
    page,
  }) => {
    // high-confidence.json (the default fixture) sends weight_in_range with
    // { minG: 55, maxG: 60 } for the top pick, so the sentence names the range.
    await page.goto("/results/demo");
    const topPick = page.locator(".results-topPick");
    await expect(
      topPick.getByText("Weight is within your preferred range (55–60 g).", {
        exact: true,
      }),
    ).toBeVisible();
    // It never claims a difference for a weight that is inside the range.
    await expect(topPick).not.toContainText(/heavier than you prefer/i);
    await expect(topPick).not.toContainText(/lighter than you prefer/i);
  });

  test("expands and collapses the ranked list with the keyboard", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/results/demo");

    const toggle = page.getByRole("button", {
      name: /Show the other 3 ranked mice/,
    });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await toggle.focus();
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Enter");

    const opened = page.getByRole("button", {
      name: /Hide the other 3 ranked mice/,
    });
    await expect(opened).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByRole("heading", { level: 3, name: /DeathAdder V3/ }),
    ).toBeVisible();

    await page.keyboard.press("Enter");
    const closed = page.getByRole("button", {
      name: /Show the other 3 ranked mice/,
    });
    await expect(closed).toHaveAttribute("aria-expanded", "false");

    expect(errors).toEqual([]);
  });

  test("Written analysis slot preview shows loading, error and ready states without affecting numeric results", async ({
    page,
  }) => {
    await page.goto("/results/demo");

    await page.getByRole("button", { name: "Loading", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(/Preparing/);

    await page.getByRole("button", { name: "Error", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Written analysis" }),
    ).toContainText(/unaffected/);
    // The numeric top pick is still fully there while the analysis errored.
    await expect(
      page.getByRole("heading", { level: 2, name: /G Pro X Superlight 2/ }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Ready", exact: true }).click();
    await expect(
      page.getByRole("heading", { level: 2, name: "Why this one" }),
    ).toBeVisible();
    await expect(
      page.getByText("A close match for your palm grip"),
    ).toBeVisible();
    // "Ready" previews model-written text, which carries no source line yet.
    await expect(
      page.getByText("Generated automatically from your scores above."),
    ).toHaveCount(0);
  });

  test("'Why this one' sits between the top pick and 'Show the other ranked mice' (item 5), with a card surface", async ({
    page,
  }) => {
    await page.goto("/results/demo");
    await page.getByRole("button", { name: "Ready", exact: true }).click();

    const analysisCard = page.locator(".results-analysis");
    await expect(analysisCard).toBeVisible();
    // A real card surface, not a bare divider — matches the top-pick card
    // (item 5). On the one dark theme that surface is #1c1c1e, the top-pick
    // card's own, lighter than the page (#060709).
    await expect(analysisCard).toHaveCSS("background-color", "rgb(28, 28, 30)");
    await expect(page.locator(".results-topPick")).toHaveCSS(
      "background-color",
      "rgb(28, 28, 30)",
    );
    await expect(analysisCard).toHaveCSS("border-radius", "16px");

    // DOM order: top pick, then "Why this one", then the ranked-list
    // disclosure toggle.
    const order = await page.evaluate(() => {
      const topPick = document.querySelector(".results-topPick")!;
      const analysis = document.querySelector(".results-analysis")!;
      const rankedToggle = document.querySelector(
        ".results-rankedList-toggle",
      )!;
      const DOCUMENT_POSITION_FOLLOWING = 4;
      const topPickBeforeAnalysis = Boolean(
        topPick.compareDocumentPosition(analysis) & DOCUMENT_POSITION_FOLLOWING,
      );
      const analysisBeforeToggle = Boolean(
        analysis.compareDocumentPosition(rankedToggle) &
        DOCUMENT_POSITION_FOLLOWING,
      );
      return { topPickBeforeAnalysis, analysisBeforeToggle };
    });
    expect(order.topPickBeforeAnalysis).toBe(true);
    expect(order.analysisBeforeToggle).toBe(true);
  });

  test("heading levels never skip: h1, then h2s for the top pick and 'Why this one', no h3 before an h2", async ({
    page,
  }) => {
    await page.goto("/results/demo");
    await page.getByRole("button", { name: "Ready", exact: true }).click();

    const levels = await page.evaluate(() =>
      Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6")).map(
        (el) => Number(el.tagName[1]),
      ),
    );
    expect(levels[0]).toBe(1);
    expect(levels.filter((l) => l === 1)).toHaveLength(1);

    // No skipped level anywhere in reading order: the first time a level
    // appears, the level just above it must already have appeared earlier
    // in the document (an h3 before any h2 would fail this).
    const seen = new Set<number>();
    for (const level of levels) {
      if (level > 1) expect(seen.has(level - 1)).toBe(true);
      seen.add(level);
    }
  });
});
