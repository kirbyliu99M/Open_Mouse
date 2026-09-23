import { defineConfig, devices } from "@playwright/test";

/**
 * Several agents build in parallel on one machine, each in its own worktree.
 * A fixed port plus `reuseExistingServer` let one worktree's e2e run silently
 * attach to ANOTHER worktree's dev server and report results for code it was
 * not testing. So: the port is configurable per worktree, and an existing
 * server is reused only on explicit opt-in. With reuse off, a busy port fails
 * loudly instead of testing the wrong branch.
 *
 *   PLAYWRIGHT_PORT=3217 npm run test:e2e          # isolated run
 *   PLAYWRIGHT_REUSE_SERVER=1 npm run test:e2e     # attach to your own `npm run dev`
 */
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "1",
    timeout: 120_000,
  },
});
