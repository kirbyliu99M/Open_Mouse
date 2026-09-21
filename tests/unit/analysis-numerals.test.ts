import { describe, expect, it } from "vitest";
import {
  collectNumbers,
  extractNumerals,
  findUnknownNumeral,
} from "../../src/server/analysis/numerals";

describe("collectNumbers", () => {
  it("walks nested objects and arrays, collecting every numeric leaf", () => {
    const numbers = collectNumbers({
      a: 1,
      b: { c: 2.5, d: [3, { e: 4 }] },
      f: "not a number",
      g: null,
    });
    expect([...numbers].sort((x, y) => x - y)).toEqual([1, 2.5, 3, 4]);
  });
});

describe("extractNumerals", () => {
  it("extracts plain integers and decimals", () => {
    expect(extractNumerals("It is 125 mm long and 0.9 confident.")).toEqual([
      125, 0.9,
    ]);
  });

  it("normalises 125, 125.0 and 125 mm to the same value", () => {
    expect(extractNumerals("125")).toEqual([125]);
    expect(extractNumerals("125.0")).toEqual([125]);
    expect(extractNumerals("125 mm")).toEqual([125]);
  });

  it("extracts negative numbers", () => {
    expect(extractNumerals("delta of -1.5")).toEqual([-1.5]);
  });
});

describe("findUnknownNumeral", () => {
  const allowed = new Set([125, 62, 0.9]);

  it.each([
    ["125", null],
    ["125.0", null],
    ["125 mm", null],
    ["It's 125mm and matches 62mm width.", null],
  ])("accepts %s", (text, expected) => {
    expect(findUnknownNumeral(text, allowed)).toBe(expected);
  });

  it.each([
    ["126", 126],
    ["It's 126mm long.", 126],
  ])("rejects %s", (text, expected) => {
    expect(findUnknownNumeral(text, allowed)).toBe(expected);
  });

  it("returns null for text with no numbers", () => {
    expect(findUnknownNumeral("A great ergonomic fit.", allowed)).toBeNull();
  });
});
