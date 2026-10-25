/**
 * Scan S2 (V3.2, 2026-10-21): times what the failure stage adds to one
 * live-preview sample (`paper-stage-bench.test.ts` asserts on it,
 * `scripts/paper-stage-bench.ts` prints it).
 *
 * What is new per sample: on a frame with no sheet, `stageForSmallRegions`
 * over the connected regions' areas (only on the bright-region exit; every
 * other exit returns a constant), then `cueCodeForPaperStage`, the stage
 * branch of `pickCue` and the debounce's stage reason. Timed at its WORST: a
 * 640 x 480 checkerboard has 153 600 one-pixel regions, the most a frame of
 * that size can have. The detector's own work is not repeated for the stage.
 */
import { stageForSmallRegions } from "../../../src/client/paper/detectionStage";
import { cueCodeForPaperStage, pickCue } from "../../../src/client/camera/cues";
import {
  advanceCueDebounce,
  INITIAL_CUE_DEBOUNCE_STATE,
} from "../../../src/client/camera/cueDebounce";

export interface StageBench {
  readonly worstP95Ms: number;
  readonly typicalP95Ms: number;
  readonly samples: number;
}

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
}

export function measureStageOverhead(samples = 500): StageBench {
  const pixelCount = 640 * 480;
  const worstAreas = new Array<number>(pixelCount / 2).fill(1);
  // A typical failing frame: a few hundred regions, one or two sizeable.
  const typicalAreas = Array.from({ length: 400 }, (_, i) =>
    i === 0 ? 5000 : i === 1 ? 4000 : 3 + (i % 17),
  );
  const input = {
    cornersSeen: 0 as const,
    quad: null,
    frameWidth: 640,
    meanLuma: 120,
    clippedFraction: 0,
    steady: false,
    sharpEnough: true,
    msSinceLastDetection: 0,
  };
  const run = (areas: readonly number[]) => {
    const stage = stageForSmallRegions(areas, pixelCount, 0.1);
    const cue = pickCue({ ...input, paperStage: stage }, "paper-edge", "en");
    cueCodeForPaperStage(stage);
    return advanceCueDebounce(INITIAL_CUE_DEBOUNCE_STATE, cue.code, 0);
  };
  for (let i = 0; i < 50; i++) {
    run(worstAreas);
    run(typicalAreas);
  }
  const worst: number[] = [];
  const typical: number[] = [];
  for (let i = 0; i < samples; i++) {
    let t0 = performance.now();
    run(worstAreas);
    worst.push(performance.now() - t0);
    t0 = performance.now();
    run(typicalAreas);
    typical.push(performance.now() - t0);
  }
  return { worstP95Ms: p95(worst), typicalP95Ms: p95(typical), samples };
}
