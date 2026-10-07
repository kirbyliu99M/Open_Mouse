import { expect, test } from "@playwright/test";

// No NEXT_PUBLIC_POSTHOG_KEY is set for the e2e server, so analytics is a
// no-op: nothing may be requested from /ingest (issue #138). A second check
// with a fake key (a $pageview body carrying /results/[scanId], not the real
// id) would need the key at build time, which one spec cannot set; the
// redaction itself is unit-tested (tests/unit/analytics-client.test.ts).
test("without a PostHog key, home -> scan makes no /ingest request", async ({
  page,
}) => {
  const ingest: string[] = [];
  page.on("request", (req) => {
    if (new URL(req.url()).pathname.startsWith("/ingest"))
      ingest.push(req.url());
  });
  await page.goto("/");
  await page
    .getByTestId("home-hero")
    .getByRole("link", { name: /scan my hand/i })
    .click();
  await expect(page).toHaveURL(/\/scan\/easy/);
  // Past the idle callback's 4 s timeout, when a loader would have started.
  await page.waitForTimeout(5000);
  expect(ingest).toEqual([]);
});

test("a trailing slash still 308s to the canonical path", async ({
  request,
}) => {
  const res = await request.get("/scan/easy/", { maxRedirects: 0 });
  expect(res.status()).toBe(308);
  expect(new URL(res.headers().location!, "http://x").pathname).toBe(
    "/scan/easy",
  );
});

test("/ingest/e/ reaches the handler (404 without a key), not a redirect", async ({
  request,
}) => {
  const res = await request.post("/ingest/e/", {
    data: "{}",
    maxRedirects: 0,
  });
  expect(res.status()).toBe(404);
  const get = await request.get("/ingest/e/", { maxRedirects: 0 });
  expect(get.status()).toBe(404);
});
