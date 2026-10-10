import { timePromises } from "./fixtures/time-promise";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";
import { scanPath } from "../../src/lib/contracts/routes";
import { RESULTS_VIEWER_ENABLED } from "../../src/lib/results/features";
import { contrast } from "./fixtures/contrast";
import { scoreFit } from "../../src/server/fit/score";
import type { CatalogueMouse } from "../../src/server/fit/types";

// Read as plain JSON rather than `import ... from "*.json"` — Playwright's
// test runner loads spec files as native Node ESM, which requires an
// `type: "json"` import attribute Node's resolver doesn't universally
// support yet; reading the file directly sidesteps that.
const highConfidenceFixture: unknown = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        "../../src/components/results/fixtures/high-confidence.json",
        import.meta.url,
      ),
    ),
    "utf-8",
  ),
);

/**
 * The fit and analysis routes (#27, #28) don't exist yet — every test here
 * stubs them with `page.route`, per issue #30's instruction to build and
 * test against the contract without waiting for the backend.
 */
const SCAN_ID = "a1b2c3d4-1111-4a2b-8c3d-9e0f1a2b3c4d";
const FIT_URL = `**/api/scans/${SCAN_ID}/fit`;
const ANALYSIS_URL = `**/api/scans/${SCAN_ID}/analysis`;
const HAND_KEY = `openMouse.resultHand.${SCAN_ID}`;
const LENGTH_KEY = `open-mouse:user-length:${SCAN_ID}`;

const READY_ANALYSIS_MODEL = {
  output: {
    headline: "A close match for your palm grip",
    whyTopPick:
      "The top pick's length and grip width both land close to your ideal.",
    tradeoffs: ["It runs slightly heavier than you prefer."],
    whatToAvoid: ["Mice with an aggressive back hump."],
    caveats: [],
  },
  source: "model",
  cached: false,
};

/** The one source line there is: under template-written text (AnalysisSlot). */
const TEMPLATE_LINE = "Generated automatically from your scores above.";

const READY_ANALYSIS_FALLBACK = {
  ...READY_ANALYSIS_MODEL,
  source: "fallback",
};

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

/**
 * The Details section is closed by default. Open it to reach the sub-scores,
 * the written analysis and the 3D viewer.
 */
async function openDetails(page: Page) {
  const details = page.locator(".results-details");
  await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
}

async function stubHappyFit(page: Page) {
  await page.route(FIT_URL, (route) =>
    fulfillJson(route, 200, highConfidenceFixture),
  );
}

/** What the fit route returns for a left-hand scan: the hand is part of the
 * response (#62), so nothing needs to be in browser storage. */
async function stubLeftHandFit(page: Page) {
  await page.route(FIT_URL, (route) =>
    fulfillJson(route, 200, {
      ...(highConfidenceFixture as object),
      hand: "left",
    }),
  );
}

test("a new tab shows the typed-length note from storage and the left-hand note from the fit response, then deletion clears the stored keys", async ({
  page,
  context,
}) => {
  await stubHappyFit(page);
  await page.route(ANALYSIS_URL, (route) =>
    fulfillJson(route, 200, READY_ANALYSIS_MODEL),
  );
  await page.goto(`/results/${SCAN_ID}`);
  // Only the typed length lives in storage; the hand is not stored at all.
  await page.evaluate(
    ([lengthKey]) => localStorage.setItem(lengthKey, "190"),
    [LENGTH_KEY],
  );

  const newTab = await context.newPage();
  await stubLeftHandFit(newTab);
  await newTab.route(ANALYSIS_URL, (route) =>
    fulfillJson(route, 200, READY_ANALYSIS_MODEL),
  );
  await newTab.route(`**${scanPath(SCAN_ID)}`, (route) =>
    route.fulfill({ status: 204 }),
  );
  await newTab.goto(`/results/${SCAN_ID}`);
  await expect(
    newTab.getByText(/Based on the hand length you entered \(190\u00A0mm\)/),
  ).toBeVisible();
  await expect(newTab.getByText(/Left-hand fit isn't rated yet/)).toBeVisible();
  // The no-paper disclosure sits right after the top pick, styled like the
  // left-hand notice, not in the page-bottom footnote.
  await expect(
    newTab.locator(".results-handNotice", {
      hasText:
        "Based on the hand length you entered (190 mm). Measured without paper.",
    }),
  ).toHaveCount(1);
  // The page carries no early-preview notice any more (the site footer does).
  await expect(newTab.locator(".results-previewNotice")).toHaveCount(0);
  expect(
    await newTab.evaluate(() => {
      const follows = (a: Element, b: Element) =>
        Boolean(
          a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
      const [disclosure, leftHand] = [
        ...document.querySelectorAll(".results-handNotice"),
      ];
      const analysis = document.querySelector(".results-analysis");
      return {
        beforeLeftHandNotice: follows(disclosure, leftHand),
        beforeAnalysis: analysis ? follows(disclosure, analysis) : false,
      };
    }),
  ).toEqual({ beforeLeftHandNotice: true, beforeAnalysis: true });
  await newTab.getByRole("button", { name: "Delete this scan now" }).click();
  await newTab.getByRole("button", { name: "Delete scan" }).click();
  await expect(
    newTab.getByRole("heading", { name: "This scan has been deleted" }),
  ).toBeVisible();
  expect(
    await newTab.evaluate(
      ([handKey, lengthKey]) => [
        localStorage.getItem(handKey),
        localStorage.getItem(lengthKey),
      ],
      [HAND_KEY, LENGTH_KEY],
    ),
  ).toEqual([null, null]);
  await newTab.close();
});

test("a typed length stored under an earlier, wider range still gets its note; an implausible one gets none", async ({
  page,
}) => {
  await stubHappyFit(page);
  await page.route(ANALYSIS_URL, (route) =>
    fulfillJson(route, 200, READY_ANALYSIS_MODEL),
  );
  for (const [stored, shown] of [
    ["120", true], // below today's input range, inside the schema's
    ["280", true],
    ["50", false],
    ["abc", false],
  ] as const) {
    await page.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      [LENGTH_KEY, stored],
    );
    await page.goto(`/results/${SCAN_ID}`);
    await expect(page.locator(".results-score-model")).toBeVisible();
    await expect(
      page.getByText(/Based on the hand length you entered/),
    ).toHaveCount(shown ? 1 : 0);
    if (shown)
      await expect(
        page.getByText(`(${stored} mm)`, { exact: false }),
      ).toBeVisible();
  }
});

// The written-analysis card had a white surface declared after its dark one,
// so in the dark theme its #f5f5f7 text sat on white (about 1.08:1). The site
// is one dark theme now, so there is a single surface to hold.
test("the written-analysis card keeps its contrast on the dark theme, in every state", async ({
  page,
}) => {
  const states: readonly (readonly [string, number, unknown])[] = [
    [
      "ready, written from the scores, with caveats",
      200,
      {
        ...READY_ANALYSIS_FALLBACK,
        output: {
          ...READY_ANALYSIS_FALLBACK.output,
          caveats: ["Early preview · measurements still being validated."],
        },
      },
    ],
    ["ready, written by a model", 200, READY_ANALYSIS_MODEL],
    ["error", 500, { error: "Unavailable" }],
    ["rate limited", 429, { error: "Too many requests" }],
  ];
  await stubHappyFit(page);
  for (const [state, status, body] of states) {
    await page.unroute(ANALYSIS_URL).catch(() => {});
    await page.route(ANALYSIS_URL, (route) => fulfillJson(route, status, body));
    await page.goto(`/results/${SCAN_ID}`);
    await openDetails(page);
    const card = page.locator(".results-analysis");
    await expect(card).toBeVisible();
    for (const scheme of ["dark"] as const) {
      // No transitions: a colour read mid-fade is neither state's.
      await page.emulateMedia({ reducedMotion: "reduce" });
      const texts = await card.evaluate((root) => {
        const opaque = (color: string) =>
          !/rgba\(.*, 0\)$|transparent/.test(color);
        const background = (el: Element): string => {
          for (let node: Element | null = el; node; node = node.parentElement) {
            const color = getComputedStyle(node).backgroundColor;
            if (opaque(color)) return color;
          }
          return "rgb(6, 7, 9)"; // --bg: the page behind the card
        };
        const found: { text: string; color: string; background: string }[] = [];
        for (const el of [root, ...root.querySelectorAll("*")]) {
          const own = [...el.childNodes]
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent!.trim())
            .join(" ")
            .trim();
          if (!own) continue;
          found.push({
            text: own.slice(0, 40),
            color: getComputedStyle(el).color,
            background: background(el),
          });
        }
        return found;
      });
      expect(texts.length, `${state} ${scheme}`).toBeGreaterThan(1);
      for (const t of texts)
        expect(
          contrast(t.color, t.background),
          `${state} / ${scheme} / "${t.text}"`,
        ).toBeGreaterThan(4.5);
    }
  }
});

test.describe("/results/[scanId] — real results page", () => {
  test("lists same-shell variants as text on the top pick, the other-pick card and its detail page", async ({
    page,
  }) => {
    const fixture = structuredClone(highConfidenceFixture) as {
      results: { variants?: unknown }[];
    };
    fixture.results[0].variants = [
      { slug: "gpx-se", model: "Superlight 2 SE", weightG: 59 },
    ];
    fixture.results[1].variants = [
      { slug: "da-v3-x", model: "DeathAdder V3 X", weightG: null },
      { slug: "da-v3-y", model: "DeathAdder V3 Y", weightG: null },
    ];
    await page.route(FIT_URL, (route) => fulfillJson(route, 200, fixture));
    await page.route(ANALYSIS_URL, (route) =>
      fulfillJson(route, 500, { error: "Unavailable" }),
    );
    await page.goto(`/results/${SCAN_ID}`);

    await expect(
      page.locator(".results-score-name .results-variants"),
    ).toHaveText("Same modeling: Superlight 2 SE");
    const card = page.locator(".results-card", { hasText: "DeathAdder V3" });
    await expect(card.locator(".results-variants")).toHaveText(
      "Same modeling: DeathAdder V3 X, DeathAdder V3 Y",
    );
    // Only the cards that have variants show the line; variants are not links.
    await expect(
      page.locator(".results-others-grid .results-variants"),
    ).toHaveCount(1);
    await expect(
      page.getByRole("link", { name: /Superlight 2 SE/ }),
    ).toHaveCount(0);

    await card.click();
    await expect(page).toHaveURL(
      new RegExp(`/results/${SCAN_ID}/m/razer-deathadder-v3$`),
    );
    await expect(
      page.locator(".results-score-name .results-variants"),
    ).toHaveText("Same modeling: DeathAdder V3 X, DeathAdder V3 Y");
    // The top pick is now a card on this page, with its own line.
    await expect(
      page.locator(".results-others-grid .results-variants"),
    ).toHaveText(["Same modeling: Superlight 2 SE"]);
  });

  test("the 3D viewer is hidden: opening Details shows no viewer and makes no measurements or model request", async ({
    page,
  }) => {
    test.skip(
      RESULTS_VIEWER_ENABLED,
      "Only while the viewer is hidden (src/lib/results/features.ts).",
    );
    const requested: string[] = [];
    page.on("request", (request) =>
      requested.push(new URL(request.url()).pathname),
    );
    await page.route(FIT_URL, (route) =>
      fulfillJson(route, 200, highConfidenceFixture),
    );
    await page.route(ANALYSIS_URL, (route) =>
      fulfillJson(route, 500, { error: "Unavailable" }),
    );
    await page.goto(`/results/${SCAN_ID}`);

    const details = page.locator(".results-details");
    await details.locator("summary").click();
    await expect(details).toHaveAttribute("open", "");
    await expect(details.locator(".results-subscoreGrid")).toBeVisible();
    await expect(details.locator(".results-disclosure-hint")).not.toContainText(
      "3D",
    );
    await expect(page.locator(".viewer")).toHaveCount(0);
    await expect(page.locator(".viewer-box")).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    expect(
      requested.filter((path) => /\/measurements$|draco/.test(path)),
    ).toEqual([]);
  });

  test("shows the left-hand disclosure, poor-fit line below 50, and ranked-list h2", async ({
    page,
  }) => {
    const fixture = structuredClone(highConfidenceFixture) as {
      results: { total: number }[];
    };
    fixture.results[0].total = 49;
    // A left-hand scan says so in the response, with nothing in storage.
    await page.route(FIT_URL, (route) =>
      fulfillJson(route, 200, { ...fixture, hand: "left" }),
    );
    await page.route(ANALYSIS_URL, (route) =>
      fulfillJson(route, 500, { error: "Unavailable" }),
    );
    await page.goto(`/results/${SCAN_ID}`);
    await expect(
      page.getByText(
        "None of these fits your hand well. The closest is below.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Left-hand fit isn't rated yet — check each mouse's shape before you buy.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Other picks" }),
    ).toBeVisible();
  });

  test("omits the poor-fit line at 50 and the left-hand disclosure for a right scan", async ({
    page,
  }) => {
    const fixture = structuredClone(highConfidenceFixture) as {
      results: { total: number }[];
    };
    fixture.results[0].total = 50;
    // A leftover key from a build that stored the hand must not decide the
    // note: the response says right, so there is none, and the key is dropped.
    await page.addInitScript(
      ([key]) => localStorage.setItem(key, "left"),
      [HAND_KEY],
    );
    await page.route(FIT_URL, (route) => fulfillJson(route, 200, fixture));
    await page.route(ANALYSIS_URL, (route) =>
      fulfillJson(route, 500, { error: "Unavailable" }),
    );
    await page.goto(`/results/${SCAN_ID}`);
    await expect(
      page.getByRole("heading", { level: 1, name: /G Pro X Superlight 2/ }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "None of these fits your hand well. The closest is below.",
      ),
    ).toHaveCount(0);
    await expect(page.getByText(/Left-hand fit isn't rated yet/)).toHaveCount(
      0,
    );
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), HAND_KEY))
      .toBeNull();
  });
  // G10: the catalogue now carries a hump for most mice, and nothing else about
  // their shape. This is the fit engine's own output for that state (not a
  // hand-edited fixture): the hump scored, flare and thumb unknown.
  test("hump rated, flare and thumb unrated: only the hump is rated, and the page still says some shape scores are not", async ({
    page,
  }) => {
    // Claw grip; targets: length 117.8, grip width 70.4, height 38.
    const humpOnly = (patch: Partial<CatalogueMouse>): CatalogueMouse => ({
      slug: "acme-alpha",
      brand: "Acme",
      model: "Alpha",
      lengthMm: 117.8,
      widthMm: 70.4,
      heightMm: 38,
      weightG: 80,
      size: "medium",
      handCompatibility: null,
      shape: null,
      humpPlacement: "back_moderate",
      frontFlare: null,
      sideCurvature: null,
      thumbRest: null,
      ringFingerRest: null,
      ...patch,
    });
    const fit = {
      scanId: SCAN_ID,
      ...scoreFit(
        { handLengthMm: 190, palmLengthMm: 110, palmWidthMm: 80 },
        [
          humpOnly({}),
          humpOnly({
            slug: "acme-beta",
            model: "Beta",
            lengthMm: 112,
            humpPlacement: "center",
          }),
        ],
        { includeVertical: false },
        "right",
      ),
    };
    await page.route(FIT_URL, (route) => fulfillJson(route, 200, fit));
    await page.route(ANALYSIS_URL, (route) =>
      fulfillJson(route, 500, { error: "Unavailable" }),
    );
    await page.goto(`/results/${SCAN_ID}`);

    const top = page.locator(".results-view");
    await expect(
      top.getByRole("heading", { level: 1, name: "Alpha" }),
    ).toBeVisible();
    await openDetails(page);
    const bar = (label: string) =>
      top.locator(".results-subscoreBar", { hasText: label });

    // The hump is rated: a score, and the hump sentence rather than a height one.
    await expect(
      bar("Height & hump").locator(".results-subscoreBar-value"),
    ).toHaveText("100");
    await expect(
      bar("Height & hump").locator(".results-subscoreBar-reason"),
    ).toHaveText("The hump position suits how you hold a mouse.");

    // Flare and thumb are not: no score, an empty bar, and the plain words.
    for (const label of ["Front flare", "Thumb support"]) {
      await expect(bar(label)).toHaveAttribute("data-assessed", "false");
      await expect(bar(label).locator(".results-subscoreBar-value")).toHaveText(
        "—",
      );
      await expect(bar(label).locator(".results-subscoreBar-fill")).toHaveCount(
        0,
      );
      await expect(
        bar(label).locator(".results-subscoreBar-reason"),
      ).toHaveText("Shape not rated yet");
    }

    // So the one honest line about unrated shape is still shown, and still true.
    await expect(top.locator(".results-sizeNotice")).toHaveText(
      "Some shape scores aren't rated yet for this mouse, so the fit score currently leans on its size.",
    );

    // The generic confidence note appears nowhere: not on the top pick, and
    // not on the other pick's own page (its confidence is above the low
    // threshold).
    await page.getByRole("link", { name: /Acme Beta/ }).click();
    await expect(page).toHaveURL(
      new RegExp(`/results/${SCAN_ID}/m/acme-beta$`),
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "Beta" }),
    ).toBeVisible();
    await openDetails(page);
    await expect(page.locator(".results-confidenceNote")).toHaveCount(0);
    await expect(
      page.getByText(/haven't assessed this mouse's shape/),
    ).toHaveCount(0);
  });

  test("renders the ranking as soon as the fit route resolves, then the written analysis once it resolves too", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await stubHappyFit(page);
    await page.route(ANALYSIS_URL, (route) =>
      fulfillJson(route, 200, READY_ANALYSIS_MODEL),
    );

    await page.goto(`/results/${SCAN_ID}`);

    await expect(
      page.getByRole("heading", { level: 1, name: /G Pro X Superlight 2/ }),
    ).toBeVisible();

    // Both share buttons are there: the link in the top bar and the primary
    // one (hero on a wide screen, under Other mice on a phone).
    await expect(
      page.locator('[data-testid="share-card-button"]:visible'),
    ).toHaveCount(2);
    await expect(
      page.locator(".results-topBar [data-testid='share-card-button']"),
    ).toBeVisible();

    await openDetails(page);
    await expect(
      page.getByRole("heading", { level: 3, name: "Why this one" }),
    ).toBeVisible();
    await expect(
      page.getByText("A close match for your palm grip"),
    ).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("shows the ranking immediately even while the analysis is still loading", async ({
    page,
  }) => {
    await stubHappyFit(page);
    // Never resolves within the test's lifetime — proves the ranking above
    // doesn't wait on it (acceptance criterion 2).
    await page.route(ANALYSIS_URL, () => {
      /* left pending */
    });

    await page.goto(`/results/${SCAN_ID}`);

    await expect(
      page.getByRole("heading", { level: 1, name: /G Pro X Superlight 2/ }),
    ).toBeVisible();
    // The analysis card is a status region. Scoped to it: the page has other
    // status regions (the confidence note, the viewer's fallback line).
    const loading = page.locator(".results-analysis-loading");
    await expect(loading).toHaveAttribute("role", "status");
    await expect(loading).toContainText(/Preparing/);
  });

  test("404 on the fit route (expired or foreign scan, per routes.ts's ownership rule) shows 'scan again', never a raw error", async ({
    page,
  }) => {
    await page.route(FIT_URL, (route) =>
      fulfillJson(route, 404, { error: "Scan not found" }),
    );

    await page.goto(`/results/${SCAN_ID}`);

    await expect(
      page.getByRole("heading", { name: "We couldn't find this scan" }),
    ).toBeVisible();
    // No hours or days in the promise (Kirby, 2026-09-30).
    await expect(page.locator(".results-page-error")).toContainText(
      "It may have expired, or the link isn't yours. Scans without an account expire automatically.",
    );
    expect(
      timePromises(await page.locator(".results-page-error").innerText()),
    ).toEqual([]);
    // Scoped to the error panel's own action — the TopBar above it also has
    // a "Scan again" link (its accessible name is "Back to Scan again"),
    // and an unscoped query matches both.
    const scanAgain = page
      .locator(".results-page-error")
      .getByRole("link", { name: "Scan again", exact: true });
    await expect(scanAgain).toBeVisible();
    await expect(scanAgain).toHaveAttribute("href", "/scan/easy");
    // Never shows the numeric ranking for a 404.
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0);
  });

  test("a network failure on the fit route shows 'try again', which retries the request", async ({
    page,
  }) => {
    let attempts = 0;
    await page.route(FIT_URL, async (route) => {
      attempts += 1;
      if (attempts === 1) {
        await route.abort("failed");
      } else {
        await fulfillJson(route, 200, highConfidenceFixture);
      }
    });
    await page.route(ANALYSIS_URL, (route) =>
      fulfillJson(route, 200, READY_ANALYSIS_MODEL),
    );

    await page.goto(`/results/${SCAN_ID}`);

    await expect(
      page.getByRole("heading", { name: "We couldn't reach the server" }),
    ).toBeVisible();
    const tryAgain = page.getByRole("button", { name: "Try again" });
    await expect(tryAgain).toBeVisible();

    await tryAgain.click();

    await expect(
      page.getByRole("heading", { level: 1, name: /G Pro X Superlight 2/ }),
    ).toBeVisible();
  });

  test("a 5xx on the fit route shows a generic 'something went wrong' with try again", async ({
    page,
  }) => {
    await page.route(FIT_URL, (route) =>
      fulfillJson(route, 500, { error: "internal error" }),
    );

    await page.goto(`/results/${SCAN_ID}`);

    await expect(
      page.getByRole("heading", { name: "Something went wrong" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  test("429 on the analysis route leaves the ranking fully visible and says to retry later, never blocking on it", async ({
    page,
  }) => {
    await stubHappyFit(page);
    await page.route(ANALYSIS_URL, (route) =>
      fulfillJson(route, 429, { error: "Too many requests" }),
    );

    await page.goto(`/results/${SCAN_ID}`);

    await expect(
      page.getByRole("heading", { level: 1, name: /G Pro X Superlight 2/ }),
    ).toBeVisible();
    await openDetails(page);
    await expect(page.getByText("How it scores")).toBeVisible();

    const alert = page
      .getByRole("alert")
      .filter({ hasText: "Written analysis" });
    await expect(alert).toContainText(/unaffected/);
    await expect(alert).toContainText(/try again in a few minutes/i);
  });

  test("honest provenance: a fallback-sourced analysis says it was written from the scores, and never shows internal vocabulary", async ({
    page,
  }) => {
    await stubHappyFit(page);
    await page.route(ANALYSIS_URL, (route) =>
      fulfillJson(route, 200, READY_ANALYSIS_FALLBACK),
    );

    await page.goto(`/results/${SCAN_ID}`);
    await openDetails(page);

    await expect(
      page.getByText("Generated automatically from your scores above."),
    ).toBeVisible();

    const bodyText = (await page.locator("body").innerText()).toLowerCase();
    for (const forbidden of ["fallback", "gemini", "llm", " model"]) {
      expect(bodyText).not.toContain(forbidden);
    }
  });

  // Kirby, 2026-09-30: no line about who wrote model text yet (an AI source
  // line comes later). Until then only a template-written analysis carries a
  // source line; a model-written one, fresh or cached, carries none.
  test("a model-written analysis shows no source line yet, and no internal vocabulary", async ({
    page,
  }) => {
    await stubHappyFit(page);
    await page.route(ANALYSIS_URL, (route) =>
      fulfillJson(route, 200, READY_ANALYSIS_MODEL),
    );

    await page.goto(`/results/${SCAN_ID}`);
    await openDetails(page);

    await expect(page.locator(".results-analysis-ready")).toBeVisible();
    await expect(page.getByText(TEMPLATE_LINE)).toHaveCount(0);
    await expect(page.locator(".results-analysis-provenance")).toHaveCount(0);

    const bodyText = (await page.locator("body").innerText()).toLowerCase();
    for (const forbidden of ["fallback", "gemini", "llm", " model"]) {
      expect(bodyText).not.toContain(forbidden);
    }
  });

  test("a cached model-written analysis shows no source line either", async ({
    page,
  }) => {
    await stubHappyFit(page);
    await page.route(ANALYSIS_URL, (route) =>
      fulfillJson(route, 200, { ...READY_ANALYSIS_MODEL, cached: true }),
    );

    await page.goto(`/results/${SCAN_ID}`);
    await openDetails(page);

    await expect(page.locator(".results-analysis-ready")).toBeVisible();
    await expect(page.getByText(TEMPLATE_LINE)).toHaveCount(0);
    await expect(page.locator(".results-analysis-provenance")).toHaveCount(0);
  });

  test("the error state of the analysis slot shows no source line", async ({
    page,
  }) => {
    await stubHappyFit(page);
    await page.route(ANALYSIS_URL, (route) =>
      fulfillJson(route, 500, { error: "internal error" }),
    );

    await page.goto(`/results/${SCAN_ID}`);
    await openDetails(page);

    await expect(
      page.getByRole("alert").filter({ hasText: "Written analysis" }),
    ).toBeVisible();
    await expect(page.getByText(TEMPLATE_LINE)).toHaveCount(0);
    await expect(page.locator(".results-analysis-provenance")).toHaveCount(0);
  });

  // The template sentence already wraps on a phone (and on a larger text
  // size), so its 14px icon has to sit on the FIRST line. The offset comes
  // from the line height, so it must hold when the browser's root font size
  // is larger than 16px, where a fixed offset drifts up.
  for (const rootPx of [16, 20, 24]) {
    test(`the template line's icon is centred on its first line at a ${rootPx}px root font size (390px wide)`, async ({
      page,
    }) => {
      await stubHappyFit(page);
      await page.route(ANALYSIS_URL, (route) =>
        fulfillJson(route, 200, READY_ANALYSIS_FALLBACK),
      );
      await page.setViewportSize({ width: 390, height: 900 });
      await page.goto(`/results/${SCAN_ID}`);
      await openDetails(page);
      await expect(page.getByText(TEMPLATE_LINE)).toBeVisible();
      await page.addStyleTag({ content: `html { font-size: ${rootPx}px; }` });

      const { iconCentre, firstLineCentre } = await page.evaluate(() => {
        const note = document.querySelector(".results-analysis-provenance")!;
        const icon = note.querySelector("svg")!.getBoundingClientRect();
        const box = note.getBoundingClientRect();
        return {
          iconCentre: icon.top + icon.height / 2 - box.top,
          firstLineCentre: parseFloat(getComputedStyle(note).lineHeight) / 2,
        };
      });
      expect(Math.abs(iconCentre - firstLineCentre)).toBeLessThan(0.75);
    });
  }

  // On a phone the template sentence wraps to two lines, and without
  // `text-wrap: pretty` the second can be a lone word ("above.", measured at
  // 360 and 390px wide). Chromium implements `pretty`.
  test("the template line never ends on a lone word on a phone (320 to 412 px wide)", async ({
    page,
  }) => {
    await stubHappyFit(page);
    await page.route(ANALYSIS_URL, (route) =>
      fulfillJson(route, 200, READY_ANALYSIS_FALLBACK),
    );
    await page.goto(`/results/${SCAN_ID}`);
    await openDetails(page);
    await expect(page.getByText(TEMPLATE_LINE)).toBeVisible();

    for (const width of [320, 360, 390, 412]) {
      await page.setViewportSize({ width, height: 900 });
      const wordsPerLine = await page.evaluate(() => {
        const note = document.querySelector(".results-analysis-provenance")!;
        const text = [...note.childNodes].find(
          (node): node is Text => node.nodeType === Node.TEXT_NODE,
        )!;
        const lines: number[] = [];
        let lastTop: number | null = null;
        for (const match of text.data.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(text, match.index!);
          range.setEnd(text, match.index! + match[0].length);
          const top = Math.round(range.getBoundingClientRect().top);
          if (top === lastTop) lines[lines.length - 1]++;
          else {
            lines.push(1);
            lastTop = top;
          }
        }
        return lines;
      });
      // On one line there is no last line to orphan.
      if (wordsPerLine.length > 1) {
        expect(
          wordsPerLine.at(-1),
          `at ${width}px: ${wordsPerLine}`,
        ).toBeGreaterThan(1);
      }
    }
  });
});

// Issue #42, acceptance criterion 2: "deleting is the user's choice". No real
// OAuth credentials exist in this environment (issue #17, matching
// account.spec.ts's own note), so `page.tsx`'s `auth()` call always resolves
// to no session here — every case below is exercising the anonymous branch,
// which is also the only branch that ever renders this action at all.
test.describe("/results/[scanId] — delete this scan now (issue #42)", () => {
  const SCAN_URL = `**${scanPath(SCAN_ID)}`;

  test("presses feedback with a confirmation, and focus lands on Cancel", async ({
    page,
  }) => {
    await stubHappyFit(page);
    await page.route(ANALYSIS_URL, (route) =>
      fulfillJson(route, 200, READY_ANALYSIS_MODEL),
    );
    await page.goto(`/results/${SCAN_ID}`);

    const trigger = page.getByRole("button", { name: "Delete this scan now" });
    await expect(trigger).toBeVisible();
    await trigger.click();

    await expect(
      page.getByRole("alertdialog", { name: "Delete this scan now?" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  });

  test("Cancel and Escape both close the dialog and return focus to the trigger, without deleting anything", async ({
    page,
  }) => {
    let deleteCalls = 0;
    await page.route(SCAN_URL, (route) => {
      deleteCalls += 1;
      return route.fulfill({ status: 204 });
    });
    await stubHappyFit(page);
    await page.route(ANALYSIS_URL, (route) =>
      fulfillJson(route, 200, READY_ANALYSIS_MODEL),
    );
    await page.goto(`/results/${SCAN_ID}`);

    const trigger = page.getByRole("button", { name: "Delete this scan now" });

    await trigger.click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await trigger.click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();

    expect(deleteCalls).toBe(0);
  });

  test("confirming deletes this scan and shows the deleted state, with focus on its heading", async ({
    page,
  }) => {
    let method = "";
    await page.route(SCAN_URL, (route) => {
      method = route.request().method();
      return route.fulfill({ status: 204 });
    });
    await stubHappyFit(page);
    await page.route(ANALYSIS_URL, (route) =>
      fulfillJson(route, 200, READY_ANALYSIS_MODEL),
    );
    await page.goto(`/results/${SCAN_ID}`);

    await page.getByRole("button", { name: "Delete this scan now" }).click();
    await page.getByRole("button", { name: "Delete scan" }).click();

    const heading = page.getByRole("heading", {
      name: "This scan has been deleted",
    });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await expect(page.getByText("permanently removed")).toBeVisible();
    const scanAgain = page.getByRole("link", { name: "Scan again" });
    await expect(scanAgain).toHaveAttribute("href", "/scan/easy");
    // The ranking is gone — deleted really replaces the page, not just a toast.
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0);

    expect(method).toBe("DELETE");
  });

  test("a failed delete names the problem, gives one fix, and leaves the dialog open to retry", async ({
    page,
  }) => {
    await page.route(SCAN_URL, (route) => route.fulfill({ status: 500 }));
    await stubHappyFit(page);
    await page.route(ANALYSIS_URL, (route) =>
      fulfillJson(route, 200, READY_ANALYSIS_MODEL),
    );
    await page.goto(`/results/${SCAN_ID}`);

    await page.getByRole("button", { name: "Delete this scan now" }).click();
    await page.getByRole("button", { name: "Delete scan" }).click();

    const error = page.getByRole("alertdialog").getByRole("alert");
    await expect(error).toContainText("Couldn't delete");
    await expect(error).toContainText(/check your connection and try again/i);
    // Still open, and the ranking underneath is untouched.
    await expect(page.getByRole("alertdialog")).toBeVisible();
  });

  test("deleting a scan also forgets the scan attempt log kept on this device, and only that", async ({
    page,
  }) => {
    await page.route(SCAN_URL, (route) => route.fulfill({ status: 204 }));
    await stubHappyFit(page);
    await page.route(ANALYSIS_URL, (route) =>
      fulfillJson(route, 200, READY_ANALYSIS_MODEL),
    );
    await page.addInitScript(() => {
      localStorage.setItem(
        "openMouse.easyScan.attempts.v1",
        JSON.stringify([
          {
            v: 1,
            at: "2026-10-06T10:20:30.000Z",
            method: "upload",
            result: "error",
          },
        ]),
      );
      localStorage.setItem("openMouse.easyScan.paperSize", "letter");
      localStorage.setItem("unrelated", "x");
    });
    await page.goto(`/results/${SCAN_ID}`);
    await page.getByRole("button", { name: "Delete this scan now" }).click();
    await page.getByRole("button", { name: "Delete scan" }).click();
    await expect(
      page.getByRole("heading", { name: "This scan has been deleted" }),
    ).toBeVisible();
    const kept = await page.evaluate(() => ({
      attempts: localStorage.getItem("openMouse.easyScan.attempts.v1"),
      paperSize: localStorage.getItem("openMouse.easyScan.paperSize"),
      unrelated: localStorage.getItem("unrelated"),
    }));
    expect(kept).toEqual({
      attempts: null,
      paperSize: "letter",
      unrelated: "x",
    });
  });

  test("a delete that fails leaves the attempt log alone", async ({ page }) => {
    await page.route(SCAN_URL, (route) => route.fulfill({ status: 500 }));
    await stubHappyFit(page);
    await page.route(ANALYSIS_URL, (route) =>
      fulfillJson(route, 200, READY_ANALYSIS_MODEL),
    );
    await page.addInitScript(() => {
      localStorage.setItem(
        "openMouse.easyScan.attempts.v1",
        JSON.stringify([
          {
            v: 1,
            at: "2026-10-06T10:20:30.000Z",
            method: "upload",
            result: "error",
          },
        ]),
      );
    });
    await page.goto(`/results/${SCAN_ID}`);
    await page.getByRole("button", { name: "Delete this scan now" }).click();
    await page.getByRole("button", { name: "Delete scan" }).click();
    await expect(
      page.getByRole("alertdialog").getByRole("alert"),
    ).toContainText("Couldn't delete");
    expect(
      await page.evaluate(() =>
        localStorage.getItem("openMouse.easyScan.attempts.v1"),
      ),
    ).not.toBeNull();
  });
});

test("a results page sweeps every leftover hand key, not just its own scan's", async ({
  page,
}) => {
  const OTHER = "openMouse.resultHand.7c1d2e3f-0000-4a2b-8c3d-9e0f1a2b3c4d";
  const THIRD = "openMouse.resultHand.11111111-2222-4333-8444-555555555555";
  const KEEP_LENGTH =
    "open-mouse:user-length:11111111-2222-4333-8444-555555555555";
  await stubHappyFit(page);
  await page.route(ANALYSIS_URL, (route) =>
    fulfillJson(route, 200, READY_ANALYSIS_MODEL),
  );
  await page.addInitScript(
    ([keys, keep]) => {
      for (const key of keys) localStorage.setItem(key, "left");
      localStorage.setItem(keep, "186");
      localStorage.setItem("unrelated", "x");
    },
    [[HAND_KEY, OTHER, THIRD], KEEP_LENGTH] as const,
  );
  await page.goto(`/results/${SCAN_ID}`);
  await expect(page.locator(".results-score-model")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(localStorage).filter((k) =>
          k.startsWith("openMouse.resultHand."),
        ),
      ),
    )
    .toEqual([]);
  // Only the hand keys go: another scan's typed length and unrelated data stay.
  expect(
    await page.evaluate(
      ([keep]) => [
        localStorage.getItem(keep),
        localStorage.getItem("unrelated"),
      ],
      [KEEP_LENGTH],
    ),
  ).toEqual(["186", "x"]);
});
