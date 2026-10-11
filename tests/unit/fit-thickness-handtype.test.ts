import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FitPreferences } from "../../src/lib/contracts/fit";
import type { HandMeasurements } from "../../src/lib/contracts/measurement";
import { computePriors } from "../../src/server/fit/priors";
import { scoreFitV1 } from "../../src/server/fit/score-v1";
import { computeTargets } from "../../src/server/fit/targets";
import type { CatalogueMouse } from "../../src/server/fit/types";

// The label itself cannot show which targets it was read from (no real hand
// flips a size class over a 1.5 mm height shift), so this spy records what
// `classifyHandType` is handed: it must be the targets WITHOUT the shift.
const seen: { lengthMm: number; gripWidthMm: number; heightMm: number }[] = [];
vi.mock("../../src/lib/fit/handType", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/lib/fit/handType")>();
  return {
    ...actual,
    classifyHandType: (...args: Parameters<typeof actual.classifyHandType>) => {
      seen.push({ ...args[0] });
      return actual.classifyHandType(...args);
    },
  };
});

const catalogue: CatalogueMouse[] = [
  {
    slug: "a",
    brand: "Acme",
    model: "A",
    lengthMm: 115,
    widthMm: 67,
    heightMm: 37,
    weightG: null,
    size: "medium",
    handCompatibility: null,
    shape: null,
    humpPlacement: null,
    frontFlare: null,
    sideCurvature: null,
    thumbRest: null,
    ringFingerRest: null,
  },
];
const priors = computePriors(catalogue);
const NO_ANSWER: FitPreferences = { includeVertical: false };

beforeEach(() => {
  seen.length = 0;
});

describe("hand type is classified from the unshifted targets", () => {
  const hands: [string, HandMeasurements][] = [
    [
      "handLengthMm = 100 (contract minimum)",
      {
        handLengthMm: 100,
        palmLengthMm: 58,
        palmWidthMm: 50,
      },
    ],
    [
      "a 185 mm claw hand",
      {
        handLengthMm: 185,
        palmLengthMm: 104,
        palmWidthMm: 76,
      },
    ],
  ];

  it.each(hands)("%s", (_n, m) => {
    for (const level of ["thin", "medium", "thick"] as const) {
      seen.length = 0;
      const out = scoreFitV1(
        m,
        catalogue,
        { ...NO_ANSWER, palmThickness: level },
        "right",
        priors,
      );
      expect(seen).toHaveLength(1);
      expect(seen[0]).toEqual(
        computeTargets(m.handLengthMm, m.palmWidthMm, out.gripStyle.used),
      );
      if (level === "medium") continue;
      // The response's own targets are the shifted ones.
      expect(out.targets.heightMm).toBeCloseTo(
        seen[0]!.heightMm + (level === "thin" ? -1.5 : 1.5),
        12,
      );
    }
  });
});
