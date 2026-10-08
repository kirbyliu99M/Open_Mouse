import { describe, expect, it } from "vitest";
import seedRows from "../../src/db/seed/logitech.json";
import {
  GRIP_STYLES,
  HAND_TYPE_SIZES,
  HAND_TYPE_WIDTHS,
} from "../../src/lib/contracts/fit";
import {
  classifyHandType,
  handTypeStatsFromCatalogue,
} from "../../src/lib/fit/handType";
import { computeTargets } from "../../src/server/fit/targets";
import golden from "./fixtures/fit-golden.json";

const stats = handTypeStatsFromCatalogue(
  seedRows as { lengthMm: number; widthMm: number }[],
)!;

describe("handTypeStatsFromCatalogue", () => {
  it("is the median of width/length", () => {
    expect(
      handTypeStatsFromCatalogue([
        { lengthMm: 100, widthMm: 50 },
        { lengthMm: 100, widthMm: 60 },
        { lengthMm: 100, widthMm: 70 },
      ]),
    ).toEqual({ widthToLengthSplit: 0.6 });
    expect(
      handTypeStatsFromCatalogue([
        { lengthMm: 100, widthMm: 50 },
        { lengthMm: 100, widthMm: 60 },
      ]),
    ).toEqual({ widthToLengthSplit: 0.55 });
  });

  it("is null for an empty catalogue", () => {
    expect(handTypeStatsFromCatalogue([])).toBeNull();
  });
});

describe("classifyHandType", () => {
  // The four golden hands, each read with the grip its ratio predicts. The
  // expected values follow the spec rule: size = computeSize of the target
  // mouse (fingertip read as small), width = target width / target length
  // against the seed's median.
  it.each([
    ["small_fingertip", "fingertip", "small", "wide"],
    ["medium_claw", "claw", "small", "wide"],
    ["large_palm", "palm", "large", "slim"],
    ["left_handed", "claw", "small", "wide"],
  ] as const)("%s read as %s", (name, grip, size, width) => {
    const m = (
      golden as Record<
        string,
        { measurements: { handLengthMm: number; palmWidthMm: number } }
      >
    )[name].measurements;
    const targets = computeTargets(m.handLengthMm, m.palmWidthMm, grip);
    expect(classifyHandType(targets, grip, stats)).toEqual({
      size,
      grip,
      width,
    });
  });

  it("returns only contract values", () => {
    for (const grip of GRIP_STYLES) {
      const t = computeTargets(190, 80, grip);
      const h = classifyHandType(t, grip, stats);
      expect(HAND_TYPE_SIZES).toContain(h.size);
      expect(HAND_TYPE_WIDTHS).toContain(h.width);
      expect(h.grip).toBe(grip);
    }
  });

  it("splits wide from slim at the catalogue ratio (at the split is slim)", () => {
    const t = { lengthMm: 100, heightMm: 40, gripWidthMm: 60 };
    expect(classifyHandType(t, "claw", { widthToLengthSplit: 0.6 }).width).toBe(
      "slim",
    );
    expect(
      classifyHandType(t, "claw", { widthToLengthSplit: 0.59 }).width,
    ).toBe("wide");
  });

  it("is pure: the same input gives the same output", () => {
    const t = computeTargets(185, 76, "claw");
    expect(classifyHandType(t, "claw", stats)).toEqual(
      classifyHandType(t, "claw", stats),
    );
  });
});
