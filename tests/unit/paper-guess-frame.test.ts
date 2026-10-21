/**
 * F10 item 3 (Kirby's second phone test 2026-10-21/22, candidate): 「即便沒有
 * 掃描成功，還是需要先幫用戶大致拉出框線」. On a failure the detector also
 * returns a rough quad around the bright region (`failureGuess` ->
 * `guessCorners`), and the adjustment screen opens on it (or on the corners it
 * did find) instead of the centred sheet.
 *
 * What is pinned here (SIMULATED scenes, 模擬):
 * - the S2 golden scenes with no sheet found: how far the frame the screen
 *   opens with is from the sheet's true corners, against the centred frame;
 * - a sheet found with only some of its corners (partial corners + guess);
 * - with the option on, every found sheet in the S2 golden set reports exactly
 *   what it reported before (the guess is added only where corners is null),
 *   one detector call per scene.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectPaperQuad,
  failureGuessFor,
  guessPlausibility,
} from "../../src/client/paper/detect";
import { assumedFocalPxFromFov } from "../../src/client/paper/orientation";
import {
  cornerCheckDistances,
  startAdjust,
} from "../../src/client/camera/paperAdjustState";
import type { Quad4 } from "../../src/client/paper/manualQuad";
import type { PhotoOverlay } from "../../src/client/photo/pipeline";
import {
  renderIndependentScene,
  type IndependentScene,
} from "./helpers/independent-scene";
import { generateSyntheticPaper } from "./helpers/synthetic-paper";
import { goldenFrames, type GoldenRecord } from "./helpers/s2-golden-scenes";

const BASE: IndependentScene = {
  frameWidth: 750,
  frameHeight: 1000,
  paperWidthMm: 210,
  paperHeightMm: 297,
  background: "midGrey",
  seed: 7,
};

/** The four S2 golden scenes in which the detector finds no sheet. */
const NOT_FOUND: { name: string; scene: IndependentScene }[] = [
  {
    name: "independent background nearWhiteDesk",
    scene: { ...BASE, background: "nearWhiteDesk" },
  },
  {
    name: "independent second object touching",
    scene: { ...BASE, secondWhiteObject: "touching" },
  },
  { name: "independent shadow band", scene: { ...BASE, shadowBand: true } },
  { name: "independent small fill", scene: { ...BASE, fillFraction: 0.3 } },
];

function asImage(r: {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}): ImageData {
  return {
    width: r.width,
    height: r.height,
    data: r.data,
  } as unknown as ImageData;
}

function overlayFor(
  width: number,
  height: number,
  detection: ReturnType<typeof detectPaperQuad>,
): PhotoOverlay {
  return {
    imageWidth: width,
    imageHeight: height,
    markers: [],
    card: null,
    landmarksPx: null,
    ...(detection.paperRegionFound &&
    detection.partialCorners.some((p) => p !== null)
      ? { paperPartialCorners: detection.partialCorners }
      : {}),
    ...(detection.guessCorners
      ? { paperGuessCorners: detection.guessCorners }
      : {}),
  };
}

const mean = (xs: readonly number[]) =>
  xs.reduce((s, x) => s + x, 0) / xs.length;

describe("the frame a failed photo opens with (F10): the rough guess, against the centred sheet", () => {
  it("the four S2 golden scenes with no sheet: the frame opens on average nearer the true corners than the centred sheet, never further", () => {
    const rows: string[] = [];
    const guessMeans: number[] = [];
    const centredMeans: number[] = [];
    for (const { name, scene } of NOT_FOUND) {
      const r = renderIndependentScene(scene);
      const detection = detectPaperQuad(asImage(r), "a4", {
        failureGuess: true,
      });
      expect(detection.corners, name).toBeNull();
      expect(detection.paperRegionFound, name).toBe(false);
      const overlay = overlayFor(r.width, r.height, detection);
      const opened = startAdjust({ entry: "rescue", overlay, paperSize: "a4" });
      const centred = startAdjust({
        entry: "rescue",
        overlay: { ...overlay, paperGuessCorners: undefined },
        paperSize: "a4",
      });
      expect(centred.start.from).toBe("centred");
      const truth = r.corners as unknown as Quad4;
      const g = mean(cornerCheckDistances(opened.corners, truth));
      const c = mean(cornerCheckDistances(centred.corners, truth));
      guessMeans.push(g);
      centredMeans.push(c);
      expect(g, name).toBeLessThanOrEqual(c + 1e-9);
      rows.push(
        `${name}: stage ${detection.failureStage}, opens on ${opened.start.from}, mean corner distance ${g.toFixed(1)} px (centred ${c.toFixed(1)} px)`,
      );
      // Corners of a guess are never placed: each must be confirmed.
      if (opened.start.from === "guess")
        expect(opened.placed).toEqual([false, false, false, false]);
    }
    console.info(
      `[F10 item 3, simulated, 750x1000 frames]\n${rows.join("\n")}\nmean over the 4 scenes: guess ${mean(guessMeans).toFixed(1)} px, centred ${mean(centredMeans).toFixed(1)} px`,
    );
    expect(mean(guessMeans)).toBeLessThan(mean(centredMeans));
  }, 60_000);

  it("a sheet found with two of its corners (clip left): the two found ones in place and placed, the rest from the rough quad", () => {
    const c = generateSyntheticPaper({
      width: 1000,
      height: 750,
      seed: 4244,
      clipLeftSide: true,
    });
    const detection = detectPaperQuad(asImage(c), "a4", { failureGuess: true });
    expect(detection.paperRegionFound).toBe(true);
    expect(detection.corners).toBeNull();
    expect(detection.cornersSeen).toBe(2);
    expect(detection.guessCorners).not.toBeNull();
    const opened = startAdjust({
      entry: "rescue",
      overlay: overlayFor(c.width, c.height, detection),
      paperSize: "a4",
    });
    expect(opened.start.from).toBe("guess");
    expect(opened.placed.filter(Boolean)).toHaveLength(2);
    detection.partialCorners.forEach((p, i) => {
      if (p) expect(opened.corners[i]).toEqual(p);
    });
    const centred = startAdjust({
      entry: "rescue",
      overlay: {
        imageWidth: c.width,
        imageHeight: c.height,
        markers: [],
        card: null,
        landmarksPx: null,
      },
      paperSize: "a4",
    });
    const truth = c.trueCorners as unknown as Quad4;
    const g = mean(cornerCheckDistances(opened.corners, truth));
    const k = mean(cornerCheckDistances(centred.corners, truth));
    console.info(
      `[F10 item 3, simulated] clip left (1000x750, 2 corners found): mean corner distance ${g.toFixed(1)} px (centred ${k.toFixed(1)} px)`,
    );
    expect(g).toBeLessThan(k);
  });

  it("without the option the detector returns no guess (the live viewfinder does no extra work)", () => {
    const r = renderIndependentScene(NOT_FOUND[2].scene);
    const detection = detectPaperQuad(asImage(r), "a4");
    expect("guessCorners" in detection).toBe(false);
  });
});

describe("the guess changes nothing a found sheet reports (S2 golden, option on)", () => {
  const golden = JSON.parse(
    readFileSync(
      resolve(__dirname, "fixtures", "s2-paper-golden.json"),
      "utf8",
    ),
  ) as GoldenRecord[];

  it("every scene: the detection's fields identical to the golden; the guess only where corners is null", () => {
    const frames = goldenFrames();
    expect(frames.map((f) => f.name)).toStrictEqual(golden.map((g) => g.name));
    let guessed = 0;
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const detection = detectPaperQuad(asImage(f), "a4", {
        failureGuess: true,
      });
      const {
        failureStage: _stage,
        guessCorners,
        ...rest
      } = detection as typeof detection & { failureStage?: unknown };
      void _stage;
      expect(JSON.parse(JSON.stringify(rest)), f.name).toStrictEqual(
        golden[i].detection,
      );
      if (detection.corners !== null) {
        expect("guessCorners" in detection, f.name).toBe(false);
      } else {
        expect("guessCorners" in detection, f.name).toBe(true);
        if (guessCorners) guessed += 1;
      }
    }
    // Of the five without all four corners (four with no sheet, clip left),
    // every one but the near-white desk (no guess that looks like A4) has one.
    expect(golden.filter((g) => g.detection.corners === null)).toHaveLength(5);
    expect(guessed).toBe(4);
  }, 120_000);
});

describe("failureGuessFor / guessPlausibility (pure)", () => {
  const RECT: [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ] = [
    { x: 189, y: 238 },
    { x: 561, y: 238 },
    { x: 561, y: 763 },
    { x: 189, y: 763 },
  ];
  const found = {
    corners: RECT,
    cornersSeen: 4 as const,
    cornersFound: [true, true, true, true] as const,
    partialCorners: RECT,
    minSideCoverage: 1,
    edgeFitResidualPx: 0.2,
    worstSideIndex: 0 as const,
    paperRegionFound: true,
  };
  it("a sheet with all four corners is returned as the same object; any other result carries the guess (or null)", () => {
    expect(failureGuessFor(found, { corners: RECT })).toBe(found);
    const none = { ...found, corners: null, paperRegionFound: false };
    expect(failureGuessFor(none, { corners: RECT }).guessCorners).toEqual(RECT);
    expect(failureGuessFor(none, { corners: null }).guessCorners).toBeNull();
    expect(failureGuessFor(none, null)).toBe(none);
  });
  it("an A4-shaped quad scores near 0; a frame around a bright desk or off the photo does not", () => {
    const f = assumedFocalPxFromFov(750);
    expect(guessPlausibility(RECT, "a4", 750, 1000, f)).toBeLessThan(0.05);
    const desk: typeof RECT = [
      { x: 1, y: 287 },
      { x: 750, y: 1 },
      { x: 559, y: 762 },
      { x: 1, y: 1000 },
    ];
    expect(guessPlausibility(desk, "a4", 750, 1000, f)).toBeGreaterThan(0.6);
    const off: typeof RECT = [
      { x: -200, y: 238 },
      { x: 561, y: 238 },
      { x: 561, y: 763 },
      { x: 189, y: 763 },
    ];
    expect(guessPlausibility(off, "a4", 750, 1000, f)).toBe(Infinity);
  });
});
