import { describe, expect, it } from "vitest";
import {
  formatMm,
  formatSignedMm,
  formatWeight,
} from "../../src/components/results/format";
import { reasonText } from "../../src/components/results/reasons";
import {
  collectNumbers,
  extractNumerals,
  extractWordNumerals,
  findUnknownNumeral,
  normalizeUnicodeDigits,
  normalizeVulgarFractions,
  stringTokens,
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

describe("stringTokens", () => {
  it("collects alphanumeric tokens from a single string, preserving casing", () => {
    // Finding 4: casing is preserved (not lowercased) because the exemption
    // this feeds (`isExemptToken`) is exact-case on purpose — see the
    // comment there.
    expect([...stringTokens("G502 X")].sort()).toEqual(["G502", "X"]);
    expect([...stringTokens("MX Master 3S")].sort()).toEqual(
      ["MX", "Master", "3S"].sort(),
    );
  });

  it("returns an empty set for a string with no alphanumeric tokens", () => {
    expect(stringTokens("---")).toEqual(new Set());
  });

  // Change 1: `stringTokens` operates on ONE string a caller names
  // explicitly (e.g. a `brand` or `model` field) — there is no longer a
  // recursive collector that walks an entire input object, because that
  // used to pull a kebab-case `slug` (e.g. "logitech-g502-x") into the
  // exempt set for free, silently exempting its lowercase digit run too.
  // See analyse.ts's `collectExemptTokens` for how a caller builds the real
  // exempt set field by field, and the "findUnknownNumeral — Change 1"
  // describe block below for the end-to-end regression this fixes.
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

  it("still accepts a product name/model token that appears verbatim in a display field, even though a digit is glued to a letter", () => {
    // A caller builds exemptTokens from display fields only (brand/model),
    // never a slug — see analyse.ts's `collectExemptTokens`.
    const exemptTokens = new Set([
      ...stringTokens("Logitech"),
      ...stringTokens("G502 X"),
    ]);
    expect(
      findUnknownNumeral(
        "The Logitech G502 X is a strong match.",
        allowed,
        exemptTokens,
      ),
    ).toBeNull();
  });

  it("still accepts 'MX Master 3S' verbatim from a display field", () => {
    const exemptTokens = stringTokens("MX Master 3S");
    expect(
      findUnknownNumeral(
        "Consider the MX Master 3S instead.",
        allowed,
        exemptTokens,
      ),
    ).toBeNull();
  });

  it("does not exempt a digit run just because the same digits appear elsewhere in a different token", () => {
    // "g502x" is not itself a verbatim input token (input has "g502"), so
    // the exemption must not fire, and the glued digit must still be
    // checked normally.
    const exemptTokens = stringTokens("G502");
    expect(
      findUnknownNumeral("It's the G502x variant.", allowed, exemptTokens),
    ).toBe(502);
  });

  it("without exemptTokens, a glued product name still surfaces its digits as a plain numeral (caller must supply exemptTokens to protect it)", () => {
    expect(findUnknownNumeral("The G502 is a strong match.", allowed)).toBe(
      502,
    );
  });

  it("Finding 4: exempts 'G502' (exact case, present in a display field)", () => {
    const exemptTokens = stringTokens("G502");
    expect(
      findUnknownNumeral("The G502 is a strong match.", allowed, exemptTokens),
    ).toBeNull();
  });

  it("Finding 4: does NOT exempt 'g502' (different case) even though 'G502' is verbatim in a display field — a quantity must not ride the product-name exemption by re-casing it", () => {
    const exemptTokens = stringTokens("G502");
    expect(
      findUnknownNumeral(
        "Expect roughly g502 mm of clearance for your grip.",
        allowed,
        exemptTokens,
      ),
    ).toBe(502);
  });
});

describe("findUnknownNumeral — Change 1: the exemption source is display fields only, never a slug", () => {
  const allowed = new Set([125, 62]);

  // Real pipeline shape: `slugify("Logitech", "G502 X")` (see
  // src/server/catalogue/seed-rows.ts) produces the lowercase, hyphenated
  // slug "logitech-g502-x". A correct exempt set is built ONLY from
  // stringTokens over brand/model — never the slug — so "g502" (lowercase)
  // must still flag even though it is exactly the digit run baked into the
  // real slug for this exact model.
  const displayFieldTokens = new Set([
    ...stringTokens("Logitech"),
    ...stringTokens("G502 X"),
  ]);

  it("rejects a lowercase 'g502' used as a plain quantity, even though it equals the real slug's digit run", () => {
    expect(
      findUnknownNumeral(
        "Expect roughly g502 mm of clearance for your grip.",
        allowed,
        displayFieldTokens,
      ),
    ).toBe(502);
  });

  it("still exempts the correctly-cased 'G502 X' reproduced from the model field", () => {
    expect(
      findUnknownNumeral(
        "The G502 X fits your grip well.",
        allowed,
        displayFieldTokens,
      ),
    ).toBeNull();
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
    expect(normalizeVulgarFractions("1⁄2")).toBe("0.5 ; 1 ; 2");
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

describe("slash fractions ('1/3') are one number, not two", () => {
  // Read digit by digit, "約1/3" is the numbers 1 and 3: both easy to have in
  // the input (a rank and a count), so the fraction itself was never checked.
  const allowed = new Set([1, 3]);

  it("normalizeVulgarFractions folds a slash fraction like '⅓'", () => {
    // The quotient first, then the two numbers written: all three are checked.
    expect(normalizeVulgarFractions("1/3")).toBe("0.3333333333 ; 1 ; 3");
    expect(normalizeVulgarFractions("1 / 3")).toBe("0.3333333333 ; 1 ; 3");
    expect(normalizeVulgarFractions("１／３")).toBe("0.3333333333 ; 1 ; 3");
    expect(normalizeVulgarFractions("１/３")).toBe("0.3333333333 ; 1 ; 3");
    expect(normalizeVulgarFractions("3/4")).toBe("0.75 ; 3 ; 4");
    expect(normalizeVulgarFractions("1.5/3")).toBe("0.5 ; 1.5 ; 3");
    expect(normalizeVulgarFractions("about1/2 mm")).toBe("about0.5 ; 1 ; 2 mm");
    // A vulgar fraction character has no operands.
    expect(normalizeVulgarFractions("½")).toBe("0.5");
  });

  it("normalizeUnicodeDigits folds one written in another script's digits", () => {
    expect(normalizeUnicodeDigits("١/٣")).toBe("0.3333333333 ; 1 ; 3");
    expect(normalizeUnicodeDigits("१/४")).toBe("0.25 ; 1 ; 4");
  });

  it("rejects '約1/3' when only 1 and 3 are in the input", () => {
    expect(findUnknownNumeral("約1/3", allowed)).toBeCloseTo(1 / 3, 9);
    expect(findUnknownNumeral("about 1/3 shorter", allowed)).toBeCloseTo(
      1 / 3,
      9,
    );
  });

  it("rejects the full-width, spaced and fraction-slash spellings too", () => {
    expect(findUnknownNumeral("約１／３", allowed)).toBeCloseTo(1 / 3, 9);
    expect(findUnknownNumeral("約 1 / 3", allowed)).toBeCloseTo(1 / 3, 9);
    expect(findUnknownNumeral("約1⁄3", allowed)).toBeCloseTo(1 / 3, 9);
    expect(findUnknownNumeral("約1／3", allowed)).toBeCloseTo(1 / 3, 9);
    expect(findUnknownNumeral("about1/3", allowed)).toBeCloseTo(1 / 3, 9);
  });

  it("accepts the fraction when its value is in the input", () => {
    // ...and so are the two numbers written.
    expect(findUnknownNumeral("約1/3", new Set([1, 3, 1 / 3]))).toBeNull();
    expect(findUnknownNumeral("約１／２", new Set([1, 2, 0.5]))).toBeNull();
    expect(findUnknownNumeral("約1/3", new Set([1 / 3]))).toBe(1);
  });

  it("a chain of slashes is not a fraction: every number in it is checked", () => {
    expect(findUnknownNumeral("2024/10/05", new Set([10, 5]))).toBe(2024);
    expect(findUnknownNumeral("2024/10/05", new Set([2024, 10, 5]))).toBeNull();
    expect(findUnknownNumeral("1/2/3", new Set([1, 2]))).toBe(3);
  });

  it("a zero denominator is not a fraction", () => {
    expect(findUnknownNumeral("1/0", new Set([1]))).toBe(0);
    expect(findUnknownNumeral("1/0", new Set([1, 0]))).toBeNull();
  });

  describe("a score out of 100 ('78/100') is the score, not 0.78", () => {
    // Fit scores run 0 to 100, so "78/100" and "fit 78/100" are natural.
    it.each([
      "78/100",
      "fit 78/100",
      "78 / 100",
      "７８／１００",
      "78⁄100",
      "總分 78/100 分",
      "The fit score is 78/100.",
    ])("passes when 78 is in the input: %s", (text) => {
      expect(findUnknownNumeral(text, new Set([78]))).toBeNull();
    });

    it("passes a decimal score that is in the input", () => {
      expect(findUnknownNumeral("78.5/100", new Set([78.5]))).toBeNull();
    });

    it.each(["78/100", "fit 78/100", "７８／１００"])(
      "is flagged when 78 is not in the input: %s",
      (text) => {
        expect(findUnknownNumeral(text, new Set([1, 3]))).toBeCloseTo(0.78, 9);
      },
    );

    it("other slash fractions stay fractions, even beside an allowed score", () => {
      const allowed = new Set([1, 3, 50, 78, 200]);
      expect(findUnknownNumeral("1/3", allowed)).toBeCloseTo(1 / 3, 9);
      expect(findUnknownNumeral("50/200", allowed)).toBeCloseTo(0.25, 9);
      expect(findUnknownNumeral("78/1000", allowed)).toBeCloseTo(0.078, 9);
      expect(findUnknownNumeral("78/10", allowed)).toBeCloseTo(7.8, 9);
      expect(findUnknownNumeral("fit 78/100, about 1/3", allowed)).toBeCloseTo(
        1 / 3,
        9,
      );
    });

    it("a chain is still not a score: every number in it is checked", () => {
      expect(findUnknownNumeral("78/100/5", new Set([78, 5]))).toBe(100);
    });

    it("100 itself does not need to be in the input", () => {
      expect(findUnknownNumeral("78/100", new Set([78]))).toBeNull();
    });
  });

  it("leaves slashes that are not between two numbers alone", () => {
    expect(normalizeVulgarFractions("and/or")).toBe("and/or");
    expect(normalizeVulgarFractions("km/h 3/")).toBe("km/h 3/");
    expect(findUnknownNumeral("a and/or b", new Set())).toBeNull();
  });
});

describe("findUnknownNumeral — Finding 3 (redesigned): ordinal vs. fraction 'third'/'quarter'", () => {
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

  it("Change 2: does not treat 'the third-place finish' as a fraction (ordinal determiner before, next word isn't 'of')", () => {
    expect(
      findUnknownNumeral("It was the third-place finish overall.", allowed),
    ).toBeNull();
  });

  it("Change 2: DOES now flag 'a third-place finish' — 'a' is not a recognised ordinal determiner, and there is no longer a result-noun carve-out; this is the accepted false-positive cost of collapsing to one strict rule", () => {
    expect(
      findUnknownNumeral("It was a third-place finish overall.", allowed),
    ).toBeCloseTo(1 / 3);
  });

  it("Change 2 repro: rejects 'the third of the palm width' — a determiner before is not enough on its own when 'of' follows (this used to slip through when either half alone was sufficient)", () => {
    expect(
      findUnknownNumeral("It's roughly the third of the palm width.", allowed),
    ).toBeCloseTo(1 / 3);
  });

  it("Change 2 repro: rejects a bare fraction whose next sentence happens to start with a former carve-out noun ('It covers roughly third. Pick something else.')", () => {
    expect(
      findUnknownNumeral(
        "It covers roughly third. Pick something else.",
        allowed,
      ),
    ).toBeCloseTo(1 / 3);
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

describe("findUnknownNumeral — closing the sentence-boundary gap (formerly KNOWN GAP)", () => {
  // Exact repro from the brief: "the" ends one sentence, "Third" starts the
  // next. Letters-only tokenization used to see them as directly adjacent
  // ("the","third"), so the ordinal-determiner rule wrongly exempted the
  // fraction. `boundaryBeforeToken` in numerals.ts now tracks a real
  // sentence-ending period between them and blocks the exemption.
  const allowed: ReadonlySet<number> = new Set();

  it("exact repro: 'Bring the. Third mm of clearance is available.' is now flagged", () => {
    expect(
      findUnknownNumeral(
        "Bring the. Third mm of clearance is available.",
        allowed,
      ),
    ).toBeCloseTo(1 / 3);
  });

  it.each([
    ["period", "Bring the. Third mm of clearance is available."],
    ["exclamation mark", "Bring the! Third mm of clearance is available."],
    ["question mark", "Bring the? Third mm of clearance is available."],
    ["semicolon", "Bring the; third mm of clearance is available."],
    ["colon", "Bring the: third mm of clearance is available."],
    ["comma", "Bring the, third mm of clearance is available."],
    ["newline", "Bring the\nthird mm of clearance is available."],
  ])(
    "%s between the determiner and the fraction word breaks adjacency — still flagged",
    (_label, text) => {
      expect(findUnknownNumeral(text, allowed)).toBeCloseTo(1 / 3);
    },
  );

  it("does not regress: 'Consider the third pick instead.' still passes (no boundary between 'the' and 'third')", () => {
    expect(
      findUnknownNumeral("Consider the third pick instead.", allowed),
    ).toBeNull();
  });

  it("does not regress: 'roughly the third of the palm width' is still flagged (unrelated to the boundary fix — 'of' follows)", () => {
    expect(
      findUnknownNumeral("It's roughly the third of the palm width.", allowed),
    ).toBeCloseTo(1 / 3);
  });

  it("does not regress: 'It covers roughly third. Pick something else.' is still flagged (no determiner precedes 'third' at all)", () => {
    expect(
      findUnknownNumeral(
        "It covers roughly third. Pick something else.",
        allowed,
      ),
    ).toBeCloseTo(1 / 3);
  });

  it("a boundary before a token that is not an ordinal determiner has no effect either way", () => {
    // Sanity check: the boundary flag only ever matters when the preceding
    // word IS an ordinal determiner; otherwise the result is unchanged from
    // today's already-correct behaviour.
    expect(
      findUnknownNumeral("Roughly. Third of the width.", allowed),
    ).toBeCloseTo(1 / 3);
  });
});

describe("findUnknownNumeral — sentence-boundary gap, Unicode extension (SENTENCE_BOUNDARY_PATTERN was ASCII-only)", () => {
  // The ASCII-only boundary class (`[.!?;:,\n]`) closed the gap for plain
  // English punctuation but still missed a Unicode sentence-ender a model
  // can realistically produce — an ellipsis, or CJK/fullwidth/Arabic
  // terminal punctuation. Same shape of repro as above, just with a
  // non-ASCII separator between the determiner and the fraction word.
  const allowed: ReadonlySet<number> = new Set();

  it("exact repro from the brief: ellipsis (U+2026) — 'Bring the… Third mm of clearance is available.' is flagged", () => {
    expect(
      findUnknownNumeral(
        "Bring the… Third mm of clearance is available.",
        allowed,
      ),
    ).toBeCloseTo(1 / 3);
  });

  it("exact repro from the brief: ideographic full stop (U+3002) — 'Bring the。 Third mm of clearance is available.' is flagged", () => {
    expect(
      findUnknownNumeral(
        "Bring the。 Third mm of clearance is available.",
        allowed,
      ),
    ).toBeCloseTo(1 / 3);
  });

  it.each([
    [
      "horizontal ellipsis U+2026",
      "Bring the… third mm of clearance is available.",
    ],
    [
      "ideographic full stop U+3002",
      "Bring the。 third mm of clearance is available.",
    ],
    [
      "fullwidth exclamation mark U+FF01",
      "Bring the！ third mm of clearance is available.",
    ],
    [
      "fullwidth question mark U+FF1F",
      "Bring the？ third mm of clearance is available.",
    ],
    [
      "fullwidth semicolon U+FF1B",
      "Bring the； third mm of clearance is available.",
    ],
    [
      "fullwidth colon U+FF1A",
      "Bring the： third mm of clearance is available.",
    ],
    [
      "fullwidth comma U+FF0C",
      "Bring the， third mm of clearance is available.",
    ],
    [
      "ideographic comma U+3001",
      "Bring the、 third mm of clearance is available.",
    ],
    [
      "Arabic question mark U+061F",
      "Bring the؟ third mm of clearance is available.",
    ],
    [
      "Arabic semicolon U+061B",
      "Bring the؛ third mm of clearance is available.",
    ],
  ])(
    "%s between the determiner and the fraction word breaks adjacency — still flagged",
    (_label, text) => {
      expect(findUnknownNumeral(text, allowed)).toBeCloseTo(1 / 3);
    },
  );

  it("does not regress: 'Consider the third pick instead.' still passes (no boundary between 'the' and 'third')", () => {
    expect(
      findUnknownNumeral("Consider the third pick instead.", allowed),
    ).toBeNull();
  });

  it("does not regress: 'the third, of course, of the width' is still flagged ('of' follows, so the exemption never applied regardless of the comma boundary)", () => {
    expect(
      findUnknownNumeral("the third, of course, of the width", allowed),
    ).toBeCloseTo(1 / 3);
  });
});

// ---------------------------------------------------------------------------
// Round 3 (independent verification): slash fractions, percentages, grouping,
// invisible characters, word forms and unreadable numeral symbols.
// ---------------------------------------------------------------------------

describe("a slash fraction is checked by its quotient AND both numbers written", () => {
  // Ranks 1, 2 and 3 are in every input, so a fraction whose quotient is 1, 2
  // or 3 used to pass whatever it was made of.
  const ranks = new Set([1, 2, 3]);

  it.each([
    "5/5",
    "10/10",
    "50/50",
    "100/100",
    "滿分100/100",
    "6/2",
    "9/3",
    "4/2",
    "10/5",
    "20/10",
    "200/100",
    "300/100",
    "100/50",
    "５／５",
    "10 / 10",
    "about6/2",
  ])("%s is flagged", (text) => {
    expect(findUnknownNumeral(text, ranks)).not.toBeNull();
  });

  it("names the first number that is not in the input", () => {
    expect(findUnknownNumeral("6/2", ranks)).toBe(6);
    expect(findUnknownNumeral("10/5", ranks)).toBe(10);
    expect(findUnknownNumeral("1/5", ranks)).toBeCloseTo(0.2, 9);
  });

  it("passes when the quotient and both numbers are in the input", () => {
    expect(findUnknownNumeral("1/1", ranks)).toBeNull();
    expect(findUnknownNumeral("3/3", ranks)).toBeNull();
    expect(findUnknownNumeral("6/2", new Set([6, 2, 3]))).toBeNull();
    expect(findUnknownNumeral("1/3", new Set([1, 3, 1 / 3]))).toBeNull();
  });

  it("is still flagged when only the quotient or only the numbers are there", () => {
    expect(findUnknownNumeral("6/2", new Set([3]))).toBe(6);
    expect(findUnknownNumeral("1/3", new Set([1, 3]))).toBeCloseTo(1 / 3, 9);
  });

  it("N/100 is the exception: the score alone is checked", () => {
    expect(findUnknownNumeral("78/100", new Set([78]))).toBeNull();
    expect(findUnknownNumeral("７８／１００", new Set([78]))).toBeNull();
    expect(findUnknownNumeral("78/100", ranks)).toBeCloseTo(0.78, 9);
    expect(findUnknownNumeral("1/3", new Set([1, 3]))).toBeCloseTo(1 / 3, 9);
    expect(
      findUnknownNumeral("50/200", new Set([1, 2, 3, 50, 78])),
    ).toBeCloseTo(0.25, 9);
  });

  it.each(["1∕3", "1⧸3", "1╱3", "1÷3", "1／3", "1⁄3"])(
    "reads %s as a slash",
    (text) => {
      expect(findUnknownNumeral(text, new Set([1, 3]))).toBeCloseTo(1 / 3, 9);
      expect(findUnknownNumeral(text, new Set([1, 3, 1 / 3]))).toBeNull();
    },
  );

  it("6÷2 is not 3", () => {
    expect(findUnknownNumeral("6÷2", ranks)).toBe(6);
  });
});

describe("a percentage matches an input fraction only strictly between 0 and 1", () => {
  const ranks = new Set([1, 2, 3]);

  it.each([
    "100%",
    "200%",
    "300%",
    "100 %",
    "１００％",
    "100趴",
    "100個百分點",
  ])("%s is not the rank it divides down to", (text) => {
    expect(findUnknownNumeral(text, ranks)).not.toBeNull();
  });

  it("names the number written", () => {
    expect(findUnknownNumeral("100%", ranks)).toBe(100);
    expect(findUnknownNumeral("200%", ranks)).toBe(200);
  });

  it("90% still matches a confidence of 0.9, and the number itself still matches", () => {
    expect(findUnknownNumeral("90%", new Set([0.9]))).toBeNull();
    expect(findUnknownNumeral("信心約９０％", new Set([0.9]))).toBeNull();
    expect(findUnknownNumeral("90%", new Set([90]))).toBeNull();
    expect(findUnknownNumeral("100%", new Set([100]))).toBeNull();
    expect(findUnknownNumeral("92%", new Set([0.92, 92]))).toBeNull();
  });

  it("does not let a percentage match 1, 0 or a value above 1", () => {
    expect(findUnknownNumeral("100%", new Set([1]))).toBe(100);
    expect(findUnknownNumeral("0%", new Set([0]))).toBeNull(); // the number 0 itself
    expect(findUnknownNumeral("150%", new Set([1.5]))).toBe(150);
  });
});

describe("digits grouped by a comma, space or underscore are one number", () => {
  it("reads 1,600 as 1600", () => {
    expect(extractNumerals("1,600 DPI")).toEqual([1600]);
    expect(extractNumerals("12,345,678")).toEqual([12345678]);
    expect(extractNumerals("1,234.5")).toEqual([1234.5]);
  });

  it("reads 1 000 and 1_250 as one number", () => {
    expect(extractNumerals("1 000")).toEqual([1000]);
    expect(extractNumerals("12 345")).toEqual([12345]);
    expect(extractNumerals("1_250")).toEqual([1250]);
    expect(extractNumerals("１ ０００")).toEqual([1000]);
  });

  it("does not run other numbers together", () => {
    expect(extractNumerals("1, 2, 3")).toEqual([1, 2, 3]);
    expect(extractNumerals("1,23")).toEqual([1, 23]);
    expect(extractNumerals("1,2345")).toEqual([1, 2345]);
    expect(extractNumerals("3 1234")).toEqual([3, 1234]);
    expect(extractNumerals("1 2 3")).toEqual([1, 2, 3]);
  });

  it("a grouped number is checked as its value, not as its pieces", () => {
    expect(findUnknownNumeral("1,600 DPI", new Set([1, 600]))).toBe(1600);
    expect(findUnknownNumeral("1,600 DPI", new Set([1600]))).toBeNull();
    expect(findUnknownNumeral("1 000 g", new Set([1, 0]))).toBe(1000);
  });

  it("a slash fraction's three numbers never run together", () => {
    // "1/100" is "0.01 ; 1 ; 100", not "0.01 1 100" (= 1100).
    expect(extractNumerals(normalizeVulgarFractions("1/100"))).toEqual([
      0.01, 1, 100,
    ]);
  });
});

describe("k and M after a number", () => {
  it("5k is 5000, 1.5k is 1500, 2M is 2000000", () => {
    expect(extractNumerals("5k")).toEqual([5000]);
    expect(extractNumerals("5K")).toEqual([5000]);
    expect(extractNumerals("1.5k")).toEqual([1500]);
    expect(extractNumerals("2M")).toEqual([2_000_000]);
    expect(extractNumerals("最多16K，4K解析")).toEqual([16000, 4000]);
    expect(extractNumerals("5k.")).toEqual([5000]);
  });

  it("not when a letter follows", () => {
    expect(extractNumerals("5kg")).toEqual([5]);
    expect(extractNumerals("3MB")).toEqual([3]);
    expect(extractNumerals("5km")).toEqual([5]);
    expect(extractNumerals("2Mbps")).toEqual([2]);
    expect(extractNumerals("5mm")).toEqual([5]);
  });

  it("is checked as its value", () => {
    expect(findUnknownNumeral("5k", new Set([5]))).toBe(5000);
    expect(findUnknownNumeral("5k", new Set([5000]))).toBeNull();
  });
});

describe("invisible format characters do not split a number", () => {
  const invisible = [
    ["U+200B zero-width space", "​"],
    ["U+2060 word joiner", "⁠"],
    ["U+00AD soft hyphen", "­"],
    ["U+200C zero-width non-joiner", "‌"],
    ["U+200D zero-width joiner", "‍"],
    ["U+FEFF byte-order mark", "﻿"],
    ["U+200E left-to-right mark", "‎"],
  ] as const;

  it.each(invisible)("%s inside digits", (_name, ch) => {
    const text = `長度1${ch}85毫米`;
    expect(extractNumerals(text)).toEqual([185]);
    expect(findUnknownNumeral(text, new Set([1, 85]))).toBe(185);
    expect(normalizeUnicodeDigits(text)).toBe("長度185毫米");
  });

  it.each(invisible)("%s inside a Chinese number", (_name, ch) => {
    expect(findUnknownNumeral(`五${ch}十`, new Set([5, 10]))).toBe(50);
    expect(findUnknownNumeral(`三${ch}分之一`, new Set([1, 3]))).toBeCloseTo(
      1 / 3,
      9,
    );
  });

  it.each(invisible)("%s inside an English number word", (_name, ch) => {
    expect(extractWordNumerals(`fi${ch}ve`)).toEqual([
      { value: 5, percent: false },
    ]);
    expect(findUnknownNumeral(`tw${ch}enty`, new Set([1]))).toBe(20);
  });
});

describe("English number words are read after NFKC", () => {
  it("full-width and mathematical letters are the plain word", () => {
    expect(extractWordNumerals("ＦＩＶＥ")).toEqual([
      { value: 5, percent: false },
    ]);
    expect(extractWordNumerals("ｔｅｎ")).toEqual([
      { value: 10, percent: false },
    ]);
    expect(extractWordNumerals("𝐟𝐢𝐯𝐞")).toEqual([{ value: 5, percent: false }]);
    expect(extractWordNumerals("𝗍𝗐𝗈")).toEqual([{ value: 2, percent: false }]);
    expect(findUnknownNumeral("ＦＩＶＥ", new Set([1]))).toBe(5);
    expect(findUnknownNumeral("ＦＩＶＥ", new Set([5]))).toBeNull();
  });
});

describe("a numeral symbol nothing reads is refused", () => {
  const ranks = new Set([1, 2, 3, 5]);

  it.each([
    "❺",
    "⓿",
    "➄",
    "⓴",
    "Ⅴ",
    "Ⅲ",
    "ⅷ",
    "፭",
    "௰",
    "\u{11067}", // Brahmi digit
    "\u{11137}", // Chakma digit
    "\u{10107}", // Aegean number
    "長度❺毫米",
    "第Ⅴ名",
  ])("%s is flagged whatever the input has", (text) => {
    expect(Number.isNaN(findUnknownNumeral(text, ranks))).toBe(true);
    expect(
      findUnknownNumeral(text, new Set([0, 4, 5, 6, 7, 10, 20])),
    ).toBeNaN();
  });

  it("but a real value found first is still the one named", () => {
    expect(findUnknownNumeral("7 ❺", ranks)).toBe(7);
  });

  it.each([
    "①",
    "⑳",
    "²",
    "₃",
    "１２３",
    "٣", // Arabic-Indic digit
    "३", // Devanagari digit
    "㊄",
    "㈠",
    "〇",
    "〥",
    "〹",
    "½",
    "¾",
    "五",
    "ABC",
    "",
  ])(
    "%s is read by a path, so nothing is refused for being unreadable",
    (text) => {
      expect(
        findUnknownNumeral(
          text,
          new Set([0, 1, 2, 3, 5, 12, 123, 20, 0.5, 0.75]),
        ),
      ).not.toBeNaN();
    },
  );
});

/**
 * The results UI joins a number and its unit with a no-break space (U+00A0) so
 * the two cannot wrap apart, and a model may write it too. The numeral check
 * must read "84\u00A0mm" exactly as it reads "84 mm": NFKC, which every digit
 * path runs first, turns U+00A0 into a plain space. A check that read the two
 * differently would let a number through (or flag one) just for the space.
 */
describe("a no-break space between a number and its unit", () => {
  const NBSP = "\u00A0";
  const nbsp = (text: string) => text.replaceAll(" ", NBSP);
  const allowed = new Set([84, 125, 62, 90, 0.9, 1, 0]);

  it.each([
    ["It is 125 mm long.", null],
    ["It is 126 mm long.", 126],
    ["about 68 mm wide", 68],
    ["about 84 mm and 85 mm", 85],
    ["It runs about five mm shorter.", 5],
    ["It's twelve mm narrower.", 12],
    ["roughly one hundred and twenty mm", 120],
    ["that is 90 % of it", null],
    ["that is 91 % of it", 91],
    ["It weighs 1 000 g.", 1000],
    ["長度約 126 mm", 126],
    ["長度約 125 mm", null],
    ["約三十 mm", 30],
  ] as const)(
    "finds %j the same with a no-break space as with a plain one (%s)",
    (text, expected) => {
      expect(findUnknownNumeral(text, allowed)).toBe(expected);
      expect(findUnknownNumeral(nbsp(text), allowed)).toBe(expected);
      expect(extractNumerals(nbsp(text))).toEqual(extractNumerals(text));
    },
  );

  it.each([
    "a dozen mm",
    "about 1 / 3 of the width",
    "百分之 三十 的人",
    "半 mm",
    "about 2 cm and 5 g",
  ])("reads %j the same whichever space is used", (text) => {
    expect(findUnknownNumeral(nbsp(text), allowed)).toBe(
      findUnknownNumeral(text, allowed),
    );
  });

  it("extracts the same numbers from the strings the results page really shows", () => {
    const shown = [
      formatMm(63.46),
      formatSignedMm(-1.5),
      formatWeight(59.6),
      reasonText("length_short", { deltaMm: -3.2 }),
      reasonText("weight_in_range", { minG: 60, maxG: 90 }),
      reasonText("weight_heavier", { deltaG: 12.6 }),
      "Hand length 190\u00A0mm (entered) · Palm width 84\u00A0mm",
    ];
    for (const text of shown) {
      expect(text, "the unit is joined with a no-break space").toContain(NBSP);
      const plain = text.replaceAll(NBSP, " ");
      expect(extractNumerals(text), plain).toEqual(extractNumerals(plain));
    }
    expect(extractNumerals(formatMm(63.46))).toEqual([63.5]);
    expect(
      extractNumerals(reasonText("weight_heavier", { deltaG: 12.6 })),
    ).toEqual([13]);
    expect(
      extractNumerals(reasonText("weight_in_range", { minG: 60, maxG: 90 })),
    ).toEqual([60, 90]);
  });

  it("does not let the space hide a number: it stays a separator, not part of the digits", () => {
    // "1<nbsp>85" is two numbers, as "1 85" is; only a 3-digit group after the
    // separator makes one number ("1 000").
    expect(extractNumerals(`1${NBSP}85`)).toEqual([1, 85]);
    expect(extractNumerals(`1${NBSP}000${NBSP}g`)).toEqual([1000]);
    expect(findUnknownNumeral(`about${NBSP}68${NBSP}mm`, allowed)).toBe(68);
    expect(findUnknownNumeral(`about${NBSP}84${NBSP}mm`, allowed)).toBeNull();
  });

  it("keeps a product name exempt when a no-break space follows it", () => {
    const exempt = stringTokens("Logitech G502 X");
    expect(
      findUnknownNumeral(`the G502${NBSP}X is 84${NBSP}mm`, allowed, exempt),
    ).toBeNull();
    expect(
      findUnknownNumeral(`the g502${NBSP}X is 84${NBSP}mm`, allowed, exempt),
    ).toBe(502);
  });
});
