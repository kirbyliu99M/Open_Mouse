import { describe, expect, it } from "vitest";
import { REASON_CODES } from "../../src/lib/contracts/fit";
import { FIT_BANDS } from "../../src/lib/contracts/fit-bands";
import { en, zhTW, type FitBandCopy } from "../../src/lib/copy/fit-bands";
import { findMedicalClaimTerm } from "../../src/server/analysis/medicalClaims";
import { findUnknownNumeral } from "../../src/server/analysis/numerals";

/**
 * Every wording string is a CANDIDATE (未拍板). This file pins what must hold
 * for ALL of them, not what they say: same keys in both languages, nothing
 * missing, no number, no medical claim.
 */
const LANGUAGES = [
  ["zh-TW", zhTW],
  ["English", en],
] as const;

function allStrings(copy: FitBandCopy): [string, string][] {
  return [
    ...FIT_BANDS.flatMap((band): [string, string][] => [
      [`bands.${band}.label`, copy.bands[band].label],
      [`bands.${band}.meaning`, copy.bands[band].meaning],
    ]),
    ...REASON_CODES.map((code): [string, string] => [
      `impact.${code}`,
      copy.impact[code],
    ]),
    ["provisional", copy.provisional],
  ];
}

/** Every key path of an object, so two languages can be compared. */
function keyPaths(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") return [prefix];
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) =>
      keyPaths(child, prefix ? `${prefix}.${key}` : key),
    )
    .sort();
}

describe("fit-band copy — keys", () => {
  it("has the same keys in zh-TW and English", () => {
    expect(keyPaths(zhTW)).toEqual(keyPaths(en));
  });

  it("has a label and a meaning for every band, in both languages", () => {
    for (const [name, copy] of LANGUAGES) {
      expect(Object.keys(copy.bands).sort(), name).toEqual(
        [...FIT_BANDS].sort(),
      );
      for (const band of FIT_BANDS) {
        expect(Object.keys(copy.bands[band]).sort(), `${name} ${band}`).toEqual(
          ["label", "meaning"],
        );
      }
    }
  });

  it("has an impact sentence for every reason code, in both languages, and no extra code", () => {
    for (const [name, copy] of LANGUAGES) {
      expect(Object.keys(copy.impact).sort(), name).toEqual(
        [...REASON_CODES].sort(),
      );
    }
  });

  it("has exactly one provisional caveat per language", () => {
    expect(Object.keys(zhTW).sort()).toEqual([
      "bands",
      "impact",
      "provisional",
    ]);
    expect(Object.keys(en).sort()).toEqual(["bands", "impact", "provisional"]);
  });
});

describe.each(LANGUAGES)("fit-band copy — %s", (_name, copy) => {
  const strings = allStrings(copy);

  it("counts every string it should (4 bands x 2, 23 codes, 1 caveat)", () => {
    expect(strings).toHaveLength(
      FIT_BANDS.length * 2 + REASON_CODES.length + 1,
    );
    expect(REASON_CODES).toHaveLength(23);
  });

  it.each(strings)("%s is not empty", (_key, text) => {
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).toBe(text.trim());
  });

  it.each(strings)("%s has no digit of any script", (_key, text) => {
    // NFKC folds fullwidth and other-script digits to ASCII before the test.
    expect(text.normalize("NFKC")).not.toMatch(/\p{Nd}/u);
    expect(text).not.toMatch(/[0-9０-９]/u);
  });

  it.each(strings)(
    "%s carries no number the no-new-numerals rule can read (digits, number words, Chinese numerals)",
    (_key, text) => {
      // An empty allow-list: if a model repeats this sentence word for word,
      // the rule has nothing to object to.
      expect(findUnknownNumeral(text, new Set())).toBeNull();
    },
  );

  it.each(strings)("%s makes no medical claim", (_key, text) => {
    expect(findMedicalClaimTerm(text)).toBeNull();
  });

  it("gives no two bands the same label or meaning", () => {
    const labels = FIT_BANDS.map((b) => copy.bands[b].label);
    const meanings = FIT_BANDS.map((b) => copy.bands[b].meaning);
    expect(new Set(labels).size).toBe(FIT_BANDS.length);
    expect(new Set(meanings).size).toBe(FIT_BANDS.length);
  });
});

describe("fit-band copy — word lists beyond the guard", () => {
  // `findMedicalClaimTerm` already reads both languages; this is a second,
  // independent net for the words Kirby's brief named. Bare "treat" is left out
  // of the English list: the agreed caveat reads "treat it as a guide", and the
  // guard itself catches "treats pain" and "to treat" + a health noun.
  const ZH_WORDS = ["治療", "疾病", "診斷", "傷害", "病", "痛症"];
  const EN_WORDS = [
    /\bcure[sd]?\b/i,
    /\bdiagnos\w*/i,
    /\binjur\w*/i,
    /\bdisease\w*/i,
    /\bpain relief\b/i,
    /\bmedical\w*/i,
    /\btreatment\b/i,
  ];

  it("keeps the zh-TW words out of every zh-TW string", () => {
    for (const [key, text] of allStrings(zhTW)) {
      for (const word of ZH_WORDS) {
        expect(text, `${key} must not contain ${word}`).not.toContain(word);
      }
    }
  });

  it("keeps the English words out of every English string", () => {
    for (const [key, text] of allStrings(en)) {
      for (const word of EN_WORDS) {
        expect(text, `${key} must not match ${word}`).not.toMatch(word);
      }
    }
  });

  it("proves the guard and the word lists do fire on a bad sentence", () => {
    expect(findMedicalClaimTerm("This mouse helps treat pain.")).not.toBeNull();
    expect(findMedicalClaimTerm("這支滑鼠可以治療手腕疼痛。")).not.toBeNull();
    expect(EN_WORDS.some((w) => w.test("It may cure a sore wrist."))).toBe(
      true,
    );
    expect(ZH_WORDS.some((w) => "預防疾病".includes(w))).toBe(true);
  });

  it("proves the number check fires on a digit, a number word and a Chinese numeral", () => {
    expect(findUnknownNumeral("It is 12 mm long.", new Set())).not.toBeNull();
    expect(
      findUnknownNumeral("About five mm longer.", new Set()),
    ).not.toBeNull();
    expect(findUnknownNumeral("長了十二毫米。", new Set())).not.toBeNull();
  });
});

describe("fit-band copy — no accuracy or comparison claims", () => {
  // The header of the copy file promises a band says how an estimate reads,
  // "never how accurate the estimate is", and the prompt forbids comparing a
  // person with anyone else. These word lists hold every string, in both
  // languages, to it. A word is a pair with a sample sentence, so the test
  // below can show each one fires. The agreed caveat ("treat it as a guide")
  // passes all of them: none of its words is on a list.
  const EN_ACCURACY: [RegExp, string][] = [
    [/\baccura(?:te|tely|cy)\b/i, "It is an accurate fit."],
    [/\bprecis(?:e|ely|ion)\b/i, "A precisely sized fit."],
    [/\breliab(?:le|ly|ility)\b/i, "A reliable fit."],
    [/\bcertain(?:ly|ty)?\b/i, "It is certain to suit you."],
    [/\bguarantee[sd]?\b/i, "We guarantee the fit."],
    [/\bexact(?:ly)?\b/i, "An exact fit."],
    [/\bdefinite(?:ly)?\b/i, "It will definitely suit you."],
  ];
  const ZH_ACCURACY = [
    "準確",
    "精準",
    "精確",
    "可靠",
    "保證",
    "一定",
    "確定",
    "准确",
    "精准",
    "精确",
    "保证",
    "确定",
  ];
  const EN_COMPARISON: [RegExp, string][] = [
    [/\bmost (?:people|users)\b/i, "It suits most people."],
    [/\bother (?:people|users)\b/i, "Other users rate it highly."],
    [/\bpercentile\w*/i, "In the top percentile."],
    [/\bbetter than\b/i, "A fit better than the rest."],
    [/\baverage\b/i, "Like the average person's grip."],
    [/\btypical\w*/i, "A typical grip."],
  ];
  const ZH_COMPARISON = [
    "多數人",
    "大多數",
    "其他人",
    "別人",
    "他人",
    "一般人",
    "百分位",
    "平均",
    "多数人",
    "别人",
  ];

  it("keeps every accuracy and certainty word out of every English string", () => {
    for (const [key, text] of allStrings(en)) {
      for (const [word] of EN_ACCURACY) {
        expect(text, `${key} must not match ${word}`).not.toMatch(word);
      }
    }
  });

  it("keeps every accuracy and certainty word out of every zh-TW string", () => {
    for (const [key, text] of allStrings(zhTW)) {
      for (const word of ZH_ACCURACY) {
        expect(text, `${key} must not contain ${word}`).not.toContain(word);
      }
    }
  });

  it("keeps every comparison with other people out of every English string", () => {
    for (const [key, text] of allStrings(en)) {
      for (const [word] of EN_COMPARISON) {
        expect(text, `${key} must not match ${word}`).not.toMatch(word);
      }
    }
  });

  it("keeps every comparison with other people out of every zh-TW string", () => {
    for (const [key, text] of allStrings(zhTW)) {
      for (const word of ZH_COMPARISON) {
        expect(text, `${key} must not contain ${word}`).not.toContain(word);
      }
    }
  });

  it("lets the agreed caveat through, in both languages", () => {
    expect(en.provisional).toContain("treat it as a guide");
    for (const [word] of [...EN_ACCURACY, ...EN_COMPARISON]) {
      expect(en.provisional).not.toMatch(word);
    }
    for (const word of [...ZH_ACCURACY, ...ZH_COMPARISON]) {
      expect(zhTW.provisional).not.toContain(word);
    }
  });

  it("proves each English word fires on a sentence that uses it, and the lists cover every word the brief named", () => {
    for (const [word, sample] of [...EN_ACCURACY, ...EN_COMPARISON]) {
      expect(sample, String(word)).toMatch(word);
    }
    // The list covers every word the brief named.
    for (const named of [
      "accurate",
      "accuracy",
      "precise",
      "precisely",
      "reliable",
      "certain",
      "guarantee",
      "exact",
      "most people",
      "other people",
      "other users",
      "percentile",
      "better than",
      "average person",
      "typical",
    ]) {
      expect(
        [...EN_ACCURACY, ...EN_COMPARISON].some(([w]) => w.test(named)),
        named,
      ).toBe(true);
    }
    for (const named of [
      "準確",
      "精準",
      "精確",
      "可靠",
      "保證",
      "一定",
      "確定",
      "多數人",
      "其他人",
      "別人",
      "百分位",
      "平均",
    ]) {
      expect([...ZH_ACCURACY, ...ZH_COMPARISON].includes(named), named).toBe(
        true,
      );
    }
  });
});
