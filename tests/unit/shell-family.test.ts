import { describe, expect, it } from "vitest";
import { shellFamily } from "../../src/server/fit/shell-family";

describe("shellFamily: version words are removed", () => {
  it.each([
    ["M75", "M75 Wireless"],
    ["M55 Wired", "M55 Wireless"],
    ["Viper V3 HyperSpeed", "Viper V3 Pro"],
    ["G502 X", "G502 X Lightspeed"],
    ["M3 4K", "M3 8K"],
    ["ROG Chakram", "ROG Chakram Core"],
    ["M3", "M3 Lite"],
    ["HTS", "HTS Ultra 8K"],
    ["XM1", "XM1 RGB"],
    ["Ying", "Ying Magnesium"],
    ["MAYA", "MAYA Champion Edition"],
    ["Paro Reject", "Paro Reject Special Edition"],
    ["Scimitar Elite Wireless", "Scimitar Elite Wireless SE"],
    ["Alpha", "Alpha Carbon"],
    ["Model D 2 Pro 1K", "Model D 2 Pro 4K/8K"],
    ["Sabre v2 Pro CF", "Sabre v2 Pro MG"],
    ["OP1 8k", "OP1 8k Purple"],
    ["MAYA", "x Fnatic MAYA 8K"],
    ["Paro", "x REJECT Paro"],
    ["Paro", "Paro Aurora"],
    ["Basilisk V3", "Basilisk V3 Pro 35K"],
  ])("%s and %s are one family", (a, b) => {
    expect(shellFamily(a)).toBe(shellFamily(b));
  });

  it("ignores case, hyphens and brackets", () => {
    expect(shellFamily("Pulsefire HASTE 2 (Wireless)")).toBe(
      shellFamily("pulsefire haste 2"),
    );
    expect(shellFamily("Susanto-X")).toBe("susanto x");
  });
});

describe("shellFamily: every version word is pinned", () => {
  // The same list as VERSION_WORDS: removing a word from the source fails its
  // row here, and adding one means adding it here (the file header's rule).
  const WORDS = [
    "wired",
    "wireless",
    "hyperspeed",
    "lightspeed",
    "pro",
    "core",
    "se",
    "lite",
    "ultra",
    "rgb",
    "cf",
    "mg",
    "magnesium",
    "aurora",
    "purple",
    "champion",
    "special",
    "edition",
    "carbon",
  ];
  it.each(WORDS)("%s alone does not change the family", (word) => {
    expect(shellFamily(`Alpha ${word}`)).toBe("alpha");
    expect(shellFamily(`ALPHA ${word.toUpperCase()}`)).toBe("alpha");
  });
});

describe("shellFamily: different models stay apart", () => {
  it.each([
    ["Aerox 3", "Rival 3"],
    ["Aerox 5", "Aerox 9 Wireless"],
    ["G Pro Wireless", "G Pro 2 Lightspeed"],
    ["G403 Hero", "G703 Lightspeed"],
    ["Model O 2 Wireless", "Model O Wireless"],
    ["Basilisk V3", "Basilisk V4 Pro"],
    ["Gen 1", "Gen 2"],
    ["M916 Pro", "M996"],
    ["Beast X Max", "Beast G Max"],
    ["Atlantis Mini", "Atlantis"],
  ])("%s and %s are two families", (a, b) => {
    expect(shellFamily(a)).not.toBe(shellFamily(b));
  });

  it("keeps numbers, versions and size words", () => {
    expect(shellFamily("Model O 2 Mini Wireless")).toBe("model o 2 mini");
    expect(shellFamily("X2 v3 eS Mini")).toBe("x2 v3 es mini");
  });
});

describe("shellFamily: a name of only version words keeps its whole name", () => {
  it.each(["Pro", "Ultra", "Lite", "Pro Wireless", "X Mouse Pro"])(
    "%s is not the empty family",
    (model) => {
      expect(shellFamily(model)).not.toBe("");
      expect(shellFamily(model)).toBe(model.toLowerCase().trim());
    },
  );

  it("keeps two such names of one brand apart", () => {
    expect(shellFamily("Pro")).not.toBe(shellFamily("Ultra"));
    expect(shellFamily("Pro Wireless")).not.toBe(shellFamily("Pro"));
  });
});
