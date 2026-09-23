import { expect, test } from "@playwright/test";

test.describe("/results/demo", () => {
  test("presentation fixture shows six top scores, unrated tracks, and plain reasons", async ({
    page,
  }) => {
    await page.goto("/results/demo?presentation=1");
    await expect(
      page.getByRole("link", { name: /scan again/i }),
    ).toHaveAttribute("href", "/scan");
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
  test("renders each fixture with no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    const response = await page.goto("/results/demo");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/Results \(mock data\)/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Results (mock data)" }),
    ).toBeVisible();

    // High confidence (default): top pick visible, its "why it fits" reasons
    // shown, and no "not yet assessed" placeholder for the top pick.
    await expect(
      page.getByRole("heading", { level: 3, name: /G Pro X Superlight 2/ }),
    ).toBeVisible();
    await expect(page.getByText("Why it fits")).toBeVisible();

    // Low confidence: top pick shows the confidence note and at least one
    // "Not yet assessed" sub-score once the ranked list is expanded.
    await page.getByRole("button", { name: "Low confidence (nulls)" }).click();
    await expect(
      page.getByRole("heading", { level: 3, name: /MX Master 3S/ }),
    ).toBeVisible();
    await expect(page.getByRole("status").first()).toContainText(
      /haven't assessed this mouse's shape yet/,
    );

    // With exclusions: the "Not shown" group lists the excluded mice.
    await page.getByRole("button", { name: "With exclusions" }).click();
    await expect(
      page.getByRole("heading", { level: 3, name: /Xlite V3 Mini/ }),
    ).toBeVisible();
    const excludedToggle = page.getByRole("button", { name: /Not shown/ });
    await expect(excludedToggle).toBeVisible();
    await expect(excludedToggle).toHaveAttribute("aria-expanded", "false");

    expect(errors).toEqual([]);
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
      page.getByRole("heading", { level: 3, name: /G Pro X Superlight 2/ }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Ready", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        level: 3,
        name: "A close match for your palm grip",
      }),
    ).toBeVisible();
  });
});
