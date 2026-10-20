/**
 * Scan S2 (V3.2, 2026-10-21): the paper scenes the existing tests already
 * render, run through `detectPaperQuad` and the paper calibration, as one
 * plain JSON record each. `scripts/s2-write-paper-golden.ts` wrote
 * `tests/unit/fixtures/s2-paper-golden.json` from these records BEFORE the
 * failure stage was added to the detector; `paper-detect-stage-golden.test.ts`
 * recomputes them after and asks for every number to be the same.
 *
 * Every field the detector returned before S2 is kept; the one S2 adds
 * (`failureStage`) is left out, so the comparison is "everything that was
 * there is unchanged". The calibration's verdict, its gate codes, the
 * homography and a held-out mm segment are recorded too (any mm difference
 * must be 0).
 */
import { detectPaperQuad } from "../../../src/client/paper/detect";
import { evaluatePaperEdgeCalibration } from "../../../src/client/paper/calibration";
import { checkPaperFound } from "../../../src/client/photo/gates";
import { applyHomography } from "../../../src/client/geometry/homography";
import { generateSyntheticPaper } from "./synthetic-paper";
import {
  renderIndependentScene,
  type IndependentScene,
} from "./independent-scene";

export interface GoldenRecord {
  readonly name: string;
  readonly detection: Record<string, unknown>;
  readonly verdict: {
    readonly ok: boolean;
    readonly errorCodes: readonly string[];
    readonly calibration: unknown;
    readonly homography: readonly number[] | null;
    readonly edgeFitResidualMm: number | null;
    /** A fixed pixel segment through the homography, in mm; `null` without corners. */
    readonly heldOutMm: number | null;
    readonly paperFoundCode: string | null;
  };
}

interface Frame {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

const SEED_BASE = 100000;
const SEEDS = Array.from({ length: 20 }, (_, i) => SEED_BASE + i * 7919);

function syntheticFrames(): Frame[] {
  const out: Frame[] = [];
  const sizes: readonly [number, number][] = [
    [1000, 750],
    [640, 480],
    [320, 240],
  ];
  for (const [width, height] of sizes) {
    for (const seed of SEEDS) {
      const occluder = seed % 3 === 0;
      const c = generateSyntheticPaper({ width, height, seed, occluder });
      out.push({ name: `synthetic ${width}x${height} seed ${seed}`, ...c });
    }
  }
  const extra: {
    name: string;
    o: Parameters<typeof generateSyntheticPaper>[0];
  }[] = [
    {
      name: "curled side 1",
      o: {
        width: 1000,
        height: 750,
        seed: 4242,
        curledSideIndex: 1,
        curlAmplitudePx: 8,
      },
    },
    { name: "flat check", o: { width: 1000, height: 750, seed: 4243 } },
    {
      name: "clip left",
      o: { width: 1000, height: 750, seed: 4244, clipLeftSide: true },
    },
    {
      name: "rotated 20",
      o: { width: 1000, height: 750, seed: 4245, rotationDeg: 20 },
    },
    {
      name: "tilted",
      o: { width: 1000, height: 750, seed: 4246, tiltXDeg: 12, tiltYDeg: -8 },
    },
    {
      name: "light desk",
      o: { width: 1000, height: 750, seed: 4247, backgroundLevel: 170 },
    },
    {
      name: "uniform background",
      o: { width: 640, height: 480, seed: 4248, backgroundLevel: 110 },
    },
  ];
  for (const { name, o } of extra) {
    out.push({ name, ...generateSyntheticPaper(o) });
  }
  return out;
}

const BASE: IndependentScene = {
  frameWidth: 750,
  frameHeight: 1000,
  paperWidthMm: 210,
  paperHeightMm: 297,
  background: "midGrey",
  seed: 7,
};

function independentFrames(): Frame[] {
  const scenes: { name: string; scene: IndependentScene }[] = [];
  for (const rotationDeg of [0, 15, 30, 44, 45, 46, 60, 90, 135, 180]) {
    scenes.push({
      name: `independent rotation ${rotationDeg}`,
      scene: { ...BASE, rotationDeg },
    });
  }
  for (const [tiltXDeg, tiltYDeg] of [
    [10, 0],
    [0, 10],
    [15, 10],
  ] as const) {
    scenes.push({
      name: `independent tilt ${tiltXDeg}/${tiltYDeg}`,
      scene: { ...BASE, tiltXDeg, tiltYDeg },
    });
  }
  for (const background of [
    "brightGrey",
    "lightGrey",
    "woodgrain",
    "nearWhiteDesk",
  ] as const) {
    scenes.push({
      name: `independent background ${background}`,
      scene: { ...BASE, background },
    });
  }
  scenes.push({
    name: "independent second object touching",
    scene: { ...BASE, secondWhiteObject: "touching" },
  });
  scenes.push({
    name: "independent second object separate",
    scene: { ...BASE, secondWhiteObject: "separate" },
  });
  scenes.push({
    name: "independent shadow band",
    scene: { ...BASE, shadowBand: true },
  });
  for (const hand of ["normal", "coveringCorner", "overTopEdge"] as const) {
    scenes.push({ name: `independent hand ${hand}`, scene: { ...BASE, hand } });
  }
  scenes.push({
    name: "independent small fill",
    scene: { ...BASE, fillFraction: 0.3 },
  });
  return scenes.map(({ name, scene }) => {
    const r = renderIndependentScene(scene);
    return { name, width: r.width, height: r.height, data: r.data };
  });
}

/** The scenes in a fixed order. */
export function goldenFrames(): Frame[] {
  return [...syntheticFrames(), ...independentFrames()];
}

/** The record for one frame, without the field S2 adds. */
export function goldenRecord(frame: Frame): GoldenRecord {
  const imageData = {
    width: frame.width,
    height: frame.height,
    data: frame.data,
  } as unknown as ImageData;
  const detection = detectPaperQuad(imageData, "a4");
  const { failureStage: _ignored, ...rest } = detection as typeof detection & {
    failureStage?: unknown;
  };
  void _ignored;
  const evaluation = evaluatePaperEdgeCalibration(detection, "a4", false);
  const homography = evaluation.geometry?.homography ?? null;
  let heldOutMm: number | null = null;
  if (homography) {
    const a = applyHomography(homography, {
      x: frame.width * 0.4,
      y: frame.height * 0.4,
    });
    const b = applyHomography(homography, {
      x: frame.width * 0.6,
      y: frame.height * 0.6,
    });
    heldOutMm = Math.hypot(a.x - b.x, a.y - b.y);
  }
  return JSON.parse(
    JSON.stringify({
      name: frame.name,
      detection: rest,
      verdict: {
        ok: evaluation.ok,
        errorCodes: evaluation.errors.map((e) => e.code),
        calibration: evaluation.calibration,
        homography: homography ? homography.flat() : null,
        edgeFitResidualMm: evaluation.geometry?.edgeFitResidualMm ?? null,
        heldOutMm,
        paperFoundCode:
          checkPaperFound(detection.paperRegionFound)?.code ?? null,
      },
    }),
  ) as GoldenRecord;
}
