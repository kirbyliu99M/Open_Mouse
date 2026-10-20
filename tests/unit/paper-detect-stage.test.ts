/**
 * Scan S2 (V3.2, 2026-10-21, candidate): where the paper detector stopped,
 * as a named stage. Each stage has at least one small synthetic frame that
 * ends there; `unknown` is only what fits no named step. The classifier for
 * the bright-region step (`stageForSmallRegions`) is tested on its own too.
 */
import { describe, expect, it } from "vitest";
import { detectPaperQuad } from "../../src/client/paper/detect";
import {
  MIN_PIECE_FRACTION,
  PAPER_DETECTION_STAGES,
  isPaperDetectionStage,
  stageForSmallRegions,
} from "../../src/client/paper/detectionStage";
import { generateSyntheticPaper } from "./helpers/synthetic-paper";

const W = 320;
const H = 240;

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A grey frame (`bg`) with white rectangles painted on it, then dark holes cut back out. */
function frame(
  rects: readonly Rect[],
  options: {
    readonly width?: number;
    readonly height?: number;
    readonly bg?: readonly [number, number, number];
    readonly holes?: readonly Rect[];
  } = {},
): ImageData {
  const width = options.width ?? W;
  const height = options.height ?? H;
  const bg = options.bg ?? [60, 60, 60];
  const data = new Uint8ClampedArray(width * height * 4);
  const inside = (r: Rect, x: number, y: number) =>
    x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const white =
        rects.some((r) => inside(r, x, y)) &&
        !(options.holes ?? []).some((r) => inside(r, x, y));
      data[o] = white ? 235 : bg[0];
      data[o + 1] = white ? 235 : bg[1];
      data[o + 2] = white ? 235 : bg[2];
      data[o + 3] = 255;
    }
  }
  return { width, height, data } as unknown as ImageData;
}

function stageOf(image: ImageData): string | undefined {
  const result = detectPaperQuad(image, "a4");
  expect(result.paperRegionFound).toBe(false);
  expect(result.corners).toBeNull();
  return result.failureStage;
}

describe("stageForSmallRegions (the bright-region step, pure)", () => {
  const n = 10_000;
  const floor = 0.1;

  it("no region, or none of a piece's size: no_bright_region", () => {
    expect(stageForSmallRegions([], n, floor)).toBe("no_bright_region");
    expect(stageForSmallRegions([150, 199, 3], n, floor)).toBe(
      "no_bright_region",
    );
  });

  it("two sizeable pieces that together pass the floor: region_split", () => {
    expect(stageForSmallRegions([600, 500, 10], n, floor)).toBe("region_split");
  });

  it("one sizeable piece, or pieces that do not add up: too_small", () => {
    expect(stageForSmallRegions([800, 50], n, floor)).toBe("too_small");
    expect(stageForSmallRegions([400, 300], n, floor)).toBe("too_small");
  });

  it("the piece size is a share of the frame: exactly MIN_PIECE_FRACTION counts", () => {
    const piece = MIN_PIECE_FRACTION * n;
    expect(stageForSmallRegions([piece - 1], n, floor)).toBe(
      "no_bright_region",
    );
    expect(stageForSmallRegions([piece], n, floor)).toBe("too_small");
  });

  it("an empty frame cannot be classified: unknown", () => {
    expect(stageForSmallRegions([5], 0, floor)).toBe("unknown");
  });
});

describe("detectPaperQuad: the stage it stopped at, one synthetic frame each", () => {
  it("no_bright_region: a dark, even frame (nothing bright at all)", () => {
    expect(stageOf(frame([]))).toBe("no_bright_region");
  });

  it("no_bright_region: a bright but colourful frame (nothing low-saturation)", () => {
    expect(stageOf(frame([], { bg: [230, 40, 40] }))).toBe("no_bright_region");
  });

  it("region_split: a sheet cut in two by a dark band across the middle", () => {
    // Each half is 44 x 160 = 7 040 px, 9.2 % of the frame: under the 10 %
    // floor alone, 18.3 % together.
    const left: Rect = { x: 100, y: 40, w: 44, h: 160 };
    const right: Rect = { x: 164, y: 40, w: 44, h: 160 };
    expect(stageOf(frame([left, right]))).toBe("region_split");
  });

  it("region_split: a region that fills under half of its own quad (a thick outline)", () => {
    // The outline is 10 872 px (14.2 %), its quad 27 720 px: a ratio of 0.39.
    const outer: Rect = { x: 60, y: 20, w: 140, h: 198 };
    const hole: Rect = { x: 78, y: 38, w: 104, h: 162 };
    expect(stageOf(frame([outer], { holes: [hole] }))).toBe("region_split");
  });

  it("too_small: one sheet, far away (6 % of the frame)", () => {
    expect(stageOf(frame([{ x: 130, y: 70, w: 50, h: 71 }]))).toBe("too_small");
  });

  it("aspect_mismatch: a white square, not an A4 rectangle", () => {
    expect(stageOf(frame([{ x: 70, y: 30, w: 180, h: 180 }]))).toBe(
      "aspect_mismatch",
    );
  });

  it("exception: reading the frame throws", () => {
    const throwing = {
      width: W,
      height: H,
      get data(): Uint8ClampedArray {
        throw new Error("boom");
      },
    } as unknown as ImageData;
    expect(stageOf(throwing)).toBe("exception");
  });

  it("unknown: a frame too small to look at", () => {
    expect(stageOf(frame([], { width: 12, height: 12 }))).toBe("unknown");
  });

  it("unknown: bright everywhere, so there is no edge to fit", () => {
    expect(stageOf(frame([{ x: 0, y: 0, w: W, h: H }]))).toBe("unknown");
  });

  it("every stage is reached by one of the frames above", () => {
    // The list here and PAPER_DETECTION_STAGES must stay the same set.
    expect([...PAPER_DETECTION_STAGES].sort()).toEqual(
      [
        "aspect_mismatch",
        "exception",
        "no_bright_region",
        "region_split",
        "too_small",
        "unknown",
      ].sort(),
    );
  });
});

describe("detectPaperQuad: a found sheet carries no stage", () => {
  it.each([101, 202, 303])("synthetic sheet seed %i", (seed) => {
    const c = generateSyntheticPaper({ width: 640, height: 480, seed });
    const result = detectPaperQuad(
      { width: 640, height: 480, data: c.data } as unknown as ImageData,
      "a4",
    );
    expect(result.paperRegionFound).toBe(true);
    expect("failureStage" in result).toBe(false);
  });
});

describe("isPaperDetectionStage", () => {
  it("accepts exactly the six stages", () => {
    for (const stage of PAPER_DETECTION_STAGES) {
      expect(isPaperDetectionStage(stage)).toBe(true);
    }
    for (const other of ["", "NONE", "split", null, undefined, 3, {}]) {
      expect(isPaperDetectionStage(other)).toBe(false);
    }
  });
});
