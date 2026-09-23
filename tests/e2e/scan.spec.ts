import { expect, test } from "@playwright/test";
import { buildSyntheticTopDownPhotoPng } from "./fixtures/synthetic-photo";
import { buildExifRotatedJpeg } from "./fixtures/exif-jpeg";
import { checkMarkers, checkHandDetected } from "../../src/client/photo/gates";

const FILE_INPUT = "#top-down-photo";
const STATUS = () => "[data-testid='scan-status']";

test.describe("/scan — top-down photo pipeline", () => {
  test("failed detector download shows retry and leaves processing", async ({
    page,
  }) => {
    await page.route("**/mediapipe/models/hand_landmarker.task", (route) =>
      route.abort("failed"),
    );
    await page.goto("/scan");
    const png = await buildSyntheticTopDownPhotoPng(page, {
      includeMarkers: true,
    });
    await page.setInputFiles(FILE_INPUT, {
      name: "sheet.png",
      mimeType: "image/png",
      buffer: png,
    });
    await expect(page.locator(".feedback-error")).toContainText(
      "load the hand detector",
      { timeout: 20_000 },
    );
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await page.unroute("**/mediapipe/models/hand_landmarker.task");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator(STATUS())).not.toContainText("Looking for", {
      timeout: 20_000,
    });
  });
  test("shows wayfinding, a way out, hand and grip pickers, and the on-device notice", async ({
    page,
  }) => {
    await page.goto("/scan");
    await expect(page.getByText("Step 2 of 2 · Photo")).toBeVisible();
    await expect(
      page.getByRole("link", { name: /sheet/i }).first(),
    ).toHaveAttribute("href", "/sheet");
    await expect(page.getByRole("link", { name: /print it/i })).toHaveAttribute(
      "href",
      "/sheet",
    );
    await expect(page.getByRole("button", { name: "Left hand" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Right hand" }),
    ).toBeVisible();
    await expect(
      page.getByText("Processed on this device — the photo is never uploaded."),
    ).toBeVisible();
  });

  test("finds all 4 markers and reaches the landmark step, then reports the exact no-hand retake message", async ({
    page,
  }) => {
    await page.goto("/scan");
    const png = await buildSyntheticTopDownPhotoPng(page, {
      includeMarkers: true,
    });

    await page.setInputFiles(FILE_INPUT, {
      name: "top-down.png",
      mimeType: "image/png",
      buffer: png,
    });

    // MediaPipe genuinely cannot find a hand in a drawn oval (issue #10's
    // own premise) — assert the *specific* retake message gates.ts
    // produces for that, not just "some error happened". Reaching this
    // message is itself proof the pipeline got past marker detection,
    // correspondence matching, homography estimation and card detection
    // to reach the landmark step.
    const expectedMessage = checkHandDetected(0)!.message;
    await expect(page.locator(STATUS())).toHaveText(expectedMessage, {
      timeout: 20_000,
    });

    // The overlay proves markers.ts found (at least) the real 4 flat-flap
    // markers and card.ts found the card. A synthetic, hard-edged render
    // can occasionally trip js-aruco2's generous Hamming-distance matching
    // into a spurious extra "marker" from the card/hand shapes' own sharp
    // corners — harmless to the actual pipeline (buildMarkerCorrespondences
    // and checkMarkers both only look at ids 0-3), so this asserts "at
    // least", not "exactly".
    const markerCount = await page.locator(".overlayMarker").count();
    expect(markerCount).toBeGreaterThanOrEqual(4);
    await expect(page.locator(".overlayCard")).toHaveCount(1);
  });

  test("reports the specific missing-markers message when no markers are present", async ({
    page,
  }) => {
    await page.goto("/scan");
    const png = await buildSyntheticTopDownPhotoPng(page, {
      includeMarkers: false,
    });

    await page.setInputFiles(FILE_INPUT, {
      name: "no-markers.png",
      mimeType: "image/png",
      buffer: png,
    });

    // The message is what actually matters: checkMarkers (and
    // buildMarkerCorrespondences) only look at ids 0-3, so this is
    // authoritative regardless of whether the synthetic card/hand shapes'
    // own sharp corners occasionally trip a spurious extra "candidate"
    // with some other id.
    const expectedMessage = checkMarkers([])!.message;
    await expect(page.locator(STATUS())).toHaveText(expectedMessage, {
      timeout: 20_000,
    });
  });

  test("makes zero network requests while processing a photo", async ({
    page,
  }) => {
    // Let the initial page load — including the HandLandmarker's one-time
    // model+WASM fetch, which src/app/scan/ScanClient.tsx deliberately
    // warms on mount — finish before recording starts, so this test
    // asserts what issue #10 actually cares about: nothing is fetched
    // while a photo is being processed, i.e. no image or derived data
    // leaves (or even reaches out from) the browser during a scan.
    await page.goto("/scan");
    // Explicit signal, not just networkidle's timing-sensitive guess: the
    // one-time model fetch has actually finished.
    await page.waitForResponse((res) =>
      res.url().includes("/mediapipe/models/hand_landmarker.task"),
    );
    await page.waitForLoadState("networkidle");

    const requestedUrls: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      // blob: is an in-memory object URL (the photo preview <img>) — no
      // bytes cross the network. __nextjs_*/webpack-hmr are `next dev`'s
      // own dev-server tooling (source maps, HMR), not application traffic
      // and not present in a production build; excluded here the same way
      // a production build wouldn't have them.
      if (url.startsWith("blob:")) return;
      if (/\/__nextjs_|__next_hmr|webpack-hmr/.test(url)) return;
      requestedUrls.push(url);
    });

    const png = await buildSyntheticTopDownPhotoPng(page, {
      includeMarkers: true,
    });
    await page.setInputFiles(FILE_INPUT, {
      name: "top-down.png",
      mimeType: "image/png",
      buffer: png,
    });

    const expectedMessage = checkHandDetected(0)!.message;
    await expect(page.locator(STATUS())).toHaveText(expectedMessage, {
      timeout: 20_000,
    });

    expect(requestedUrls).toEqual([]);
  });

  test("decodes a JPEG upright per its EXIF orientation tag", async ({
    page,
  }) => {
    await page.goto("/scan");
    const exif = await buildExifRotatedJpeg(page);

    await page.setInputFiles(FILE_INPUT, {
      name: "rotated.jpg",
      mimeType: "image/jpeg",
      buffer: exif.buffer,
    });

    // No sheet in this fixture, so it always ends at "markers missing" —
    // what matters is the decoded dimensions the pipeline reports for the
    // photo it actually processed.
    await expect(page.locator(STATUS())).toContainText("hidden", {
      timeout: 20_000,
    });
    await expect(page.getByTestId("photo-dimensions")).toHaveText(
      `${exif.displayWidth}x${exif.displayHeight}`,
    );
  });
});

// Item 6: the measured state matches
// docs/design/journey-2026-09-23/03-scan-measured.png. `/scan/measured-demo`
// seeds `ScanClient` straight into its "ok" state with fixed measurements —
// see that route's own comment for why (mirrors `/scan/submit-demo`'s reason
// for existing).
test.describe("/scan/measured-demo — measured state (item 6)", () => {
  test("shows the settled hand/grip as chips, not the full pickers", async ({
    page,
  }) => {
    await page.goto("/scan/measured-demo");
    await expect(page.locator(".scanChip")).toHaveText([
      "Right hand",
      "Claw grip",
    ]);
    await expect(page.getByRole("button", { name: "Left hand" })).toHaveCount(
      0,
    );
  });

  test("shows a 'Hand measured' card with the three headline numbers", async ({
    page,
  }) => {
    await page.goto("/scan/measured-demo");
    await expect(page.locator(".feedback-ok .feedbackTitle")).toContainText(
      "Hand measured",
    );
    const rows = page.locator(".measurementRow");
    await expect(rows.nth(0)).toContainText("Hand length");
    await expect(rows.nth(0)).toContainText("190.0 mm");
    await expect(rows.nth(1)).toContainText("Palm length");
    await expect(rows.nth(1)).toContainText("108.0 mm");
    await expect(rows.nth(2)).toContainText("Palm width");
    await expect(rows.nth(2)).toContainText("84.0 mm");
  });

  test("shows 'See my matches' as the primary action and 'Use a different photo' as the secondary one", async ({
    page,
  }) => {
    await page.goto("/scan/measured-demo");
    await expect(
      page.getByRole("button", { name: "See my matches" }),
    ).toBeVisible();
    await expect(page.locator(".uploadButton")).toHaveText(
      "Use a different photo",
    );
  });

  test("states the on-device privacy line, including that only the measurements are sent", async ({
    page,
  }) => {
    await page.goto("/scan/measured-demo");
    await expect(page.locator(".deviceNotice")).toHaveText(
      "Processed on this device — the photo is never uploaded. Only these measurements are sent.",
    );
  });
});

// Issue #29: submit the scan once it's measured. `/scan/submit-demo` mounts
// the same `ScanSubmitPanel` `/scan` renders in its "ok" state, but against
// a fixed, schema-valid `ScanSubmission` fixture instead of one derived from
// a real photo — no synthetic image an e2e test can draw gets MediaPipe to
// detect a hand (the test above proves that's still true; see also
// tests/e2e/fixtures/synthetic-photo.ts's own comment), so this is the only
// deterministic way to reach the submit UI in CI. The backend route is
// mocked with `page.route` here — a live database isn't required to prove
// what the *browser* sends and how the UI reacts to what comes back.
const SUBMIT_BUTTON = () => "[data-testid='submit-scan-button']";
const SUBMIT_STATUS = () => "[data-testid='submit-status']";

test.describe("/scan/submit-demo — submit phase (issue #29)", () => {
  test("the only request is a single POST to /api/scans, and its body carries no image data", async ({
    page,
  }) => {
    await page.goto("/scan/submit-demo");
    // Same pattern as the zero-network test above: let the page settle
    // before recording, so this only captures what the submit click itself
    // triggers.
    await page.waitForLoadState("networkidle");

    const requestedUrls: string[] = [];
    const requestBodies: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith("blob:")) return;
      if (/\/__nextjs_|__next_hmr|webpack-hmr/.test(url)) return;
      requestedUrls.push(url);
      requestBodies.push(req.postData() ?? "");
    });

    // Hold the mocked response open until this test has asserted the
    // single-request invariant — otherwise a successful submit triggers a
    // real client-side navigation to `resultsPagePath`, whose own asset
    // requests (RSC payload, JS chunks) would land in the same listener and
    // are no part of what "submitting a scan" itself puts on the wire.
    // #30 owns that destination page; this test only cares about the POST.
    let releaseResponse!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    await page.route("**/api/scans", async (route) => {
      await held;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          scanId: "423e4567-e89b-12d3-a456-426614174003",
        }),
      });
    });

    await page.locator(SUBMIT_BUTTON()).click();
    await expect.poll(() => requestedUrls.length).toBeGreaterThan(0);

    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]).toContain("/api/scans");

    const body = requestBodies[0]!;
    expect(body).not.toMatch(/data:/i);
    expect(body).not.toMatch(/base64/i);
    expect(body).not.toMatch(/\bblob\b/i);
    expect(body).not.toMatch(/\bfile\b/i);
    // It's exactly the ScanSubmission shape — measurements and calibration
    // evidence, never anything image-shaped.
    const parsed = JSON.parse(body);
    expect(parsed).toHaveProperty("measurements");
    expect(parsed).toHaveProperty("calibration");
    expect(parsed).not.toHaveProperty("photo");
    expect(parsed).not.toHaveProperty("image");

    // Now let the held response complete and confirm the success path
    // still navigates as expected (a second, separate concern from the
    // single-request assertion above).
    releaseResponse();
    await expect(page).toHaveURL(
      /\/results\/423e4567-e89b-12d3-a456-426614174003$/,
    );
  });

  test("shows press feedback, a visible status, and disables the button once React has re-rendered", async ({
    page,
  }) => {
    await page.route("**/api/scans", async (route) => {
      // Hold the response open briefly so the in-flight state is
      // observable rather than racing past it.
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          scanId: "523e4567-e89b-12d3-a456-426614174004",
        }),
      });
    });

    await page.goto("/scan/submit-demo");
    const button = page.locator(SUBMIT_BUTTON());
    await expect(button).toBeEnabled();

    await button.click();
    await expect(button).toBeDisabled();
    await expect(page.locator(SUBMIT_STATUS())).toHaveText(
      /Sending your measurements/,
    );

    await expect(page).toHaveURL(
      /\/results\/523e4567-e89b-12d3-a456-426614174004$/,
    );
  });

  // The test above only fires one click and checks the `disabled` attribute
  // — it never actually tries a second submit, so it would pass even
  // against code whose only guard is `state.kind` read inside the `onClick`
  // closure. Two clicks dispatched in the same task both run their handler
  // before React commits the first `setState`, so a `state.kind`-only guard
  // sees "idle" twice and a second request goes out. These two tests fire a
  // real second attempt and assert exactly one request reached the server.
  test("dispatching two clicks in the same task still sends exactly one POST (no double-submit)", async ({
    page,
  }) => {
    let requestCount = 0;
    await page.route("**/api/scans", async (route) => {
      requestCount++;
      // Hold the response open briefly — the race is most visible on a
      // slow network, where both clicks land well before either resolves.
      await new Promise((resolve) => setTimeout(resolve, 200));
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          scanId: "623e4567-e89b-12d3-a456-426614174005",
        }),
      });
    });

    await page.goto("/scan/submit-demo");
    // Both `.click()` calls run synchronously inside this one
    // `page.evaluate`, in the same browser task — the scenario a
    // `state.kind`-only guard cannot catch.
    await page.evaluate((selector) => {
      const button = document.querySelector<HTMLButtonElement>(selector);
      button?.click();
      button?.click();
    }, SUBMIT_BUTTON());

    await expect(page).toHaveURL(
      /\/results\/623e4567-e89b-12d3-a456-426614174005$/,
    );
    expect(requestCount).toBe(1);
  });

  test("pressing Enter twice on the focused button still sends exactly one POST", async ({
    page,
  }) => {
    let requestCount = 0;
    await page.route("**/api/scans", async (route) => {
      requestCount++;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          scanId: "723e4567-e89b-12d3-a456-426614174006",
        }),
      });
    });

    await page.goto("/scan/submit-demo");
    const button = page.locator(SUBMIT_BUTTON());
    await button.focus();
    await button.press("Enter");
    await button.press("Enter");

    await expect(page).toHaveURL(
      /\/results\/723e4567-e89b-12d3-a456-426614174006$/,
    );
    expect(requestCount).toBe(1);
  });

  for (const c of [
    {
      status: 400,
      body: { error: "Invalid scan submission." },
      expectedSubstring: "couldn't be saved",
      label: "400 invalid",
    },
    {
      status: 413,
      body: { error: "Request body too large." },
      expectedSubstring: "didn't send correctly",
      label: "413 too large",
    },
    {
      status: 503,
      body: {},
      expectedSubstring: "went wrong on our end",
      label: "5xx server error",
    },
  ] as const) {
    test(`${c.label} — names the problem, the one action that fixes it, and re-enables the button to retry`, async ({
      page,
    }) => {
      await page.route("**/api/scans", async (route) => {
        await route.fulfill({
          status: c.status,
          contentType: "application/json",
          body: JSON.stringify(c.body),
        });
      });

      await page.goto("/scan/submit-demo");
      const button = page.locator(SUBMIT_BUTTON());
      await button.click();

      await expect(page.locator(".feedback-error")).toContainText(
        c.expectedSubstring,
      );
      await expect(button).toBeEnabled();
    });
  }

  test("a network failure gets its own copy, distinct from the server-error copy, and re-enables the button", async ({
    page,
  }) => {
    await page.route("**/api/scans", async (route) => {
      await route.abort("failed");
    });

    await page.goto("/scan/submit-demo");
    const button = page.locator(SUBMIT_BUTTON());
    await button.click();

    await expect(page.locator(".feedback-error")).toContainText(
      "No connection",
    );
    await expect(button).toBeEnabled();
  });
});
