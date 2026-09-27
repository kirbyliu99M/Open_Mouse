import { defineConfig, devices } from "@playwright/test";

/**
 * Live e2e: runs against a REAL deployment, with nothing mocked between the
 * browser and the database. The default suite (`playwright.config.ts`) stubs
 * the backend with `page.route`, which is right for UI states but is exactly
 * how the reload bug (#42) shipped past every test: each test mocked the seam
 * the bug lived on. This suite covers that seam.
 *
 *   BASE_URL=https://open-mouse.vercel.app npm run test:e2e:live
 *
 * It creates anonymous test scans and deletes them through the product's own
 * delete action; anything left behind is swept within 24 hours.
 */
const BASE_URL = process.env.BASE_URL;
if (!BASE_URL) {
  throw new Error(
    "Set BASE_URL to the deployment under test, e.g. https://open-mouse.vercel.app",
  );
}

export default defineConfig({
  testDir: "./tests/e2e-live",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: BASE_URL, trace: "retain-on-failure" },
  projects: [{ name: "mobile", use: { ...devices["Pixel 7"] } }],
});
