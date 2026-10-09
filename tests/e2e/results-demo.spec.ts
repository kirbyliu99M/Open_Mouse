import { expect, test, type Page } from "@playwright/test";

/** Details is closed by default; open it to reach the scores and the analysis. */
async function openDetails(page: Page) {
  const details = page.locator(".results-details");
  await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
}

test.describe("/results/demo", () => {
  test("presentation fixture shows six top scores, unrated tracks, and plain reasons", async ({
    page,
  }) => {
    await page.goto("/results/demo?presentation=1");
    await expect(
      page.getByRole("link", { name: /scan again/i }),
    ).toHaveAttribute("href", "/scan/easy");
    await openDetails(page);
    const scores = page.locator(".results-details .results-subscoreBar");
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

  test("the header shows the total as a big number, with its label and band, and one honest statement about unrated shape", async ({
    page,
  }) => {
    await page.goto("/results/demo?presentation=1");

    // The big score is the fit entry's real total (55 in low-confidence.json,
    // the fixture this presentation view uses), not any other number on the
    // page.
    await expect(page.locator(".results-score-value")).toHaveText("55");
    await expect(page.locator(".results-score-label")).toHaveText(
      "fit score / 100",
    );
    await expect(page.locator(".results-band")).toHaveText("A fair fit");
    await expect(page.locator(".results-score-rank")).toHaveText(
      "#1 · Logitech",
    );

    // Only the "leans on its size" line appears, not also the generic
    // low-confidence note (item 2).
    await expect(page.locator(".results-sizeNotice")).toHaveCount(1);
    await expect(page.locator(".results-confidenceNote")).toHaveCount(0);

    // The old per-reason "Why it fits" cards stay gone: plain lines under
    // "Why this mouse" instead, one per sub-score that has a score. This
    // fixture (low-confidence.json) rates only two of the six (length 70,
    // thumb 60; the other four are null), and `topReasons` never shows an
    // unrated sub-score as a reason, so there are two lines, not three.
    await expect(page.getByText("Why it fits")).toHaveCount(0);
    await expect(page.locator(".results-why-list li")).toHaveCount(2);
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
    // The dev-controls label is styled like a heading but isn't one: the
    // results page below supplies the page's one real h1 (item 5).
    await expect(page.getByText("Results (mock data)")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

    // High confidence (default): no hand type in the response (what fit-v0
    // sends), so the model name is the h1 and there is no hand block.
    await expect(
      page.getByRole("heading", { level: 1, name: /G Pro X Superlight 2/ }),
    ).toBeVisible();
    await expect(page.locator(".results-hand")).toHaveCount(0);
    await openDetails(page);
    await expect(page.getByText("How it scores")).toBeVisible();

    // Low confidence: with unrated shape scores, the page shows the "leans on
    // its size" line rather than the generic confidence note: one honest
    // statement, not two (item 2).
    await page.getByRole("button", { name: "Low confidence (nulls)" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: /MX Master 3S/ }),
    ).toBeVisible();
    await openDetails(page);
    await expect(page.locator(".results-sizeNotice")).toContainText(
      "leans on its size",
    );
    await expect(page.locator(".results-confidenceNote")).toHaveCount(0);

    // With exclusions: "Other mice" holds the excluded mice, closed.
    await page.getByRole("button", { name: "With exclusions" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: /Xlite V3 Mini/ }),
    ).toBeVisible();
    const others = page.locator(".results-otherMice");
    await expect(others).not.toHaveAttribute("open", "");
    await expect(others.locator("summary")).toContainText("Other mice (2)");
    await others.locator("summary").click();
    await expect(page.locator(".results-excluded-list li")).toHaveCount(2);

    // Many mice: a hand type, ranks six onward, and the excluded last.
    await page.getByRole("button", { name: "Many mice + hand type" }).click();
    await expect(page.locator(".results-hand-title")).toHaveText(
      "Medium mouse · Claw grip · Wide",
    );
    // With a hand type the hand title is the one h1 and the model is an h2.
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.locator(".results-otherMice summary")).toContainText(
      "Other mice (5)",
    );

    expect(errors).toEqual([]);
  });

  test("an in-range weight says so with the preferred range, not a gap", async ({
    page,
  }) => {
    // high-confidence.json (the default fixture) sends weight_in_range with
    // { minG: 55, maxG: 60 } for the top pick, so the sentence names the range.
    await page.goto("/results/demo");
    await openDetails(page);
    const details = page.locator(".results-details");
    await expect(
      details.getByText("Weight is within your preferred range (55–60 g).", {
        exact: true,
      }),
    ).toBeVisible();
    // It never claims a difference for a weight that is inside the range.
    await expect(details).not.toContainText(/heavier than you prefer/i);
    await expect(details).not.toContainText(/lighter than you prefer/i);
  });

  test("Details and Other mice open and close with the keyboard, closed by default", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/results/demo");
    await page.getByRole("button", { name: "Many mice + hand type" }).click();

    for (const [selector, hidden] of [
      [".results-details", ".results-subscoreGrid"],
      [".results-otherMice", ".results-otherMice-list"],
    ] as const) {
      const section = page.locator(selector);
      const summary = section.locator("summary");
      await expect(section).not.toHaveAttribute("open", "");
      await expect(section.locator(hidden)).toBeHidden();

      await summary.focus();
      await expect(summary).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(section).toHaveAttribute("open", "");
      await expect(section.locator(hidden)).toBeVisible();

      await page.keyboard.press("Enter");
      await expect(section).not.toHaveAttribute("open", "");
    }

    expect(errors).toEqual([]);
  });

  test("the other picks are cards: choosing one shows that mouse in the same layout", async ({
    page,
  }) => {
    await page.goto("/results/demo");
    await page.getByRole("button", { name: "Many mice + hand type" }).click();

    const cards = page.locator(".results-card");
    await expect(cards).toHaveCount(4);
    await expect(page.locator(".results-others-caption")).toHaveText(
      "Tap any pick to see a results page with the same layout.",
    );
    await cards.filter({ hasText: "G309" }).click();

    await expect(page.locator(".results-score-rank")).toHaveText(
      "#3 · Logitech",
    );
    await expect(page.locator(".results-score-model")).toHaveText("G309");
    // Rank 1 is among the other picks now, and this mouse is not.
    await expect(cards).toHaveCount(4);
    await expect(cards.first()).toContainText("G Pro X Superlight 2");
    await expect(cards.filter({ hasText: "G309" })).toHaveCount(0);
  });

  test("a mouse beyond the top five has a row, not a page", async ({
    page,
  }) => {
    await page.goto("/results/demo");
    await page.getByRole("button", { name: "Many mice + hand type" }).click();
    await page.locator(".results-otherMice summary").click();
    const rows = page.locator(".results-otherMice-row");
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText("Pulsar X2");
    await expect(rows.first()).toContainText("77");
    await expect(rows.locator("a, button")).toHaveCount(0);
    // The excluded mice come after the ranked rows, each with its reason.
    const last = await page.evaluate(() => {
      const row = document.querySelector(".results-otherMice-row:last-child")!;
      const excluded = document.querySelector(".results-excluded-list")!;
      return Boolean(
        row.compareDocumentPosition(excluded) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
    expect(last).toBe(true);
    await expect(page.locator(".results-excluded-reason").first()).toHaveText(
      "Vertical mouse: our scoring doesn't cover this shape yet",
    );
    // A wrong-hand mouse says which hand it is made for, and carries its score;
    // the vertical one has no number and no placeholder.
    const [vertical, wrongHand] = await page
      .locator(".results-excluded-list li")
      .all();
    await expect(vertical.locator(".results-excluded-score")).toHaveCount(0);
    await expect(vertical).not.toContainText(/\d/);
    await expect(wrongHand.locator(".results-excluded-reason")).toHaveText(
      "Made for the left hand",
    );
    await expect(wrongHand.locator(".results-excluded-score")).toHaveText(
      "58 / 100",
    );
    // No excluded row is a link.
    await expect(
      page.locator(".results-excluded-list a, .results-excluded-list button"),
    ).toHaveCount(0);
    // No early-preview notice on the page (the site footer carries it).
    await expect(page.locator(".results-previewNotice")).toHaveCount(0);
  });

  test("Written analysis slot preview shows loading, error and ready states without affecting numeric results", async ({
    page,
  }) => {
    await page.goto("/results/demo");
    await openDetails(page);

    await page.getByRole("button", { name: "Loading", exact: true }).click();
    // The analysis card is a status region; scoped to it, as the page has others.
    await expect(page.locator(".results-analysis-loading")).toContainText(
      /Preparing/,
    );

    await page.getByRole("button", { name: "Error", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Written analysis" }),
    ).toContainText(/unaffected/);
    // The numeric top pick is still fully there while the analysis errored.
    await expect(
      page.getByRole("heading", { level: 1, name: /G Pro X Superlight 2/ }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Ready", exact: true }).click();
    await expect(
      page.getByRole("heading", { level: 3, name: "Why this one" }),
    ).toBeVisible();
    await expect(
      page.getByText("A close match for your palm grip"),
    ).toBeVisible();
    // "Ready" previews model-written text, which carries no source line yet.
    await expect(
      page.getByText("Generated automatically from your scores above."),
    ).toHaveCount(0);
  });

  test("the written analysis lives in Details, after the scores, and a detail page has none", async ({
    page,
  }) => {
    await page.goto("/results/demo");
    await page.getByRole("button", { name: "Many mice + hand type" }).click();
    await page.getByRole("button", { name: "Ready", exact: true }).click();

    const order = await page.evaluate(() => {
      const q = (s: string) => document.querySelector(s)!;
      const follows = (a: Element, b: Element) =>
        Boolean(
          a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
      const analysis = q(".results-analysis");
      return {
        insideDetails: q(".results-details").contains(analysis),
        scoresBeforeAnalysis: follows(q(".results-subscoreGrid"), analysis),
        deltasBeforeAnalysis: follows(q(".results-targetDeltas"), analysis),
        analysisBeforeOthers: follows(analysis, q(".results-others")),
      };
    });
    expect(order).toEqual({
      insideDetails: true,
      scoresBeforeAnalysis: true,
      deltasBeforeAnalysis: true,
      analysisBeforeOthers: true,
    });

    await page.locator(".results-card").first().click();
    await expect(page.locator(".results-score-rank")).toHaveText(
      "#2 · Logitech",
    );
    await expect(page.locator(".results-analysis")).toHaveCount(0);
  });

  test("the sections come in the approved order", async ({ page }) => {
    await page.goto("/results/demo");
    await page.getByRole("button", { name: "Many mice + hand type" }).click();
    const order = await page.evaluate(() => {
      const selectors = [
        ".results-topBar",
        ".results-hand",
        ".results-hero-photo",
        ".results-score",
        ".results-why",
        ".results-details",
        ".results-others",
        ".results-otherMice",
        ".results-share-bottom",
      ];
      const nodes = selectors.map((s) => document.querySelector(s));
      return selectors.map((s, i) => {
        const node = nodes[i];
        const prev = nodes[i - 1];
        return [
          s,
          i === 0 ||
            Boolean(
              prev &&
              node &&
              prev.compareDocumentPosition(node) &
                Node.DOCUMENT_POSITION_FOLLOWING,
            ),
        ];
      });
    });
    for (const [selector, inOrder] of order)
      expect(inOrder, `${selector} comes after the one before it`).toBe(true);
  });

  test("has a share button in the top bar and a primary one, beside the purchase spot or under Other mice", async ({
    page,
  }) => {
    await page.goto("/results/demo");
    const buttons = page.getByTestId("share-card-button");
    // Three in the page, two shown at any width: the link in the top bar, and
    // the primary one in the hero (wide) or under Other mice (phone).
    await expect(buttons).toHaveCount(3);
    await expect(
      page.locator('[data-testid="share-card-button"]:visible'),
    ).toHaveCount(2);
    await expect(
      page.locator(".results-topBar [data-testid='share-card-button']"),
    ).toBeVisible();
    const wide = (page.viewportSize()?.width ?? 0) >= 900;
    await expect(
      page.locator(
        wide
          ? ".results-share-hero [data-testid='share-card-button']"
          : ".results-share-bottom [data-testid='share-card-button']",
      ),
    ).toBeVisible();
  });

  test("heading levels never skip: one h1, then h2 sections, h3 only under an h2", async ({
    page,
  }) => {
    await page.goto("/results/demo");
    await page.getByRole("button", { name: "Many mice + hand type" }).click();
    await page.getByRole("button", { name: "Ready", exact: true }).click();
    await openDetails(page);
    await page.locator(".results-otherMice summary").click();

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

test.describe("/results/demo in a Chinese browser", () => {
  test.use({ locale: "zh-TW" });

  test("shows the zh-TW words, marked as zh-TW", async ({ page }) => {
    await page.goto("/results/demo");
    await page.getByRole("button", { name: "Many mice + hand type" }).click();

    await expect(page.locator(".results-hand-kicker")).toHaveText(
      "適合你的滑鼠型",
    );
    await expect(page.locator(".results-hand-title")).toHaveText(
      "中型滑鼠・抓握・寬身",
    );
    await expect(page.locator(".results-hand-sentence")).toHaveText(
      "適合長度中等、握寬較寬的滑鼠；以抓握的方式最能發揮。",
    );
    await expect(page.locator(".results-hand")).toHaveAttribute(
      "lang",
      "zh-TW",
    );
    await expect(page.locator(".results-score-rank")).toHaveText(
      "第一名 · Logitech",
    );
    await expect(page.locator(".results-score-label")).toHaveText(
      "適配分數 / 100",
    );
    await expect(page.locator(".results-band")).toHaveText("非常適合你");
    await expect(page.locator(".results-why-heading")).toHaveText(
      "為什麼是這支",
    );
    await expect(page.locator(".results-why-list li")).toHaveCount(3);
    await expect(page.locator(".results-details summary")).toContainText(
      "詳細資料",
    );
    await expect(page.locator(".results-others-head h2")).toHaveText(
      "其他推薦",
    );
    await expect(page.locator(".results-otherMice summary")).toContainText(
      "其他滑鼠（共 5 款）",
    );
    await expect(page.locator(".results-topBar-back")).toContainText(
      "重新掃描",
    );
    // The accessible name leaves the chevron out, as the shared TopBar does.
    await expect(
      page.getByRole("link", { name: "返回重新掃描" }),
    ).toHaveAttribute("href", "/scan/easy");
  });
});
