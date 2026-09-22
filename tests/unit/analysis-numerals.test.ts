import { describe, expect, it } from "vitest";
import {
  collectNumbers,
  extractNumerals,
  extractWordNumerals,
  findUnknownNumeral,
  normalizeUnicodeDigits,
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

describe("normalizeUnicodeDigits", () => {
  it("folds fullwidth digits to ASCII", () => {
    expect(normalizeUnicodeDigits("１２５")).toBe("125");
  });

  it("folds superscript and subscript digits to ASCII", () => {
    expect(normalizeUnicodeDigits("¹²⁵")).toBe("125");
    expect(normalizeUnicodeDigits("₁₂₅")).toBe("125");
  });

  it("folds Arabic-Indic digits to ASCII", () => {
    expect(normalizeUnicodeDigits("١٢٥")).toBe("125");
  });

  it("folds Extended Arabic-Indic (Persian) digits to ASCII", () => {
    expect(normalizeUnicodeDigits("۱۲۵")).toBe("125");
  });

  it("folds Devanagari digits to ASCII", () => {
    expect(normalizeUnicodeDigits("१२५")).toBe("125");
  });

  it("leaves ordinary text untouched", () => {
    expect(normalizeUnicodeDigits("A great ergonomic fit.")).toBe(
      "A great ergonomic fit.",
    );
  });
});

describe("findUnknownNumeral — Unicode digit bypass classes", () => {
  const allowed = new Set([125, 62]);

  it("rejects a fullwidth-digit number not in the input", () => {
    // "１２６" is 126 in fullwidth digits — a disguised new number.
    expect(findUnknownNumeral("It's １２６mm long.", allowed)).toBe(126);
  });

  it("accepts a fullwidth-digit number that matches the input", () => {
    expect(findUnknownNumeral("It's １２５mm long.", allowed)).toBeNull();
  });

  it("rejects a superscript-digit number not in the input", () => {
    expect(findUnknownNumeral("Rated ¹²⁶ on this scale.", allowed)).toBe(126);
  });

  it("rejects an Arabic-Indic-digit number not in the input", () => {
    expect(findUnknownNumeral("طول ١٢٦ ملم", allowed)).toBe(126);
  });

  it("accepts an Arabic-Indic-digit number that matches the input", () => {
    expect(findUnknownNumeral("طول ١٢٥ ملم", allowed)).toBeNull();
  });
});

describe("extractWordNumerals", () => {
  it("parses simple cardinal words", () => {
    expect(extractWordNumerals("five").map((t) => t.value)).toEqual([5]);
    expect(extractWordNumerals("twelve").map((t) => t.value)).toEqual([12]);
  });

  it("parses compound cardinal words", () => {
    expect(extractWordNumerals("twenty-five").map((t) => t.value)).toEqual([
      25,
    ]);
    expect(
      extractWordNumerals("one hundred and five").map((t) => t.value),
    ).toEqual([105]);
  });

  it("parses multiplier and fraction words", () => {
    expect(extractWordNumerals("half").map((t) => t.value)).toEqual([0.5]);
    expect(extractWordNumerals("a dozen").map((t) => t.value)).toEqual([12]);
    expect(extractWordNumerals("double").map((t) => t.value)).toEqual([2]);
    expect(extractWordNumerals("a quarter").map((t) => t.value)).toEqual([
      0.25,
    ]);
  });

  it("flags a word number followed by 'percent' as a percent token", () => {
    const [token] = extractWordNumerals("ninety percent");
    expect(token).toEqual({ value: 90, percent: true });
  });

  it("returns nothing for ordinary prose", () => {
    expect(extractWordNumerals("A great ergonomic fit.")).toEqual([]);
  });
});

describe("findUnknownNumeral — spelled-out number and multiplier bypass classes", () => {
  const allowed = new Set([125, 62, 0.9]);

  it("rejects a spelled-out number not in the input", () => {
    expect(findUnknownNumeral("It runs about five mm shorter.", allowed)).toBe(
      5,
    );
  });

  it("accepts a spelled-out number that matches the input", () => {
    const allowsTwelve = new Set([12]);
    expect(
      findUnknownNumeral("It's twelve mm narrower.", allowsTwelve),
    ).toBeNull();
  });

  it("rejects 'twelve' when twelve was never in the input", () => {
    expect(findUnknownNumeral("It's twelve mm narrower.", allowed)).toBe(12);
  });

  it("rejects 'half' when 0.5 was never in the input", () => {
    expect(findUnknownNumeral("It weighs about half as much.", allowed)).toBe(
      0.5,
    );
  });

  it("accepts 'half' when 0.5 is genuinely in the input", () => {
    const allowsHalf = new Set([0.5]);
    expect(
      findUnknownNumeral("It weighs about half as much.", allowsHalf),
    ).toBeNull();
  });

  it("rejects 'a dozen' when 12 was never in the input", () => {
    expect(
      findUnknownNumeral("There are a dozen options like it.", allowed),
    ).toBe(12);
  });

  it("accepts 'a dozen' when 12 is genuinely in the input", () => {
    const allowsDozen = new Set([12]);
    expect(
      findUnknownNumeral("There are a dozen options like it.", allowsDozen),
    ).toBeNull();
  });

  it("rejects 'double' when 2 was never in the input", () => {
    expect(findUnknownNumeral("It's double the width you need.", allowed)).toBe(
      2,
    );
  });

  it("accepts 'double' when 2 is genuinely in the input", () => {
    const allowsTwo = new Set([2]);
    expect(
      findUnknownNumeral("It's double the width you need.", allowsTwo),
    ).toBeNull();
  });
});

describe("findUnknownNumeral — percentage-form equivalence", () => {
  const allowed = new Set([0.9, 125]);

  it("accepts a percent form of an allowed fraction", () => {
    expect(findUnknownNumeral("Confidence is 90%.", allowed)).toBeNull();
  });

  it("accepts a percent form with a space before the sign", () => {
    expect(findUnknownNumeral("Confidence is 90 %.", allowed)).toBeNull();
  });

  it("accepts a spelled-out percent form of an allowed fraction", () => {
    expect(
      findUnknownNumeral("Confidence is ninety percent.", allowed),
    ).toBeNull();
  });

  it("still rejects a percent-marked number with no equivalent in the input", () => {
    // 45% has no relation to 0.9 or 125 either as a raw value or a fraction.
    expect(findUnknownNumeral("It's rated 45%.", allowed)).toBe(45);
  });

  it("does not treat a bare non-percent number as equivalent to a fraction", () => {
    // "90" with no percent sign is a genuinely different, new number — it
    // must NOT be silently accepted just because 0.9 is in the input.
    expect(findUnknownNumeral("It scores 90 on this axis.", allowed)).toBe(90);
  });

  it("still accepts an exact literal match with no percent involved", () => {
    expect(findUnknownNumeral("It's 125mm long.", allowed)).toBeNull();
  });
});
