import { describe, expect, it } from "vitest";
import {
  measureWithUserLength,
  parseUserLength,
  USER_LENGTH_RETAKE,
  checkUserLengthStraightness,
  checkUserLengthProportion,
} from "../../src/client/photo/user-length";
import { assembleUserLengthSubmission } from "../../src/client/photo/submission";
import { detectDeviceFit } from "../../src/client/camera/deviceFit";

const hand = [
  [100, 0],
  [85, 20],
  [70, 45],
  [55, 65],
  [45, 85],
  [80, 100],
  [75, 135],
  [65, 150],
  [55, 145],
  [100, 105],
  [100, 140],
  [100, 165],
  [100, 190],
  [130, 99],
  [131, 133],
  [131, 157],
  [131, 177],
  [160, 98],
  [162, 122],
  [163, 140],
  [163, 155],
].map(([x, y]) => ({ x: x * 3 + 20, y: y * 3 + 40 }));

describe("user length calibration", () => {
  it("accepts a flat synthetic hand at both geometry gates", () => {
    const measured = measureWithUserLength(hand, 190);
    expect(checkUserLengthStraightness(hand)).toBeNull();
    expect(checkUserLengthProportion(measured)).toBeNull();
  });
  it("rejects a curled middle finger at the straightness gate", () => {
    const curled = hand.map((point, index) =>
      index === 10 || index === 11 ? { ...point, x: point.x + 90 } : point,
    );
    expect(checkUserLengthStraightness(curled)?.message).toBe(
      "Straighten your fingers and lay your hand flat, then retake.",
    );
  });
  it("rejects a 25° long-axis tilt at the lower palm proportion bound", () => {
    const narrow = hand.map((point) => ({
      ...point,
      x: hand[0].x + (point.x - hand[0].x) * 0.98,
    }));
    const tilted = narrow.map((point) => ({
      ...point,
      x: hand[0].x + (point.x - hand[0].x) * Math.cos((25 * Math.PI) / 180),
    }));
    expect(
      checkUserLengthProportion(measureWithUserLength(narrow, 190)),
    ).toBeNull();
    expect(
      checkUserLengthProportion(measureWithUserLength(tilted, 190))?.message,
    ).toBe(
      "The photo looks tilted — hold the phone flat, straight above your hand, and retake.",
    );
  });
  it("rejects a 25° width-axis tilt at the upper palm proportion bound", () => {
    const wide = hand.map((point) => ({
      ...point,
      x: hand[0].x + (point.x - hand[0].x) * 1.29,
    }));
    const tilted = wide.map((point) => ({
      ...point,
      y: hand[0].y + (point.y - hand[0].y) * Math.cos((25 * Math.PI) / 180),
    }));
    expect(
      checkUserLengthProportion(measureWithUserLength(wide, 190)),
    ).toBeNull();
    expect(
      checkUserLengthProportion(measureWithUserLength(tilted, 190))?.message,
    ).toBe(
      "The photo looks tilted — hold the phone flat, straight above your hand, and retake.",
    );
  });
  it("uses the wrist to middle-tip distance for scale and retains the exact entered length", () => {
    const measured = measureWithUserLength(hand, 190);
    expect(measured.handLengthMm).toBe(190);
    expect(measured.palmLengthMm).toBe(105);
    expect(measured.palmWidthMm).toBeCloseTo(Math.hypot(80 - 160, 100 - 98));
    const submitted = assembleUserLengthSubmission({
      hand: "right",
      measurements: measured,
      handLengthMm: 190,
    });
    expect(submitted.calibration.referenceMm).toBe(190);
    expect(submitted.calibration.parallaxCorrected).toBe(false);
  });
  it("scales derived measurements linearly with the entered length", () => {
    const a = measureWithUserLength(hand, 150);
    const b = measureWithUserLength(hand, 210);
    expect(b.palmLengthMm / a.palmLengthMm).toBeCloseTo(210 / 150);
    expect(b.palmWidthMm / a.palmWidthMm).toBeCloseTo(210 / 150);
  });
  it("rejects out-of-range input and implausible palm proportions", () => {
    expect(parseUserLength("99")).toBeNull();
    expect(parseUserLength("281")).toBeNull();
    expect(parseUserLength("186.5")).toBe(186.5);
    const narrow = hand.map((p, i) =>
      i === 17 ? { ...p, x: hand[5].x + 1, y: hand[5].y } : p,
    );
    expect(() => measureWithUserLength(narrow, 190)).toThrow(
      USER_LENGTH_RETAKE,
    );
  });
});

describe("device fit", () => {
  it.each([
    [
      "desktop",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130",
      false,
      0,
    ],
    ["phone", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604", true, 5],
    ["phone", "Mozilla/5.0 (Linux; Android 15) Chrome/130 Mobile", true, 5],
    ["in-app", "Mozilla/5.0 (iPhone) Line/14.0", true, 5],
    ["in-app", "Mozilla/5.0 (iPhone) Instagram 300", true, 5],
    ["in-app", "Mozilla/5.0 (iPhone) FBAN/FBIOS; FBAV/400", true, 5],
    ["in-app", "Mozilla/5.0 (Android) MicroMessenger/8", true, 5],
    [
      "desktop",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130",
      false,
      10,
    ],
    [
      "phone",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605 Safari/605",
      true,
      5,
    ],
    ["phone", "Mozilla/5.0 (Linux; Android 15) SamsungBrowser/27", false, 0],
    ["phone", "Mozilla/5.0 (Android 15; Mobile) Firefox/130", false, 0],
    ["phone", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) CriOS/130", false, 0],
    ["in-app", "Mozilla/5.0 (iPhone) BytedanceWebview", true, 5],
    ["in-app", "Mozilla/5.0 (iPhone) musical_ly", true, 5],
    ["in-app", "Mozilla/5.0 (iPhone) Barcelona", true, 5],
    ["in-app", "Mozilla/5.0 (Android) KAKAOTALK", true, 5],
  ] as const)(
    "classifies %s with UA %s",
    (expected, userAgent, coarsePointer, touchPoints) => {
      expect(detectDeviceFit({ userAgent, coarsePointer, touchPoints })).toBe(
        expected,
      );
    },
  );
});
