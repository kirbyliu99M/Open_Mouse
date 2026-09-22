import { describe, expect, it } from "vitest";
import {
  collectNumbers,
  collectStringTokens,
  extractNumerals,
  extractWordNumerals,
  findUnknownNumeral,
  normalizeUnicodeDigits,
  normalizeVulgarFractions,
  surroundingToken,
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

describe("surroundingToken", () => {
  it("extends left and right over contiguous letters and digits", () => {
    const text = "It's G502mm long.";
    const start = text.indexOf("502");
    const end = start + "502".length;
    expect(surroundingToken(text, start, end)).toBe("G502mm");
  });

  it("returns just the digits when nothing is glued to them", () => {
    const text = "It's 125 mm long.";
    const start = text.indexOf("125");
    const end = start + "125".length;
    expect(surroundingToken(text, start, end)).toBe("125");
  });

  it("stops at a hyphen — slug parts are separate tokens", () => {
    const text = "the fit-v0-provisional engine";
    const start = text.indexOf("0");
    const end = start + 1;
    expect(surroundingToken(text, start, end)).toBe("v0");
  });
});

describe("collectStringTokens", () => {
  it("collects alphanumeric tokens from nested string leaves, preserving casing", () => {
    // Finding 2: casing is preserved (not lowercased) because the exemption
    // this feeds (`isExemptToken`) is exact-case on purpose — see the
    // comment there. "G502" (from "G502 X") and "g502" (from the lowercase
    // slug) are genuinely different tokens and both survive independently.
    const tokens = collectStringTokens({
      brand: "Logitech",
      model: "G502 X",
      slug: "logitech-g502-x",
      nested: { engineVersion: "fit-v0-provisional" },
      list: ["MX Master 3S"],
      notAString: 42,
    });
    expect([...tokens].sort()).toEqual(
      [
        "Logitech",
        "G502",
        "X",
        "logitech",
        "g502",
        "x",
        "fit",
        "v0",
        "provisional",
        "MX",
        "Master",
        "3S",
      ].sort(),
    );
  });

  it("returns an empty set for input with no strings", () => {
    expect(collectStringTokens({ a: 1, b: [2, 3] })).toEqual(new Set());
  });
});

describe("findUnknownNumeral — Finding 1: digits glued to a preceding letter", () => {
  const allowed = new Set([125, 62]);

  it("rejects 'about68mm' — a digit run glued to prose must not be invisible", () => {
    expect(
      findUnknownNumeral("Your palm reads about68mm narrower.", allowed),
    ).toBe(68);
  });

  it("rejects 'roughly7fingers' — same bypass class, different glue", () => {
    expect(
      findUnknownNumeral("It clears roughly7fingers of space.", allowed),
    ).toBe(7);
  });

  it("still accepts a product name/model token that appears verbatim in the input, even though a digit is glued to a letter", () => {
    const input = {
      slug: "logitech-g502-x",
      brand: "Logitech",
      model: "G502 X",
    };
    const exemptTokens = collectStringTokens(input);
    expect(
      findUnknownNumeral(
        "The Logitech G502 X is a strong match.",
        allowed,
        exemptTokens,
      ),
    ).toBeNull();
  });

  it("still accepts 'MX Master 3S' verbatim from the input", () => {
    const input = { model: "MX Master 3S" };
    const exemptTokens = collectStringTokens(input);
    expect(
      findUnknownNumeral(
        "Consider the MX Master 3S instead.",
        allowed,
        exemptTokens,
      ),
    ).toBeNull();
  });

  it("still accepts the engine version token 'fit-v0-provisional' from the input", () => {
    const input = { engineVersion: "fit-v0-provisional" };
    const exemptTokens = collectStringTokens(input);
    expect(
      findUnknownNumeral(
        "This uses the fit-v0-provisional engine.",
        allowed,
        exemptTokens,
      ),
    ).toBeNull();
  });

  it("does not exempt a digit run just because the same digits appear elsewhere in a different token", () => {
    // "g502x" is not itself a verbatim input token (input has "g502"), so
    // the exemption must not fire, and the glued digit must still be
    // checked normally.
    const input = { model: "G502" };
    const exemptTokens = collectStringTokens(input);
    expect(
      findUnknownNumeral("It's the G502x variant.", allowed, exemptTokens),
    ).toBe(502);
  });

  it("without exemptTokens, a glued product name still surfaces its digits as a plain numeral (caller must supply exemptTokens to protect it)", () => {
    expect(findUnknownNumeral("The G502 is a strong match.", allowed)).toBe(
      502,
    );
  });

  it("Finding 2: exempts 'G502' (exact case, present in the input)", () => {
    const input = { model: "G502" };
    const exemptTokens = collectStringTokens(input);
    expect(
      findUnknownNumeral("The G502 is a strong match.", allowed, exemptTokens),
    ).toBeNull();
  });

  it("Finding 2: does NOT exempt 'g502' (different case) even though 'G502' is verbatim in the input — a quantity must not ride the product-name exemption by re-casing it", () => {
    const input = { model: "G502" };
    const exemptTokens = collectStringTokens(input);
    expect(
      findUnknownNumeral(
        "Expect roughly g502 mm of clearance for your grip.",
        allowed,
        exemptTokens,
      ),
    ).toBe(502);
  });
});

describe("normalizeVulgarFractions", () => {
  it("converts each vulgar fraction character to its decimal value", () => {
    expect(normalizeVulgarFractions("¼")).toBe("0.25");
    expect(normalizeVulgarFractions("½")).toBe("0.5");
    expect(normalizeVulgarFractions("¾")).toBe("0.75");
    expect(normalizeVulgarFractions("⅓")).toBe("0.3333333333");
    expect(normalizeVulgarFractions("⅔")).toBe("0.6666666667");
    expect(normalizeVulgarFractions("⅕")).toBe("0.2");
    expect(normalizeVulgarFractions("⅖")).toBe("0.4");
    expect(normalizeVulgarFractions("⅗")).toBe("0.6");
    expect(normalizeVulgarFractions("⅘")).toBe("0.8");
    expect(normalizeVulgarFractions("⅙")).toBe("0.1666666667");
    expect(normalizeVulgarFractions("⅚")).toBe("0.8333333333");
    expect(normalizeVulgarFractions("⅐")).toBe("0.1428571429");
    expect(normalizeVulgarFractions("⅛")).toBe("0.125");
    expect(normalizeVulgarFractions("⅜")).toBe("0.375");
    expect(normalizeVulgarFractions("⅝")).toBe("0.625");
    expect(normalizeVulgarFractions("⅞")).toBe("0.875");
    expect(normalizeVulgarFractions("⅑")).toBe("0.1111111111");
    expect(normalizeVulgarFractions("⅒")).toBe("0.1");
  });

  it("collapses a literal fraction-slash form 'a⁄b'", () => {
    expect(normalizeVulgarFractions("1⁄2")).toBe("0.5");
  });

  it("leaves ordinary text untouched", () => {
    expect(normalizeVulgarFractions("It's about 5 mm.")).toBe(
      "It's about 5 mm.",
    );
  });
});

describe("findUnknownNumeral — Finding 2: vulgar fractions", () => {
  it("rejects '½' as 0.5, not as the two digits 1 and 2", () => {
    const allowed = new Set([1, 2, 3]); // e.g. rank values 1, 2, 3
    expect(
      findUnknownNumeral(
        "The width gap is only about ½ mm from your palm.",
        allowed,
      ),
    ).toBe(0.5);
  });

  it("accepts '½' when 0.5 is genuinely in the input", () => {
    const allowed = new Set([0.5]);
    expect(findUnknownNumeral("The gap is about ½ mm.", allowed)).toBeNull();
  });

  it("rejects '¾' when 0.75 is not in the input", () => {
    const allowed = new Set([1, 2, 3]);
    expect(findUnknownNumeral("It's ¾ of the way there.", allowed)).toBe(0.75);
  });
});

describe("findUnknownNumeral — Finding 1 (redesigned): ordinal vs. fraction 'third'/'quarter'", () => {
  // Commit 6ffbd0f made ordinal the default and only recognised a fraction
  // directly after "a"/"an"/"one" — inverting hard rule 2's safe direction:
  // a model could invent a fraction just by phrasing around that one word
  // ("roughly third of the palm width" sailed through unchecked). The
  // redesign below defaults third/quarter to their fraction value and
  // carves out only clearly-ordinal phrasing. See the comment above
  // `FRACTION_WORDS` in numerals.ts for the full rationale.
  const allowed = new Set([125, 62, 1, 2, 3]);

  it("does not treat 'the third pick' as the fraction 1/3 (ordinal determiner before)", () => {
    expect(
      findUnknownNumeral("The third pick is also worth a look.", allowed),
    ).toBeNull();
  });

  it("does not treat 'your third option' as a fraction (ordinal determiner before)", () => {
    expect(
      findUnknownNumeral("Your third option runs a bit narrow.", allowed),
    ).toBeNull();
  });

  it("does not treat 'a third-place finish' as a fraction (ordinal noun after)", () => {
    expect(
      findUnknownNumeral("It was a third-place finish overall.", allowed),
    ).toBeNull();
  });

  it("still rejects genuine fraction usage — 'a third of the width' — when 1/3 isn't in the input", () => {
    expect(
      findUnknownNumeral("It's a third of the width narrower.", allowed),
    ).toBeCloseTo(1 / 3);
  });

  it("still accepts genuine fraction usage when 1/3 is in the input", () => {
    const allowsThird = new Set([1 / 3]);
    expect(
      findUnknownNumeral("It's a third of the width narrower.", allowsThird),
    ).toBeNull();
  });

  it("rejects unadorned fraction phrasing 'roughly third of the palm width' — the exact regression a false 'ordinal by default' rule let through", () => {
    expect(
      findUnknownNumeral(
        "It covers roughly third of the palm width for good support.",
        allowed,
      ),
    ).toBeCloseTo(1 / 3);
  });

  it("rejects hyphenated 'two-thirds of users' as a fraction (2 * 1/3)", () => {
    expect(
      findUnknownNumeral("It fits two-thirds of users comfortably.", allowed),
    ).toBeCloseTo(2 / 3);
  });

  it("now flags an unadorned 'quarter' used ambiguously — this reverses the previous (unsafe) direction: 'the first quarter of testing' is neither clearly ordinal nor traceable to the input, so it must flag, not pass silently", () => {
    expect(
      findUnknownNumeral("The first quarter of testing went well.", allowed),
    ).toBeCloseTo(0.25);
  });

  it("still parses 'a quarter' as 0.25 (existing behaviour preserved)", () => {
    expect(extractWordNumerals("a quarter").map((t) => t.value)).toEqual([
      0.25,
    ]);
  });
});
