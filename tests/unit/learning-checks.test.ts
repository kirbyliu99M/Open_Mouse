import { describe, expect, it } from "vitest";
import {
  compareFileNames,
  evaluateLearningPhoto,
  type LearningFindings,
} from "../../src/lib/learning/checks";
import type { KitCode } from "../../src/lib/learning/kit";

const topDown: KitCode = {
  kind: "gesture",
  version: 1,
  gesture: "G01",
  hand: "right",
};
const side: KitCode = {
  kind: "gesture",
  version: 1,
  gesture: "G06",
  hand: "left",
};

const good: LearningFindings = {
  code: topDown,
  markerIds: [0, 1, 2, 3, 4],
  reprojectionErrorMm: 0.4,
  laplacianVariance: 120,
  handFound: true,
  detectedHand: "right",
  paperCornersSeen: 4,
};

const tones = (f: LearningFindings) =>
  Object.fromEntries(
    evaluateLearningPhoto(f).checks.map((c) => [c.id, c.tone]),
  );

describe("learning photo checks", () => {
  it("passes a clean top-down photo", () => {
    const r = evaluateLearningPhoto(good);
    expect(r.verdict).toBe("ready");
    expect(r.checks.every((c) => c.tone === "ok")).toBe(true);
  });

  it("cannot identify a photo without a QR code, whatever else it shows", () => {
    const r = evaluateLearningPhoto({ ...good, code: null });
    expect(r.verdict).toBe("unidentified");
    expect(r.checks[0]).toMatchObject({ id: "qr", tone: "bad" });
  });

  it("treats a participant card as a slate", () => {
    const r = evaluateLearningPhoto({
      ...good,
      code: { kind: "participant", version: 1, participant: "P012" },
    });
    expect(r.verdict).toBe("slate");
    expect(r.checks[0]?.message).toContain("P012");
  });

  it("names the missing corner markers", () => {
    const r = evaluateLearningPhoto({
      ...good,
      markerIds: [0, 2],
      reprojectionErrorMm: null,
    });
    expect(r.verdict).toBe("retake");
    expect(r.checks.find((c) => c.id === "markers")?.message).toMatch(
      /^Corner markers 1, 3 not found/,
    );
  });

  it("rejects a bad fit, blur and a missing hand from above", () => {
    expect(tones({ ...good, reprojectionErrorMm: 1.4 }).fit).toBe("bad");
    expect(tones({ ...good, laplacianVariance: 10 }).sharp).toBe("bad");
    expect(tones({ ...good, handFound: false, detectedHand: null }).hand).toBe(
      "bad",
    );
  });

  it("only warns about missing paper corners, because the markers are the ground truth", () => {
    const r = evaluateLearningPhoto({ ...good, paperCornersSeen: 3 });
    expect(r.verdict).toBe("ready");
    expect(r.checks.find((c) => c.id === "paper")).toMatchObject({
      tone: "warn",
    });
  });

  it("warns, not fails, when the detected hand contradicts the page", () => {
    const r = evaluateLearningPhoto({ ...good, detectedHand: "left" });
    expect(r.verdict).toBe("ready");
    expect(r.checks.find((c) => c.id === "handedness")?.tone).toBe("warn");
  });

  it("checks the strip markers on side poses and tolerates no hand", () => {
    const base = {
      ...good,
      code: side,
      markerIds: [4, 5],
      reprojectionErrorMm: null,
      detectedHand: null,
    };
    expect(evaluateLearningPhoto({ ...base, handFound: false }).verdict).toBe(
      "ready",
    );
    const missing = evaluateLearningPhoto({ ...base, markerIds: [4] });
    expect(missing.verdict).toBe("retake");
    expect(missing.checks.find((c) => c.id === "markers")?.message).toMatch(
      /^Strip marker 5 not found/,
    );
    expect(
      evaluateLearningPhoto(base).checks.some((c) => c.id === "paper"),
    ).toBe(false);
  });

  it("orders phone file names in capture order", () => {
    expect(
      ["IMG_0010.JPG", "IMG_0009.JPG", "img_0100.jpg"].sort(compareFileNames),
    ).toEqual(["IMG_0009.JPG", "IMG_0010.JPG", "img_0100.jpg"]);
  });
});
