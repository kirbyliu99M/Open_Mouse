import { expect, test, type Page } from "@playwright/test";

/**
 * The hand detector's model (7.8 MB) is read by the app itself as a stream
 * with a byte count. These tests stand in for a slow connection: an init
 * script replaces `fetch` for the model URL with a Response whose stream the
 * test releases chunk by chunk (`window.__chunkGate`), built from the real
 * file so MediaPipe still gets a real model in the end.
 */
type Mode =
  "gated" | "gated-no-length" | "steady" | "fail-first" | "passthrough";

async function slowModel(page: Page, mode: Mode, chunks = 10) {
  await page.addInitScript(
    ({ mode, chunks }) => {
      const w = window as Window & {
        __modelFetches?: number;
        __chunkGate?: number;
        __progressValues?: string[];
      };
      w.__modelFetches = 0;
      w.__chunkGate =
        mode === "gated" || mode === "gated-no-length" ? 0 : chunks;
      w.__progressValues = [];
      const realFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof Request
              ? input.url
              : String(input);
        if (!url.includes("hand_landmarker.task"))
          return realFetch(input, init);
        w.__modelFetches = (w.__modelFetches ?? 0) + 1;
        if (mode === "fail-first" && w.__modelFetches === 1)
          throw new TypeError("offline");
        if (
          mode === "passthrough" ||
          (mode === "fail-first" && w.__modelFetches > 1)
        )
          return realFetch(input, init);
        const real = await realFetch(input, init);
        const bytes = new Uint8Array(await real.arrayBuffer());
        const size = Math.ceil(bytes.length / chunks);
        let sent = 0;
        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            while ((w.__chunkGate ?? 0) <= sent && sent < chunks)
              await new Promise((resolve) => setTimeout(resolve, 15));
            if (mode === "steady") await new Promise((r) => setTimeout(r, 12));
            if (sent >= chunks) {
              controller.close();
              return;
            }
            controller.enqueue(bytes.slice(sent * size, (sent + 1) * size));
            sent += 1;
          },
        });
        const headers = new Headers();
        headers.set("content-type", "application/octet-stream");
        if (mode !== "gated-no-length")
          headers.set("content-length", String(bytes.length));
        return new Response(stream, { status: 200, headers });
      };
      // Every value the progress bar exposes to assistive technology.
      new MutationObserver(() => {
        const bar = document.querySelector("[role=progressbar]");
        if (!bar) return;
        const value = bar.getAttribute("aria-valuenow") ?? "indeterminate";
        const seen = w.__progressValues!;
        if (seen[seen.length - 1] !== value) seen.push(value);
      }).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["aria-valuenow"],
      });
    },
    { mode, chunks },
  );
}

const release = (page: Page, chunks: number) =>
  page.evaluate((n) => {
    (window as Window & { __chunkGate?: number }).__chunkGate = n;
  }, chunks);

const pill = (page: Page) => page.getByTestId("detector-progress");

test("shows real progress while the model streams in, in coarse steps for assistive technology, then goes away", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "Runs in the mobile project.");
  await slowModel(page, "gated");
  await page.goto("/scan/easy");
  await page.getByRole("button", { name: "Got it" }).click();

  await expect(pill(page)).toBeVisible();
  const bar = pill(page).getByRole("progressbar");
  await expect(bar).toHaveAttribute("aria-valuenow", "0");
  await expect(pill(page)).toContainText("Loading the hand detector");

  await release(page, 3);
  await expect(bar).toHaveAttribute("aria-valuenow", "30");
  await expect(pill(page)).toContainText(/2\.\d of 7\.8 MB/);
  // The bar is exact for the eye: 30% of the model is 3 of 10 chunks.
  const width = await pill(page)
    .locator(".easyDetectorFill")
    .evaluate((el) => (el as HTMLElement).style.width);
  expect(width).toBe("30%");

  await release(page, 7);
  await expect(bar).toHaveAttribute("aria-valuenow", "70");
  await release(page, 10);
  await expect(pill(page)).toHaveCount(0, { timeout: 15_000 });
  expect(
    await page.evaluate(
      () => (window as Window & { __modelFetches?: number }).__modelFetches,
    ),
  ).toBe(1);
});

test("a screen reader is offered a handful of values, not one per chunk", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "Runs in the mobile project.");
  await slowModel(page, "steady", 100);
  await page.goto("/scan/easy");
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(pill(page)).toBeVisible();
  await expect(pill(page)).toHaveCount(0, { timeout: 30_000 });
  const values = await page.evaluate(
    () => (window as Window & { __progressValues?: string[] }).__progressValues,
  );
  const numeric = values!.filter((v) => v !== "indeterminate").map(Number);
  // 100 chunks, so 100 visual updates; only multiples of 10, at most 11 values.
  expect(numeric.every((v) => v % 10 === 0)).toBe(true);
  expect(new Set(numeric).size).toBeLessThanOrEqual(11);
  expect(numeric).toEqual([...numeric].sort((a, b) => a - b));
  expect(numeric.length).toBeGreaterThan(3);
});

test("without a Content-Length the bar is indeterminate and still says how much has arrived", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "Runs in the mobile project.");
  await slowModel(page, "gated-no-length");
  await page.goto("/scan/easy");
  await page.getByRole("button", { name: "Got it" }).click();
  await release(page, 3);
  const bar = pill(page).getByRole("progressbar");
  await expect(pill(page)).toContainText(
    /Loading the hand detector · \d\.\d MB/,
  );
  await expect(pill(page)).not.toContainText(" of ");
  await expect(bar).not.toHaveAttribute("aria-valuenow");
  await expect(pill(page).locator(".easyDetectorFill")).toHaveClass(
    /indeterminate/,
  );
  await release(page, 10);
  await expect(pill(page)).toHaveCount(0, { timeout: 15_000 });
});

test("if the app's own download fails, MediaPipe loads the model by path and the detector still comes up", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "Runs in the mobile project.");
  await slowModel(page, "fail-first");
  await page.goto("/scan/easy");
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(pill(page)).toHaveCount(0, { timeout: 20_000 });
  // Ours failed (1), MediaPipe fetched by path (2).
  expect(
    await page.evaluate(
      () => (window as Window & { __modelFetches?: number }).__modelFetches,
    ),
  ).toBe(2);
  await expect(page.getByText(/couldn.t load the hand detector/i)).toHaveCount(
    0,
  );
});

test("coming back to the scan screen in the same session downloads nothing again", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "Runs in the mobile project.");
  await slowModel(page, "passthrough");
  const modelResponse = page.waitForResponse((res) =>
    res.url().includes("/mediapipe/models/hand_landmarker.task"),
  );
  await page.goto("/scan/easy");
  await modelResponse;
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(pill(page)).toHaveCount(0, { timeout: 20_000 });

  await page
    .getByRole("button", { name: "Close camera, back to Home" })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("link", { name: "Scan my hand" }).first().click();
  await expect(page).toHaveURL(/\/scan\/easy$/);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(pill(page)).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as Window & { __modelFetches?: number }).__modelFetches,
    ),
  ).toBe(1);
});

test("the download stays on this origin under the unchanged connect-src 'self'", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "Runs in the mobile project.");
  const origins = new Set<string>();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http")) origins.add(url.origin);
  });
  const response = await page.goto("/scan/easy");
  expect(response!.headers()["content-security-policy"]).toContain(
    "connect-src 'self'",
  );
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(pill(page)).toHaveCount(0, { timeout: 20_000 });
  expect([...origins]).toEqual([new URL(page.url()).origin]);
});
