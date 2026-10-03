import { test } from "@playwright/test";
import {
  CANVAS,
  scrollToProgress,
  waitForAnimated,
} from "./helpers/home-stage";

/**
 * Opt-in: how much main-thread time one frame of the particle stage costs
 * (Home v3, PR B; spec: "Main-thread work under about 8 ms per frame on a
 * mid-range phone", 未拍板 until measured on a real phone). Not part of a
 * normal run, because it measures a machine, not a behaviour:
 *
 *   PERF=1 npx playwright test tests/e2e/home-stage-perf.spec.ts \
 *     --project=chromium --project=mobile
 *
 * Chromium's CPU is throttled 4x (`Emulation.setCPUThrottlingRate`), the usual
 * stand-in for a mid-range phone, and the numbers it prints come from two
 * places:
 *   - the time of each requestAnimationFrame callback that drew a frame (the
 *     stage's own work: the maths and the canvas calls), from a wrapper;
 *   - the main thread's whole task time per drawn frame
 *     (`Performance.getMetrics` TaskDuration), which also counts style,
 *     layout, painting the canvas into a layer, and the scroll handling: an
 *     upper bound for "main-thread work per frame".
 * The real-phone number comes from Kirby's phone, not from here.
 */

const RATES = [1, 4] as const;
const STEPS = 150;

test.describe("home stage performance (opt-in)", () => {
  test.skip(process.env.PERF !== "1", "Opt-in: set PERF=1 to run it.");

  for (const rate of RATES) {
    test(`${rate}x CPU: main-thread time per drawn frame, shimmer and a scroll through the story`, async ({
      page,
      context,
    }, info) => {
      test.setTimeout(240_000);
      await page.addInitScript(() => {
        const w = window as unknown as Record<string, unknown>;
        const frames: { ms: number; drew: boolean; at: number }[] = [];
        w.__frames = frames;
        const draws = () =>
          Number(
            document
              .querySelector(".story-canvas")
              ?.getAttribute("data-draws") ?? 0,
          );
        const raf = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = (callback) =>
          raf((time) => {
            const before = draws();
            const start = performance.now();
            callback(time);
            const end = performance.now();
            frames.push({ ms: end - start, drew: draws() > before, at: end });
          });
      });
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate });
      await cdp.send("Performance.enable");

      const metrics = async () => {
        const { metrics } = (await cdp.send("Performance.getMetrics")) as {
          metrics: { name: string; value: number }[];
        };
        return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
      };
      const drawn = async () =>
        Number(await page.locator(CANVAS).getAttribute("data-draws"));
      const summary = (values: number[]) => {
        const sorted = [...values].sort((a, b) => a - b);
        const at = (q: number) =>
          sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
        const mean = values.reduce((a, b) => a + b, 0) / (values.length || 1);
        return {
          n: values.length,
          mean: +mean.toFixed(2),
          p50: +at(0.5).toFixed(2),
          p95: +at(0.95).toFixed(2),
          max: +(sorted.at(-1) ?? 0).toFixed(2),
        };
      };
      const drawFrames = () =>
        page.evaluate(() =>
          (
            (window as unknown as Record<string, unknown>).__frames as {
              ms: number;
              drew: boolean;
            }[]
          )
            .filter((f) => f.drew)
            .map((f) => f.ms),
        );

      await page.goto("/");
      await waitForAnimated(page);
      const size = page.viewportSize()!;

      // 1. The shimmer: the stage draws every frame for about 2.6 s.
      const shimmerStart = await metrics();
      const shimmerStartDraws = await drawn();
      await page.waitForTimeout(3400);
      const shimmerEnd = await metrics();
      const shimmerDraws = (await drawn()) - shimmerStartDraws;
      const shimmerFrames = await drawFrames();

      // 2. A scroll through the whole story, one frame per step.
      await page.evaluate(() => {
        (
          (window as unknown as Record<string, unknown>).__frames as unknown[]
        ).length = 0;
      });
      await scrollToProgress(page, 0);
      const startMetrics = await metrics();
      const startDraws = await drawn();
      const travel = await page.evaluate(() => {
        const section = document.querySelector(".story") as HTMLElement;
        const panel = document.querySelector(".story-panel") as HTMLElement;
        return section.offsetHeight - panel.offsetHeight;
      });
      for (let i = 0; i < STEPS; i += 1) {
        await page.evaluate(
          (dy) =>
            new Promise<void>((resolve) => {
              window.scrollBy(0, dy);
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              );
            }),
          travel / STEPS,
        );
      }
      const endMetrics = await metrics();
      const endDraws = await drawn();
      const scrollFrames = await drawFrames();

      // 3. The same loop on the static page (reduced motion: no stage at
      // all), to take the harness's own cost (evaluate, two rAF callbacks per
      // step, the scroll itself) out of the total.
      const plain = await context.newPage();
      await plain.emulateMedia({ reducedMotion: "reduce" });
      const plainCdp = await context.newCDPSession(plain);
      await plainCdp.send("Emulation.setCPUThrottlingRate", { rate });
      await plainCdp.send("Performance.enable");
      await plain.goto("/");
      await plain.waitForTimeout(1500);
      const plainTask = async () => {
        const { metrics } = (await plainCdp.send("Performance.getMetrics")) as {
          metrics: { name: string; value: number }[];
        };
        return metrics.find((m) => m.name === "TaskDuration")?.value ?? 0;
      };
      const plainStart = await plainTask();
      for (let i = 0; i < STEPS; i += 1) {
        await plain.evaluate(
          (dy) =>
            new Promise<void>((resolve) => {
              window.scrollBy(0, dy);
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              );
            }),
          travel / STEPS,
        );
      }
      const baselineMs = +(
        (((await plainTask()) - plainStart) * 1000) /
        STEPS
      ).toFixed(2);
      await plain.close();

      const frames = endDraws - startDraws;
      const per = (name: string) =>
        +(
          (((endMetrics[name] ?? 0) - (startMetrics[name] ?? 0)) * 1000) /
          Math.max(1, frames)
        ).toFixed(2);
      const result = {
        project: info.project.name,
        viewport: `${size.width}x${size.height}`,
        cpuThrottle: `${rate}x`,
        particles: await page.locator(CANVAS).getAttribute("data-particles"),
        shimmer: {
          framesDrawn: shimmerDraws,
          drawCallbackMs: summary(shimmerFrames),
          mainThreadMsPerFrame: +(
            (((shimmerEnd.TaskDuration ?? 0) -
              (shimmerStart.TaskDuration ?? 0)) *
              1000) /
            Math.max(1, shimmerDraws)
          ).toFixed(2),
        },
        scroll: {
          framesDrawn: frames,
          drawCallbackMs: summary(scrollFrames),
          mainThreadMsPerFrame: {
            task: per("TaskDuration"),
            harnessOnlyOnStaticPage: baselineMs,
            stageShare: +(per("TaskDuration") - baselineMs).toFixed(2),
            script: per("ScriptDuration"),
            layout: per("LayoutDuration"),
            recalcStyle: per("RecalcStyleDuration"),
          },
        },
      };
      console.log(`PERF ${JSON.stringify(result)}`);
      await info.attach("perf.json", {
        body: JSON.stringify(result, null, 2),
        contentType: "application/json",
      });
    });
  }
});
