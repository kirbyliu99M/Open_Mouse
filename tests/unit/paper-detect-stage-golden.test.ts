/**
 * Scan S2 (V3.2, 2026-10-21): adding the failure stage changed nothing a
 * found sheet reports. `tests/unit/fixtures/s2-paper-golden.json` was written
 * by the detector BEFORE the stage existed (`scripts/s2-write-paper-golden.ts`,
 * first commit of this branch); here the same scenes run through the detector
 * as it is now. Every field it returned before, the calibration's verdict and
 * gate codes, the homography and a held-out mm segment must be EXACTLY equal
 * (`toStrictEqual` on JSON numbers: a difference of 0, not a tolerance).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { detectPaperQuad } from "../../src/client/paper/detect";
import { isPaperDetectionStage } from "../../src/client/paper/detectionStage";
import {
  goldenFrames,
  goldenRecord,
  type GoldenRecord,
} from "./helpers/s2-golden-scenes";

const golden = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures", "s2-paper-golden.json"), "utf8"),
) as GoldenRecord[];

describe("paper detector — the failure stage changes nothing else (golden, before vs after)", () => {
  const frames = goldenFrames();

  it("covers the same scenes, most of them found sheets", () => {
    expect(frames.map((f) => f.name)).toStrictEqual(golden.map((g) => g.name));
    const found = golden.filter((g) => g.detection.corners !== null).length;
    expect(found).toBeGreaterThanOrEqual(80);
  });

  it("every scene: detection fields, verdict, homography and mm identical", () => {
    const after = frames.map(goldenRecord);
    for (let i = 0; i < golden.length; i++) {
      expect(after[i], golden[i].name).toStrictEqual(golden[i]);
    }
  }, 120_000);

  it("a found sheet carries no stage; a scene with no sheet carries one", () => {
    // Every scene with no sheet, and the first few found ones (the full set
    // is already compared above; this only asks for the field's presence).
    const notFound = new Set(
      golden.filter((g) => !g.detection.paperRegionFound).map((g) => g.name),
    );
    const sample = frames.filter((f, i) => notFound.has(f.name) || i < 3);
    expect(notFound.size).toBeGreaterThan(0);
    for (const frame of sample) {
      const detection = detectPaperQuad(
        {
          width: frame.width,
          height: frame.height,
          data: frame.data,
        } as unknown as ImageData,
        "a4",
      );
      if (detection.paperRegionFound) {
        expect("failureStage" in detection, frame.name).toBe(false);
      } else {
        expect(isPaperDetectionStage(detection.failureStage), frame.name).toBe(
          true,
        );
      }
    }
  }, 120_000);
});
