import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { RESULTS_VIEWER_ENABLED } from "../../src/lib/results/features";

/**
 * Opt-in: how long a frame of the 3D viewer takes while it is being turned,
 * on the heaviest shell, at the machine's own speed and with Chromium's CPU
 * throttled 4x and 6x (`Emulation.setCPUThrottlingRate`, the usual stand-in for
 * a mid-range and a low-end phone). Not part of a normal run, because it
 * measures a machine, not a behaviour:
 *
 *   PERF=1 npx playwright test tests/e2e/viewer-perf.spec.ts --project=chromium
 *   PERF=1 PERF_GPU=1 npx playwright test ...   (the machine's real GPU, Windows/D3D11)
 *
 * What it does: loads /results/[scanId] with the fit and measurements routes
 * stubbed and the real G309 shell (the largest shell file; every shell is
 * 13,998 to 14,000 triangles and the hand adds 22,718), waits for the viewer to
 * be ready, then for 5 s presses an arrow key on every animation frame, so the
 * viewer draws one frame per frame, and records the time between consecutive
 * animation frames. By default headless Chromium rasterises WebGL in software
 * (SwiftShader); PERF_GPU=1 asks for the machine's own GPU instead. Either way
 * the CPU throttle slows only the page's own thread, so these numbers are a
 * stand-in, not a phone: the real-phone number comes from Kirby's phone. The
 * result says which renderer drew.
 */

const FIT = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        "../../src/components/results/fixtures/high-confidence.json",
        import.meta.url,
      ),
    ),
    "utf-8",
  ),
) as { scanId: string; results: { mouse: Record<string, unknown> }[] };
const SCAN_ID = FIT.scanId;
const HEAVIEST_SHELL = "logitech-g309";

const RATES = [1, 4, 6] as const;
const SECONDS = 5;

const summary = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  const mean = values.reduce((a, b) => a + b, 0) / (values.length || 1);
  return {
    frames: values.length,
    mean: +mean.toFixed(1),
    median: +at(0.5).toFixed(1),
    p95: +at(0.95).toFixed(1),
    max: +(sorted.at(-1) ?? 0).toFixed(1),
  };
};

test.use({
  launchOptions: {
    args:
      process.env.PERF_GPU === "1"
        ? ["--use-angle=d3d11", "--ignore-gpu-blocklist"]
        : [],
  },
});

test.describe("3D viewer frame time (opt-in)", () => {
  test.skip(process.env.PERF !== "1", "Opt-in: set PERF=1 to run it.");
  test.skip(
    !RESULTS_VIEWER_ENABLED,
    "The 3D viewer is hidden (src/lib/results/features.ts).",
  );

  for (const rate of RATES) {
    test(`${rate}x CPU: frame time over ${SECONDS} s of rotation, G309 shell with the hand`, async ({
      page,
      context,
    }, info) => {
      test.skip(info.project.name !== "chromium");
      test.setTimeout(300_000);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      const fit = {
        ...FIT,
        results: FIT.results.map((r, i) =>
          i === 0 ? { ...r, mouse: { ...r.mouse, slug: HEAVIEST_SHELL } } : r,
        ),
      };
      await page.route(`**/api/scans/${SCAN_ID}/fit`, (route) =>
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(fit),
        }),
      );
      await page.route(`**/api/scans/${SCAN_ID}/analysis`, (route) =>
        route.fulfill({ status: 500, body: "{}" }),
      );
      await page.route(`**/api/scans/${SCAN_ID}/measurements`, (route) =>
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            scanId: SCAN_ID,
            hand: "right",
            measurements: {
              handLengthMm: 183.4,
              palmLengthMm: 101.2,
              palmWidthMm: 84.7,
            },
          }),
        }),
      );

      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate });
      await cdp.send("Performance.enable");
      const taskSeconds = async () => {
        const { metrics } = (await cdp.send("Performance.getMetrics")) as {
          metrics: { name: string; value: number }[];
        };
        return metrics.find((m) => m.name === "TaskDuration")!.value;
      };

      const loadStart = Date.now();
      await page.goto(`/results/${SCAN_ID}`);
      const viewer = page.locator(".viewer");
      test.skip(
        (await viewer.getAttribute("data-viewer-state")) === "unsupported",
        "No WebGL on this machine.",
      );
      await expect(viewer).toHaveAttribute("data-viewer-state", "ready", {
        timeout: 240_000,
      });
      const readyMs = Date.now() - loadStart;
      // The opening turn ends by itself; measure after it.
      await page.waitForTimeout(3500);

      const tasksBefore = await taskSeconds();
      const deltas = await page.evaluate(async (ms) => {
        const target = document.querySelector(".viewer-box")!;
        const out: number[] = [];
        let last = performance.now();
        const end = last + ms;
        await new Promise<void>((resolve) => {
          const step = (t: number) => {
            out.push(t - last);
            last = t;
            target.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "ArrowRight",
                bubbles: true,
              }),
            );
            if (t < end) requestAnimationFrame(step);
            else resolve();
          };
          requestAnimationFrame(step);
        });
        return out.slice(1);
      }, SECONDS * 1000);
      const tasksAfter = await taskSeconds();

      const renderer = await page.evaluate(() => {
        const gl = document.createElement("canvas").getContext("webgl2");
        const ext = gl?.getExtension("WEBGL_debug_renderer_info");
        return gl && ext
          ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
          : "unknown";
      });

      const stats = summary(deltas);
      const result = {
        renderer,
        cpuThrottle: `${rate}x`,
        shell: HEAVIEST_SHELL,
        trianglesShell: 14000,
        trianglesHand: 22718,
        timeToReadyMs: readyMs,
        frameMs: stats,
        mainThreadMsPerFrame: +(
          ((tasksAfter - tasksBefore) * 1000) /
          (deltas.length || 1)
        ).toFixed(1),
        p95Above33msAt4x: rate === 4 ? stats.p95 > 33 : null,
      };
      await info.attach(`viewer-frame-time-${rate}x.json`, {
        body: JSON.stringify(result, null, 2),
        contentType: "application/json",
      });
      console.log(JSON.stringify(result));
      expect(deltas.length).toBeGreaterThan(5);
    });
  }
});
