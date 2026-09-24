/**
 * Timing check for `detectPaperQuad` (src/client/paper/detect.ts) at a
 * 640-px-long-edge frame — the size and rate (up to 8/s) the live camera
 * viewfinder calls it at. Never runs in CI (it's a manual perf sanity
 * check, not a correctness test — those are the vitest suite,
 * tests/unit/paper-detect.test.ts).
 *
 *   npm run paper:bench
 */
import { generateSyntheticPaper } from "../tests/unit/helpers/synthetic-paper";
import { detectPaperQuad } from "../src/client/paper/detect";

const WIDTH = 640;
const HEIGHT = 480;
const WARMUP_CALLS = 30;
const TIMED_CALLS = 200;

const cases = Array.from({ length: 10 }, (_, i) =>
  generateSyntheticPaper({
    width: WIDTH,
    height: HEIGHT,
    seed: i * 7919 + 1,
    occluder: i % 2 === 0,
  }),
);
const frames = cases.map(
  (c) =>
    ({ width: WIDTH, height: HEIGHT, data: c.data }) as unknown as ImageData,
);

for (let i = 0; i < WARMUP_CALLS; i++) {
  detectPaperQuad(frames[i % frames.length], "a4");
}

const timesMs: number[] = [];
for (let i = 0; i < TIMED_CALLS; i++) {
  const t0 = performance.now();
  detectPaperQuad(frames[i % frames.length], "a4");
  timesMs.push(performance.now() - t0);
}
timesMs.sort((a, b) => a - b);

const percentile = (p: number) => timesMs[Math.floor((timesMs.length - 1) * p)];
console.log(
  `detectPaperQuad @ ${WIDTH}x${HEIGHT}, ${TIMED_CALLS} calls after ${WARMUP_CALLS} warmup:`,
);
console.log(`  min    = ${timesMs[0].toFixed(2)}ms`);
console.log(`  p50    = ${percentile(0.5).toFixed(2)}ms`);
console.log(`  p90    = ${percentile(0.9).toFixed(2)}ms`);
console.log(`  p99    = ${percentile(0.99).toFixed(2)}ms`);
console.log(`  max    = ${timesMs[timesMs.length - 1].toFixed(2)}ms`);
console.log(`(budget: < 30ms, for an up-to-8/s live camera loop)`);
