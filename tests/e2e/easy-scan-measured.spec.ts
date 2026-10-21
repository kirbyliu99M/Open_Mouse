import { expect, test, type Page } from "@playwright/test";

/**
 * `/scan/easy/measured-demo` mounts the real EasyScanCamera against a
 * fixed, schema-valid measured state (no synthetic e2e photo makes
 * MediaPipe detect a hand — see tests/e2e/scan.spec.ts's own comment), so
 * this is the only deterministic way to reach and exercise the measured
 * bottom sheet and the two question pages after it (grip 1／2, palm
 * thickness 2／2), and what the last page actually POSTs.
 *
 * Flow (Kirby, 2026-10-12): measured sheet -> "Continue" -> grip page ->
 * palm-thickness page -> the scan is sent from there ("See results" or
 * "Skip"). A skip sends no field; nothing ever sends a default.
 */
const SCAN_ID = "623e4567-e89b-12d3-a456-426614174010";

/** Collects every POST to /api/scans and answers 201 (or what `answer` says). */
async function captureScans(
  page: Page,
  answer: (n: number) => { status: number; body: unknown } = () => ({
    status: 201,
    body: { scanId: SCAN_ID },
  }),
) {
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/scans", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    bodies.push(JSON.parse(route.request().postData() ?? "{}"));
    const { status, body } = answer(bodies.length);
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  return bodies;
}

const sheet = (page: Page) =>
  page.getByRole("dialog", { name: "Hand measured" });
const gripPage = (page: Page) =>
  page.getByRole("dialog", { name: "How you hold a mouse" });
const thicknessPage = (page: Page) =>
  page.getByRole("dialog", { name: "Palm thickness" });

async function openGripPage(page: Page) {
  await page.goto("/scan/easy/measured-demo");
  await expect(sheet(page)).toBeVisible();
  await sheet(page).getByRole("button", { name: "Continue" }).click();
  await expect(gripPage(page)).toBeVisible();
}

async function toThicknessPage(page: Page, grip: string | null) {
  await openGripPage(page);
  if (grip) {
    await gripPage(page)
      .getByRole("radio", { name: new RegExp(`^${grip}`) })
      .check();
    await gripPage(page).getByRole("button", { name: "Confirm" }).click();
  } else {
    await gripPage(page).getByRole("button", { name: "Skip" }).click();
  }
  await expect(thicknessPage(page)).toBeVisible();
}

test.describe("/scan/easy/measured-demo — the measured bottom sheet", () => {
  test("shows the dimension lines and one Continue button; the grip options moved to their own page", async ({
    page,
  }) => {
    await page.goto("/scan/easy/measured-demo");
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page)).toContainText("Hand measured");
    await expect(page.getByText("Hand 190 mm")).toBeVisible();
    await expect(page.getByText("Palm 84 mm")).toBeVisible();
    await expect(
      sheet(page).getByRole("button", { name: "Continue" }),
    ).toBeVisible();
    await expect(sheet(page).locator(".easyGripChip")).toHaveCount(0);
    await expect(sheet(page).getByText(/hold a mouse/i)).toHaveCount(0);
    await expect(
      sheet(page).getByRole("button", { name: "Not sure" }),
    ).toHaveCount(0);
  });

  test("Continue sends nothing: the scan is only sent from the last page", async ({
    page,
  }) => {
    const bodies = await captureScans(page);
    await openGripPage(page);
    await gripPage(page).getByRole("radio", { name: /^Claw/ }).check();
    await gripPage(page).getByRole("button", { name: "Confirm" }).click();
    await expect(thicknessPage(page)).toBeVisible();
    await page.waitForTimeout(300);
    expect(bodies).toHaveLength(0);
  });

  test("the retake icon button closes the measured sheet", async ({ page }) => {
    await page.goto("/scan/easy/measured-demo");
    await expect(sheet(page)).toBeVisible();
    await page.getByRole("button", { name: "Retake photo" }).click();
    await expect(sheet(page)).toBeHidden();
  });
});

test.describe("the grip page (1 of 2)", () => {
  test("nothing is chosen: the question mark shows, Confirm is disabled, Skip and Back are there", async ({
    page,
  }) => {
    await openGripPage(page);
    const dialog = gripPage(page);
    await expect(
      dialog.getByRole("heading", { name: "How you hold a mouse" }),
    ).toBeFocused();
    await expect(dialog.getByRole("radio")).toHaveCount(3);
    for (const radio of await dialog.getByRole("radio").all())
      await expect(radio).not.toBeChecked();
    await expect(
      dialog.getByRole("button", { name: "Confirm" }),
    ).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Skip" })).toBeEnabled();
    await expect(dialog.getByRole("button", { name: "Back" })).toBeEnabled();
    await expect(dialog.getByText("Step 1 of 2")).toBeAttached();
    await expect(dialog.getByTestId("grip-art-neutral")).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  test("choosing a row swaps the picture and enables Confirm", async ({
    page,
  }) => {
    await openGripPage(page);
    const dialog = gripPage(page);
    for (const [row, art] of [
      ["Palm", "palm"],
      ["Claw", "claw"],
      ["Fingertip", "fingertip"],
    ] as const) {
      await dialog.getByRole("radio", { name: new RegExp(`^${row}`) }).check();
      await expect(dialog.getByTestId(`grip-art-${art}`)).toHaveAttribute(
        "data-active",
        "true",
      );
      await expect(dialog.getByTestId("grip-art-neutral")).toHaveAttribute(
        "data-active",
        "false",
      );
      await expect(
        dialog.getByRole("button", { name: "Confirm" }),
      ).toBeEnabled();
    }
    // The pictures really are loaded line art (an SVG's natural size is
    // its own business; what matters is that each one decoded).
    const loaded = await dialog.locator("img.gripImage").evaluateAll((imgs) =>
      imgs.map((img) => {
        const el = img as HTMLImageElement;
        return el.complete && el.naturalWidth > 0;
      }),
    );
    expect(loaded).toEqual([true, true, true]);
  });

  test("the arrow keys move through the rows like any radio group", async ({
    page,
  }) => {
    await openGripPage(page);
    const dialog = gripPage(page);
    await dialog.getByRole("radio", { name: /^Palm/ }).check();
    await dialog.getByRole("radio", { name: /^Palm/ }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(dialog.getByRole("radio", { name: /^Claw/ })).toBeChecked();
    await expect(dialog.getByTestId("grip-art-claw")).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  test("Back returns to the sheet and the next Continue finds the answer kept", async ({
    page,
  }) => {
    await openGripPage(page);
    await gripPage(page)
      .getByRole("radio", { name: /^Fingertip/ })
      .check();
    await gripPage(page).getByRole("button", { name: "Back" }).click();
    await expect(gripPage(page)).toBeHidden();
    await expect(sheet(page)).toBeVisible();
    await sheet(page).getByRole("button", { name: "Continue" }).click();
    await expect(
      gripPage(page).getByRole("radio", { name: /^Fingertip/ }),
    ).toBeChecked();
  });

  test("Escape is Back", async ({ page }) => {
    await openGripPage(page);
    await page.keyboard.press("Escape");
    await expect(gripPage(page)).toBeHidden();
    await expect(sheet(page)).toBeVisible();
  });
});

test.describe("the palm-thickness page (2 of 2)", () => {
  test("nothing is chosen: See results is disabled, Skip is there, and the hand has no moving part", async ({
    page,
  }) => {
    await toThicknessPage(page, null);
    const dialog = thicknessPage(page);
    await expect(dialog.getByText("Step 2 of 2")).toBeAttached();
    await expect(dialog.getByRole("radio")).toHaveCount(3);
    await expect(
      dialog.getByRole("button", { name: "See results", exact: true }),
    ).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Skip" })).toBeEnabled();
    await expect(dialog.locator("svg.thicknessHand")).toBeVisible();
    await expect(dialog.locator("svg.thicknessHand circle")).not.toHaveCount(0);
  });

  test("Back goes to the grip page and keeps both answers", async ({
    page,
  }) => {
    await toThicknessPage(page, "Claw");
    await thicknessPage(page).getByRole("radio", { name: /^Thin/ }).check();
    await thicknessPage(page).getByRole("button", { name: "Back" }).click();
    await expect(gripPage(page)).toBeVisible();
    await expect(
      gripPage(page).getByRole("radio", { name: /^Claw/ }),
    ).toBeChecked();
    await gripPage(page).getByRole("button", { name: "Confirm" }).click();
    await expect(
      thicknessPage(page).getByRole("radio", { name: /^Thin/ }),
    ).toBeChecked();
  });

  test("both answered: the scan is sent once, from here, with both fields", async ({
    page,
  }) => {
    const bodies = await captureScans(page);
    await toThicknessPage(page, "Claw");
    await thicknessPage(page)
      .getByRole("radio", { name: /^Thick/ })
      .check();
    await thicknessPage(page)
      .getByRole("button", { name: "See results", exact: true })
      .click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0].gripStyleStated).toBe("claw");
    expect(bodies[0].palmThicknessStated).toBe("thick");
    await expect(page).toHaveURL(new RegExp(`/results/${SCAN_ID}`), {
      timeout: 30_000,
    });
  });

  test("grip skipped and thickness skipped: neither field is in the request", async ({
    page,
  }) => {
    const bodies = await captureScans(page);
    await toThicknessPage(page, null);
    await thicknessPage(page).getByRole("button", { name: "Skip" }).click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).not.toHaveProperty("gripStyleStated");
    expect(bodies[0]).not.toHaveProperty("palmThicknessStated");
    expect(JSON.stringify(bodies[0])).not.toContain("medium");
  });

  test("grip chosen, thickness skipped: only the grip is sent", async ({
    page,
  }) => {
    const bodies = await captureScans(page);
    await toThicknessPage(page, "Palm");
    await thicknessPage(page).getByRole("button", { name: "Skip" }).click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0].gripStyleStated).toBe("palm");
    expect(bodies[0]).not.toHaveProperty("palmThicknessStated");
  });

  test("a thickness chosen and then skipped is not sent either", async ({
    page,
  }) => {
    const bodies = await captureScans(page);
    await toThicknessPage(page, null);
    await thicknessPage(page)
      .getByRole("radio", { name: /^Medium/ })
      .check();
    await thicknessPage(page).getByRole("button", { name: "Skip" }).click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).not.toHaveProperty("palmThicknessStated");
  });

  test("a failed send shows the reason on the page, keeps the answers, and can be tried again", async ({
    page,
  }) => {
    const bodies = await captureScans(page, (n) =>
      n === 1
        ? { status: 500, body: { error: "boom" } }
        : { status: 201, body: { scanId: SCAN_ID } },
    );
    await toThicknessPage(page, "Claw");
    const dialog = thicknessPage(page);
    await dialog.getByRole("radio", { name: /^Thin/ }).check();
    await dialog
      .getByRole("button", { name: "See results", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Something went wrong on our end",
    );
    // The veil fades out again over the error and its retry (F13).
    await expect(dialog.getByTestId("submit-overlay")).toHaveCount(0);
    await expect(dialog.getByRole("radio", { name: /^Thin/ })).toBeChecked();
    await expect(
      dialog.getByRole("button", { name: "See results", exact: true }),
    ).toBeEnabled();
    await dialog
      .getByRole("button", { name: "See results", exact: true })
      .click();
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[1].palmThicknessStated).toBe("thin");
    await expect(page).toHaveURL(new RegExp(`/results/${SCAN_ID}`), {
      timeout: 30_000,
    });
  });

  test("while the scan is sent the controls are off, the button keeps its word and the veil is up (F13)", async ({
    page,
  }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/scans", async (route) => {
      await gate;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ scanId: SCAN_ID }),
      });
    });
    await toThicknessPage(page, null);
    const dialog = thicknessPage(page);
    await dialog.getByRole("radio", { name: /^Medium/ }).check();
    await dialog
      .getByRole("button", { name: "See results", exact: true })
      .click();
    // V3.2 F13: never 「傳送中／Sending」; the veil with the loader instead.
    await expect(
      dialog.getByRole("button", { name: "See results", exact: true }),
    ).toBeDisabled();
    await expect(dialog.getByText(/Sending/)).toHaveCount(0);
    await expect(dialog.getByTestId("submit-overlay")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Skip" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Back" })).toBeDisabled();
    release();
    // After the 201 the veil stays until the results page replaces this one
    // (busy counts "success" too); it never fades back to the page.
    await expect(dialog.getByTestId("submit-overlay")).toHaveAttribute(
      "data-phase",
      "shown",
    );
    await expect(page).toHaveURL(new RegExp(`/results/${SCAN_ID}`), {
      timeout: 30_000,
    });
  });
});

test.describe("both pages: touch targets, focus and motion", () => {
  test("Back, Skip, the rows and the main button are at least 44 px tall and wide enough", async ({
    page,
  }) => {
    await openGripPage(page);
    const box = async (loc: ReturnType<Page["locator"]>) => {
      const b = await loc.boundingBox();
      return b!;
    };
    const dialog = gripPage(page);
    for (const name of ["Back", "Skip", "Confirm"]) {
      const b = await box(dialog.getByRole("button", { name }));
      expect(b.height, name).toBeGreaterThanOrEqual(44);
      expect(b.width, name).toBeGreaterThanOrEqual(44);
    }
    for (const row of await dialog.locator(".answerChoiceBody").all()) {
      const b = await box(row);
      expect(b.height).toBeGreaterThanOrEqual(44);
    }
    // Back and Skip are wider than their words: the hit area is the box.
    const back = await box(dialog.getByRole("button", { name: "Back" }));
    expect(back.width).toBeGreaterThan(60);
    const skip = await box(dialog.getByRole("button", { name: "Skip" }));
    expect(skip.width).toBeGreaterThan(200);
  });

  test("keyboard focus shows a ring on a row, Back and the buttons", async ({
    page,
  }) => {
    await openGripPage(page);
    // The page opens with its title focused; Tab goes on to the first row.
    await page.keyboard.press("Tab");
    const ring = async () =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const body = el.classList.contains("answerChoiceInput")
          ? (el.nextElementSibling as HTMLElement)
          : el;
        const style = getComputedStyle(body);
        return {
          tag: el.tagName,
          style: style.outlineStyle,
          width: parseFloat(style.outlineWidth),
        };
      });
    const onRow = await ring();
    expect(onRow.tag).toBe("INPUT");
    expect(onRow.style).toBe("solid");
    expect(onRow.width).toBeGreaterThanOrEqual(2);
    await page.keyboard.press("Space"); // chooses it, which enables Confirm
    await page.keyboard.press("Tab");
    const onConfirm = await ring();
    expect(onConfirm.style).toBe("solid");
    expect(onConfirm.width).toBeGreaterThanOrEqual(2);
    await page.keyboard.press("Tab");
    const onSkip = await ring();
    expect(onSkip.style).toBe("solid");
    expect(onSkip.width).toBeGreaterThanOrEqual(2);
  });

  test("reduced motion: the picture only fades (no transform), and a normal one also scales", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openGripPage(page);
    const props = (testId: string) =>
      gripPage(page)
        .getByTestId(testId)
        .evaluate((el) => {
          const s = getComputedStyle(el);
          return { property: s.transitionProperty, transform: s.transform };
        });
    expect((await props("grip-art-claw")).property).toBe("opacity");
    expect((await props("grip-art-claw")).transform).toBe("none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const normal = await props("grip-art-claw");
    expect(normal.property).toContain("opacity");
    expect(normal.property).toContain("transform");
    expect(normal.transform).not.toBe("none");
  });

  test("the selected row is marked by more than colour: a check in a filled circle", async ({
    page,
  }) => {
    await openGripPage(page);
    const dialog = gripPage(page);
    await dialog.getByRole("radio", { name: /^Claw/ }).check();
    await page.emulateMedia({ reducedMotion: "reduce" });
    const [chosen, other] = await Promise.all([
      dialog
        .locator(
          ".answerChoiceInput:checked + .answerChoiceBody .answerRadioCheck",
        )
        .evaluate((el) => getComputedStyle(el).opacity),
      dialog
        .locator(
          ".answerChoiceInput:not(:checked) + .answerChoiceBody .answerRadioCheck",
        )
        .first()
        .evaluate((el) => getComputedStyle(el).opacity),
    ]);
    expect(chosen).toBe("1");
    expect(other).toBe("0");
  });

  for (const [width, height] of [
    [390, 844],
    [360, 640],
  ] as const) {
    test(`${width}x${height}: the three rows and the main button fit on the grip page without scrolling`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await openGripPage(page);
      const m = await gripPage(page).evaluate((dialog) => {
        const primary = dialog.querySelector<HTMLElement>(".answerPrimary")!;
        const skip = dialog.querySelector<HTMLElement>(".answerSkip")!;
        return {
          scrolls: dialog.scrollHeight > dialog.clientHeight + 1,
          primaryBottom: primary.getBoundingClientRect().bottom,
          skipBottom: skip.getBoundingClientRect().bottom,
          viewport: window.innerHeight,
        };
      });
      expect(m.scrolls).toBe(false);
      expect(m.skipBottom).toBeLessThanOrEqual(m.viewport);
    });
  }
});

test.describe("the browser closing the question page by itself", () => {
  test("Esc twice from the thickness page goes thickness -> grip -> sheet, and there is always a dialog", async ({
    page,
  }) => {
    await toThicknessPage(page, "Claw");
    const openDialogs = () => page.locator("dialog[open]").count();
    await page.keyboard.press("Escape");
    await expect(gripPage(page)).toBeVisible();
    expect(await openDialogs()).toBeGreaterThan(0);
    // The second Esc has no tap before it: Chromium may close the dialog
    // without asking, which is what the page has to survive.
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeVisible();
    await expect(gripPage(page)).toBeHidden();
    await expect(thicknessPage(page)).toBeHidden();
    expect(await openDialogs()).toBeGreaterThan(0);
    // And the way forward is still there, with the answers kept.
    await sheet(page).getByRole("button", { name: "Continue" }).click();
    await expect(
      gripPage(page).getByRole("radio", { name: /^Claw/ }),
    ).toBeChecked();
  });

  test("a close the page did not ask for (the dialog closed from outside) is taken as Back", async ({
    page,
  }) => {
    await toThicknessPage(page, "Palm");
    await thicknessPage(page).getByRole("radio", { name: /^Thin/ }).check();
    // What a non-cancelable Esc or the Android back gesture does.
    await page.evaluate(() =>
      document.querySelector<HTMLDialogElement>("dialog.answerDialog")!.close(),
    );
    await expect(gripPage(page)).toBeVisible();
    await expect(
      gripPage(page).getByRole("radio", { name: /^Palm/ }),
    ).toBeChecked();
    await page.evaluate(() =>
      document.querySelector<HTMLDialogElement>("dialog.answerDialog")!.close(),
    );
    await expect(sheet(page)).toBeVisible();
    await expect(gripPage(page)).toBeHidden();
  });

  test("while the scan is sent Esc does not go back, and a close from outside opens the page again", async ({
    page,
  }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/scans", async (route) => {
      await gate;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ scanId: SCAN_ID }),
      });
    });
    await toThicknessPage(page, null);
    const dialog = thicknessPage(page);
    await dialog.getByRole("radio", { name: /^Medium/ }).check();
    await dialog
      .getByRole("button", { name: "See results", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "See results", exact: true }),
    ).toBeDisabled();
    await expect(dialog.getByTestId("submit-overlay")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(gripPage(page)).toBeHidden();
    await page.evaluate(() =>
      document.querySelector<HTMLDialogElement>("dialog.answerDialog")!.close(),
    );
    await expect(dialog).toBeVisible();
    release();
    await expect(page).toHaveURL(new RegExp(`/results/${SCAN_ID}`), {
      timeout: 30_000,
    });
  });
});

test.describe("coming back to the sheet, scrolling, focus and the failure banner", () => {
  test("Back to the sheet: no new slide-in, and focus is on Continue; the first arrival does slide", async ({
    page,
  }) => {
    await page.goto("/scan/easy/measured-demo");
    await expect(sheet(page)).toBeVisible();
    const animation = () =>
      sheet(page).evaluate((el) => getComputedStyle(el).animationName);
    expect(await animation()).toBe("easySheetSlideIn");
    await sheet(page).getByRole("button", { name: "Continue" }).click();
    await expect(gripPage(page)).toBeVisible();
    await gripPage(page).getByRole("button", { name: "Back" }).click();
    await expect(sheet(page)).toBeVisible();
    expect(await animation()).toBe("none");
    await expect(
      sheet(page).getByRole("button", { name: "Continue" }),
    ).toBeFocused();
  });

  test("under reduced motion the sheet never slides (it fades in on arrival, and not at all on return)", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/scan/easy/measured-demo");
    await expect(sheet(page)).toBeVisible();
    const animation = () =>
      sheet(page).evaluate((el) => getComputedStyle(el).animationName);
    expect(await animation()).not.toBe("easySheetSlideIn");
    await sheet(page).getByRole("button", { name: "Continue" }).click();
    await gripPage(page).getByRole("button", { name: "Back" }).click();
    await expect(sheet(page)).toBeVisible();
    expect(await animation()).toBe("none");
  });

  test("a new page starts at the top, even on a screen too short for the page", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 300 });
    await openGripPage(page);
    const dialog = gripPage(page);
    await dialog.getByRole("radio", { name: /^Palm/ }).check();
    const scrolled = await dialog.evaluate((el) => {
      el.scrollTop = 120;
      return el.scrollTop;
    });
    expect(scrolled).toBeGreaterThan(0);
    await dialog.getByRole("button", { name: "Confirm" }).click();
    await expect(thicknessPage(page)).toBeVisible();
    expect(await thicknessPage(page).evaluate((el) => el.scrollTop)).toBe(0);
  });

  test("a failed send puts focus back on See results; with no row chosen, on Skip", async ({
    page,
  }) => {
    await captureScans(page, () => ({ status: 500, body: { error: "boom" } }));
    await toThicknessPage(page, null);
    const dialog = thicknessPage(page);
    await dialog.getByRole("radio", { name: /^Thin/ }).check();
    await dialog
      .getByRole("button", { name: "See results", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "See results", exact: true }),
    ).toBeFocused();
    // The skip button: its visible word is Skip, its name says what it does.
    await expect(dialog.getByTestId("thickness-skip")).toHaveText("Skip");
    await expect(
      dialog.getByRole("button", { name: "Skip and see results" }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Skip and see results" }).click();
    await expect(dialog.getByTestId("thickness-skip")).toBeFocused();
  });

  for (const [status, kind] of [
    [400, "invalid"],
    [413, "tooLarge"],
  ] as const) {
    test(`a ${kind} failure shows Retake photo in the banner: it resets everything and leaves the pages`, async ({
      page,
    }) => {
      const bodies = await captureScans(page, () => ({
        status,
        body: { error: "no" },
      }));
      await toThicknessPage(page, "Claw");
      const dialog = thicknessPage(page);
      await dialog.getByRole("radio", { name: /^Thin/ }).check();
      await dialog
        .getByRole("button", { name: "See results", exact: true })
        .click();
      await expect.poll(() => bodies.length).toBe(1);
      const retake = dialog.getByTestId("thickness-retake");
      await expect(retake).toBeVisible();
      await expect(retake).toHaveText("Retake photo");
      const b = await retake.boundingBox();
      expect(b!.height).toBeGreaterThanOrEqual(44);
      // Focus is on See results after the failure; Shift+Tab reaches the
      // banner's button, by keyboard, so its focus ring shows.
      await page.keyboard.press("Shift+Tab");
      await expect(retake).toBeFocused();
      expect(
        await retake.evaluate((el) => getComputedStyle(el).outlineStyle),
      ).toBe("solid");
      await retake.click();
      await expect(dialog).toBeHidden();
      await expect(sheet(page)).toBeHidden();
      // Nothing was sent again.
      expect(bodies).toHaveLength(1);
    });
  }

  test("the other failures have no Retake button in the banner", async ({
    page,
  }) => {
    await toThicknessPage(page, null);
    const dialog = thicknessPage(page);
    await dialog.getByRole("radio", { name: /^Thin/ }).check();
    for (const status of [429, 500]) {
      await page.unroute("**/api/scans");
      await captureScans(page, () => ({ status, body: { error: "no" } }));
      await dialog
        .getByRole("button", { name: "See results", exact: true })
        .click();
      await expect(dialog.getByRole("alert")).toBeVisible();
      await expect(dialog.getByTestId("thickness-retake")).toHaveCount(0);
    }
  });
});

test.describe("short screens: the main button and Skip are on the first screen", () => {
  for (const [width, height] of [
    [360, 640],
    [320, 568],
    [667, 375],
  ] as const) {
    for (const which of ["grip", "thickness"] as const) {
      test(`${width}x${height}: the ${which} page needs no scrolling to reach its buttons`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height });
        if (which === "grip") await openGripPage(page);
        else await toThicknessPage(page, null);
        const dialog = which === "grip" ? gripPage(page) : thicknessPage(page);
        const m = await dialog.evaluate((el) => {
          const primary = el.querySelector<HTMLElement>(".answerPrimary")!;
          const skip = el.querySelector<HTMLElement>(".answerSkip")!;
          const back = el.querySelector<HTMLElement>(".answerBack")!;
          return {
            scrolls: el.scrollHeight > el.clientHeight + 1,
            overflowsX: el.scrollWidth > el.clientWidth + 1,
            primaryBottom: primary.getBoundingClientRect().bottom,
            skipBottom: skip.getBoundingClientRect().bottom,
            backTop: back.getBoundingClientRect().top,
            viewport: window.innerHeight,
          };
        });
        console.log(
          `${width}x${height} ${which}: primary bottom ${m.primaryBottom.toFixed(0)}, skip bottom ${m.skipBottom.toFixed(0)} of ${m.viewport}, scrolls ${m.scrolls}`,
        );
        expect(m.primaryBottom).toBeLessThanOrEqual(m.viewport);
        expect(m.skipBottom).toBeLessThanOrEqual(m.viewport);
        expect(m.backTop).toBeGreaterThanOrEqual(0);
        expect(m.overflowsX).toBe(false);
      });
    }
  }
});

test.describe("the typed-length path stores the length only after the scan was stored", () => {
  const lengthKey = `open-mouse:user-length:${SCAN_ID}`;
  const lengthKeys = (page: Page) =>
    page.evaluate(() =>
      Object.keys(localStorage).filter((k) =>
        k.startsWith("open-mouse:user-length:"),
      ),
    );

  test("201: the typed length is kept under the scan's key, and both answers are in the POST", async ({
    page,
  }) => {
    const bodies = await captureScans(page);
    await page.goto("/scan/easy/measured-length-demo");
    await expect(sheet(page)).toBeVisible();
    await sheet(page).getByRole("button", { name: "Continue" }).click();
    await gripPage(page)
      .getByRole("radio", { name: /^Fingertip/ })
      .check();
    await gripPage(page).getByRole("button", { name: "Confirm" }).click();
    await thicknessPage(page)
      .getByRole("radio", { name: /^Thick/ })
      .check();
    await thicknessPage(page)
      .getByRole("button", { name: "See results", exact: true })
      .click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0].gripStyleStated).toBe("fingertip");
    expect(bodies[0].palmThicknessStated).toBe("thick");
    expect((bodies[0].calibration as { method: string }).method).toBe(
      "user-length",
    );
    await expect(page).toHaveURL(new RegExp(`/results/${SCAN_ID}`), {
      timeout: 30_000,
    });
    expect(
      await page.evaluate((key) => localStorage.getItem(key), lengthKey),
    ).toBe("186");
  });

  test("a failed send (500) writes nothing", async ({ page }) => {
    await captureScans(page, () => ({ status: 500, body: { error: "boom" } }));
    await page.goto("/scan/easy/measured-length-demo");
    await expect(sheet(page)).toBeVisible();
    await sheet(page).getByRole("button", { name: "Continue" }).click();
    await gripPage(page).getByRole("button", { name: "Skip" }).click();
    await thicknessPage(page)
      .getByRole("button", { name: "Skip and see results" })
      .click();
    await expect(thicknessPage(page).getByRole("alert")).toBeVisible();
    expect(await lengthKeys(page)).toEqual([]);
  });
});
