import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAKE_VIDEO_FIXTURE = path.join(
  __dirname,
  "tests/e2e/fixtures/camera/sheet-full.y4m",
);
const FAKE_VIDEO_FIXTURE_PARTIAL = path.join(
  __dirname,
  "tests/e2e/fixtures/camera/paper-edge-partial.y4m",
);
const FAKE_VIDEO_FIXTURE_PAPER_EDGE = path.join(
  __dirname,
  "tests/e2e/fixtures/camera/paper-edge-full.y4m",
);

function fakeMediaLaunchOptions(fixturePath: string) {
  return {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-video-capture=${fixturePath}`,
    ],
  };
}

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
    // camera-capture.spec.ts's happy-path (fake-media) test is scoped to
    // the "chromium-camera" project below; its permission-denied test
    // needs a context with NO fake-media flags, so it runs here instead
    // (mirroring every other e2e spec) rather than being excluded too.
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    // tests/e2e/camera-capture.spec.ts only: Chromium's fake media device
    // fed the committed sheet-full.mjpeg fixture, so the live camera flow
    // is testable without a phone (docs/design/camera-capture-2026-09-25/
    // README.md). Scoped to its own project (rather than added to
    // "chromium" above) because these launch args make getUserMedia
    // auto-succeed for EVERY test in the project — the permission-denied
    // case in that same spec deliberately runs under the plain "chromium"
    // project instead, where there's no fake camera to grant.
    {
      name: "chromium-camera",
      testMatch: /camera-capture\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        permissions: ["camera"],
        launchOptions: fakeMediaLaunchOptions(FAKE_VIDEO_FIXTURE),
      },
    },
    // Screenshots only: the "2 of 4 corners found" viewfinder state needs a
    // fixture that genuinely only shows 2 corners — a separate project
    // because the fake video file is a launch-time (not per-test) switch.
    {
      name: "chromium-camera-partial",
      testMatch: /camera-screenshots\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        permissions: ["camera"],
        launchOptions: fakeMediaLaunchOptions(FAKE_VIDEO_FIXTURE_PARTIAL),
      },
    },
    // tests/e2e/camera-paper-edge.spec.ts and the paper-edge screenshots in
    // camera-screenshots.spec.ts: the real detectPaperQuad's lock-on target
    // — a blank paper fixture (no markers), fed to the paper-edge preview
    // route. The a11y specs' live-camera cases run here too: a phone with a
    // camera is the only place the live viewfinder can be checked.
    {
      name: "chromium-camera-paper-edge",
      testMatch:
        /camera-paper-edge\.spec\.ts|camera-screenshots\.spec\.ts|easy-scan\.spec\.ts|easy-scan-v2\.spec\.ts|easy-scan-v2-screenshots\.spec\.ts|easy-scan-screenshots\.spec\.ts|capture-failure-hint\.spec\.ts|scan-fov\.spec\.ts|no-paper-device\.spec\.ts|a11y-structure\.spec\.ts|a11y-axe\.spec\.ts/,
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
        permissions: ["camera"],
        launchOptions: fakeMediaLaunchOptions(FAKE_VIDEO_FIXTURE_PAPER_EDGE),
      },
    },
  ],
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "1",
    timeout: 120_000,
    // The typed-hand-length entry is OFF in production (src/lib/flags.ts). It
    // is a build-time flag, so the e2e server is started with it ON to keep
    // the no-paper flow under test. The flag-off behaviour is covered by
    // tests/unit/flags.test.ts (a build-time flag can't be toggled within one
    // dev server). With PLAYWRIGHT_REUSE_SERVER=1 the attached `npm run dev`
    // must be started with the same variable.
    env: { NEXT_PUBLIC_TYPED_HAND_LENGTH_ENTRY: "1" },
  },
});
