import { describe, expect, it } from "vitest";
import {
  CARD_HEIGHT,
  CARD_PADDING,
  CARD_WIDTH,
  MARK_GAP,
  MARK_SRC,
  MIN_PHOTO_HEIGHT,
  QR_SIZE,
  layoutShareCard,
  qrGrid,
  shareQrTarget,
  type DrawOp,
  type ShareCardInput,
} from "../../src/components/results/share/layout";
import {
  clampLines,
  fitLine,
  tokenize,
  wrapParts,
  wrapText,
  type FontSpec,
  type MeasureText,
} from "../../src/components/results/share/text";
import { handTypeTitle, shareCardCopy } from "../../src/lib/copy/share-card";
import { SITE_NAME, SITE_URL } from "../../src/lib/site";

/** A fake font: a CJK character is one em wide, anything else `latin` em. */
function fakeMeasure(latin = 0.55, scale = 1): MeasureText {
  return (text, font) => {
    let w = 0;
    for (const ch of text) {
      w += /[⺀-鿿＀-￯　-〿]/u.test(ch) ? font.size : font.size * latin;
    }
    return w * scale;
  };
}
const measure = fakeMeasure();
const FONT: FontSpec = { size: 40, weight: 400 };

const HAND = { size: "medium", grip: "claw", width: "wide" } as const;
const BASE: ShareCardInput = {
  lang: "zh-TW",
  handType: HAND,
  brand: "Logitech",
  model: "G Pro X Superlight 2c",
  total: 79,
  bandLabel: "適合你",
  photoSrc: null,
};

type TextOp = Extract<DrawOp, { kind: "text" }>;
const texts = (ops: DrawOp[]): TextOp[] =>
  ops.filter((o): o is TextOp => o.kind === "text");

/** Left and right edge of a text op. */
function edges(o: TextOp, m: MeasureText = measure): [number, number] {
  const w = m(o.text, o.font);
  return o.align === "right" ? [o.x - w, o.x] : [o.x, o.x + w];
}

describe("text wrapping", () => {
  it("breaks Latin at spaces and CJK between characters", () => {
    expect(tokenize("Pro X 滑鼠")).toEqual(["Pro", " ", "X", " ", "滑", "鼠"]);
    const lines = wrapText("Razer Viper V3 Pro Hyperspeed", 300, FONT, measure);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(measure(l, FONT)).toBeLessThanOrEqual(300);
    expect(lines.join(" ")).toBe("Razer Viper V3 Pro Hyperspeed");
  });

  it("cuts a single word wider than the line instead of overflowing", () => {
    const word = "Supercalifragilisticexpialidocious-Wireless";
    const lines = wrapText(word, 200, FONT, measure);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(measure(l, FONT)).toBeLessThanOrEqual(200);
    expect(lines.join("")).toBe(word);
  });

  it("never starts a zh-TW line with a closing mark", () => {
    const text = "適合長度中等、握寬較寬的滑鼠，以抓握的方式最能發揮。";
    for (let width = 160; width <= 400; width += 13) {
      const lines = wrapText(text, width, FONT, measure);
      for (const l of lines) expect(l).not.toMatch(/^[，。、；：！？）」]/u);
      expect(lines.join("")).toBe(text);
    }
  });

  it("breaks a title only between its parts", () => {
    const parts = ["中型滑鼠", "抓握", "寬身"];
    // Two parts fit a line, three do not.
    const lines = wrapParts(parts, "・", 40 * 8 + 20, FONT, measure);
    expect(lines).toEqual(["中型滑鼠・抓握・", "寬身"]);
    // Narrower than one part: it falls back to character wrapping, text intact.
    const narrow = wrapParts(parts, "・", 40 * 3, FONT, measure);
    expect(narrow.join("")).toBe("中型滑鼠・抓握・寬身");
  });

  it("clamps to a line count and ends the last line with an ellipsis", () => {
    const lines = wrapText("a ".repeat(80).trim(), 200, FONT, measure);
    const clamped = clampLines(lines, 2, 200, FONT, measure);
    expect(clamped).toHaveLength(2);
    expect(clamped[1]!.endsWith("…")).toBe(true);
    expect(measure(clamped[1]!, FONT)).toBeLessThanOrEqual(200);
    expect(clampLines(["x", "y"], 2, 200, FONT, measure)).toEqual(["x", "y"]);
  });

  it("fitLine leaves a short line alone and cuts a long one", () => {
    expect(fitLine("Logitech", 400, FONT, measure)).toBe("Logitech");
    const cut = fitLine("A very long brand name indeed", 200, FONT, measure);
    expect(cut.endsWith("…")).toBe(true);
    expect(measure(cut, FONT)).toBeLessThanOrEqual(200);
  });
});

describe("layoutShareCard: the standard card", () => {
  const layout = layoutShareCard(BASE, measure);
  const t = texts(layout.ops);
  const copy = shareCardCopy("zh-TW");

  it("is 1080 x 1920 and draws the background first", () => {
    expect(layout.width).toBe(1080);
    expect(layout.height).toBe(1920);
    expect(layout.ops[0]).toEqual({ kind: "background" });
  });

  it("has the kicker, the title, the sentence, the pick and the site", () => {
    const all = t.map((o) => o.text);
    expect(all).toContain("適合我的滑鼠型");
    expect(all.join("")).toContain(handTypeTitle(copy, HAND));
    expect(all).toContain(copy.sentence(HAND));
    expect(all).toContain("最適合我的滑鼠");
    expect(all).toContain("Logitech");
    expect(all).toContain("G Pro X Superlight 2c");
    expect(all).toContain("79");
    expect(all).toContain("適配分數");
    expect(all).toContain("適合你");
    expect(all).toContain(SITE_NAME);
    expect(all).toContain("測測你的手型");
  });

  it("reads top to bottom: kicker, title, photo, pick, footer", () => {
    const y = (text: string) => t.find((o) => o.text === text)!.baseline;
    expect(y("適合我的滑鼠型")).toBeLessThan(y(copy.sentence(HAND)));
    expect(y(copy.sentence(HAND))).toBeLessThan(layout.photoBox.y);
    expect(layout.photoBox.y + layout.photoBox.h).toBeLessThan(
      y("最適合我的滑鼠"),
    );
    expect(y("G Pro X Superlight 2c")).toBeLessThan(y(SITE_NAME));
  });

  it("keeps every line inside the side margins and above the bottom", () => {
    for (const o of t) {
      const [left, right] = edges(o);
      expect(left, o.text).toBeGreaterThanOrEqual(CARD_PADDING - 0.5);
      expect(right, o.text).toBeLessThanOrEqual(
        CARD_WIDTH - CARD_PADDING + 0.5,
      );
      expect(o.baseline, o.text).toBeLessThan(CARD_HEIGHT - CARD_PADDING);
    }
  });

  it("gives the photo a frame of at least the minimum height", () => {
    expect(layout.photoBox.h).toBeGreaterThanOrEqual(MIN_PHOTO_HEIGHT);
    expect(layout.photoBox.w).toBe(CARD_WIDTH - 2 * CARD_PADDING);
  });
});

describe("layoutShareCard: long names", () => {
  const LONG =
    "Pro X Superlight 2 DEX Lightspeed Wireless Gaming Mouse Special Edition";

  /** The model's lines: primary text below the photo that is neither the score nor the site name. */
  function modelLines(layout: ReturnType<typeof layoutShareCard>): TextOp[] {
    const photoBottom = layout.photoBox.y + layout.photoBox.h;
    return texts(layout.ops).filter(
      (o) =>
        o.color === "primary" &&
        o.align === "left" &&
        o.baseline > photoBottom &&
        o.text !== SITE_NAME,
    );
  }

  it("wraps a long model name to at most two lines beside the score", () => {
    const layout = layoutShareCard({ ...BASE, model: LONG }, measure);
    const score = texts(layout.ops).find((o) => o.text === "79")!;
    const scoreLeft = edges(score)[0];
    const lines = modelLines(layout);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines.length).toBeLessThanOrEqual(2);
    for (const o of lines) expect(edges(o)[1]).toBeLessThan(scoreLeft);
    // Nothing is lost unless the clamp added an ellipsis.
    const joined = lines.map((o) => o.text).join(" ");
    expect(joined === LONG || joined.endsWith("…")).toBe(true);
    expect(layout.photoBox.h).toBeGreaterThanOrEqual(MIN_PHOTO_HEIGHT);
  });

  it("clamps a model name no line can hold, and cuts a long brand", () => {
    const layout = layoutShareCard(
      {
        ...BASE,
        brand: "An Extremely Long Brand Name Company Limited International",
        model: "X".repeat(200),
      },
      measure,
    );
    const t = texts(layout.ops);
    expect(t.some((o) => o.text.endsWith("…"))).toBe(true);
    for (const o of t) {
      const [left, right] = edges(o);
      expect(left).toBeGreaterThanOrEqual(CARD_PADDING - 0.5);
      expect(right).toBeLessThanOrEqual(CARD_WIDTH - CARD_PADDING + 0.5);
    }
  });

  it("copes with a font nearly twice as wide as expected (a fallback face)", () => {
    const wide = fakeMeasure(0.55, 1.9);
    for (const lang of ["zh-TW", "en"] as const) {
      const layout = layoutShareCard(
        {
          ...BASE,
          lang,
          bandLabel: lang === "zh-TW" ? "非常適合你" : "A very good fit",
          handType: { size: "medium", grip: "fingertip", width: "slim" },
        },
        wide,
      );
      expect(layout.photoBox.h).toBeGreaterThanOrEqual(MIN_PHOTO_HEIGHT);
      const title = texts(layout.ops).filter(
        (o) =>
          o.font.weight === 800 &&
          o.font.size >= 60 &&
          o.baseline < layout.photoBox.y,
      );
      expect(title.length).toBeLessThanOrEqual(3);
      for (const o of texts(layout.ops)) {
        const [left, right] = edges(o, wide);
        expect(left, o.text).toBeGreaterThanOrEqual(CARD_PADDING - 0.5);
        expect(right, o.text).toBeLessThanOrEqual(
          CARD_WIDTH - CARD_PADDING + 0.5,
        );
      }
    }
  });
});

describe("layoutShareCard: titles", () => {
  const TYPE = { size: "large", grip: "fingertip", width: "slim" } as const;
  const strip = (s: string) => s.replace(/[\s・·]/g, "");

  it("never splits a hand-type part across lines, in either language", () => {
    for (const lang of ["zh-TW", "en"] as const) {
      const copy = shareCardCopy(lang);
      for (const scale of [0.8, 1, 1.5, 2.2]) {
        const layout = layoutShareCard(
          { ...BASE, lang, handType: TYPE },
          fakeMeasure(0.55, scale),
        );
        const lines = texts(layout.ops).filter(
          (o) =>
            o.font.weight === 800 &&
            o.font.size >= 60 &&
            o.baseline < layout.photoBox.y,
        );
        const joined = strip(lines.map((l) => l.text).join(""));
        if (joined.includes("…")) continue; // cut by the clamp, not split
        expect(joined).toBe(strip(handTypeTitle(copy, TYPE)));
        for (const part of [
          copy.size.large,
          copy.grip.fingertip,
          copy.width.slim,
        ]) {
          expect(
            lines.some((l) => l.text.includes(part)),
            `${lang} x${scale}: ${part}`,
          ).toBe(true);
        }
      }
    }
  });

  it("joins the parts with the language's separator", () => {
    expect(handTypeTitle(shareCardCopy("zh-TW"), HAND)).toBe(
      "中型滑鼠・抓握・寬身",
    );
    expect(handTypeTitle(shareCardCopy("en"), HAND)).toBe(
      "Medium mouse · Claw grip · Wide",
    );
  });
});

describe("layoutShareCard: the Palmate mark beside the site name", () => {
  type MarkOp = Extract<DrawOp, { kind: "mark" }>;
  const marks = (ops: DrawOp[]) =>
    ops.filter((o): o is MarkOp => o.kind === "mark");
  const nameOf = (ops: DrawOp[]) =>
    texts(ops).find((o) => o.text === SITE_NAME)!;
  const withMark = layoutShareCard({ ...BASE, markSrc: MARK_SRC }, measure);

  it("sets the site name in the wordmark's font (Inter 700, 48 px)", () => {
    for (const l of [withMark, layoutShareCard(BASE, measure)]) {
      expect(nameOf(l.ops).font).toEqual({
        size: 48,
        weight: 700,
        brand: true,
      });
    }
    // Nothing else on the card asks for the wordmark's font.
    const others = texts(withMark.ops).filter((o) => o.text !== SITE_NAME);
    for (const o of others) expect(o.font.brand).toBeUndefined();
  });

  it("draws one mark at the left margin, square, and the name to its right", () => {
    const [mark] = marks(withMark.ops);
    expect(marks(withMark.ops)).toHaveLength(1);
    expect(mark!.src).toBe(MARK_SRC);
    expect(mark!.box.x).toBe(CARD_PADDING);
    expect(mark!.box.w).toBe(mark!.box.h);
    const name = nameOf(withMark.ops);
    expect(name.x).toBe(mark!.box.x + mark!.box.w + MARK_GAP);
    // The mark is about as tall as the name's capitals, centred on them.
    expect(mark!.box.y).toBeLessThan(name.baseline);
    expect(mark!.box.y + mark!.box.h).toBeGreaterThan(name.baseline - 30);
    expect(mark!.box.y + mark!.box.h).toBeLessThanOrEqual(name.baseline + 24);
  });

  it("keeps the mark and the name inside the margins and clear of the QR code", () => {
    const [mark] = marks(withMark.ops);
    const [, right] = edges(nameOf(withMark.ops));
    const qr = withMark.ops.find((o) => o.kind === "qr")!;
    expect(right).toBeLessThan((qr as { box: { x: number } }).box.x);
    expect(mark!.box.x + mark!.box.w).toBeLessThan(nameOf(withMark.ops).x);
  });

  it("falls back to the name alone, at the margin, when the mark did not load", () => {
    for (const markSrc of [
      undefined,
      null,
      "https://x.example/m.svg",
      "../m.svg",
    ]) {
      const l = layoutShareCard(
        { ...BASE, ...(markSrc === undefined ? {} : { markSrc }) },
        measure,
      );
      expect(marks(l.ops)).toHaveLength(0);
      expect(nameOf(l.ops).x).toBe(CARD_PADDING);
    }
  });

  it("changes nothing else on the card", () => {
    const strip = (ops: DrawOp[]) =>
      ops.filter(
        (o) =>
          o.kind !== "mark" && !(o.kind === "text" && o.text === SITE_NAME),
      );
    expect(strip(withMark.ops)).toEqual(
      strip(layoutShareCard(BASE, measure).ops),
    );
  });

  it("cuts the name, never the mark, when a fallback face is far too wide", () => {
    const wide = fakeMeasure(0.55, 6);
    const l = layoutShareCard({ ...BASE, markSrc: MARK_SRC }, wide);
    expect(marks(l.ops)).toHaveLength(1);
    const name = texts(l.ops).find((o) => o.font.brand)!;
    expect(edges(name, wide)[1]).toBeLessThan(
      CARD_WIDTH - CARD_PADDING - QR_SIZE,
    );
  });
});

describe("layoutShareCard: no handType (fit-v0)", () => {
  const layout = layoutShareCard({ ...BASE, handType: undefined }, measure);
  const t = texts(layout.ops);
  const copy = shareCardCopy("zh-TW");

  it("drops the kicker, the title and the sentence and starts at the photo", () => {
    expect(layout.hasHeader).toBe(false);
    const all = t.map((o) => o.text).join("|");
    expect(all).not.toContain(copy.kicker);
    for (const w of [
      "小型",
      "中型",
      "大型",
      "趴握",
      "抓握",
      "指握",
      "窄身",
      "寬身",
      "適合長度",
    ]) {
      expect(all).not.toContain(w);
    }
    // Nothing but the frame is above the photo.
    for (const o of t) expect(o.baseline).toBeGreaterThan(layout.photoBox.y);
    // The pick is still there.
    expect(all).toContain("G Pro X Superlight 2c");
    expect(all).toContain("79");
  });

  it("gives the photo the room (up to its cap) and stays inside the card", () => {
    expect(layout.photoBox.h).toBeGreaterThan(600);
    expect(layout.photoBox.y + layout.photoBox.h).toBeLessThan(CARD_HEIGHT);
  });

  it("never invents a hand type for the English card either", () => {
    const en = layoutShareCard(
      { ...BASE, lang: "en", handType: undefined },
      measure,
    );
    const all = texts(en.ops)
      .map((o) => o.text)
      .join("|");
    expect(all).not.toMatch(/mouse ·|grip|Slim|Wide|My mouse type/);
  });
});

describe("layoutShareCard: photo and silhouette", () => {
  const kinds = (input: ShareCardInput) =>
    layoutShareCard(input, measure).ops.map((o) => o.kind);

  it("draws the silhouette when there is no photo", () => {
    const k = kinds({ ...BASE, photoSrc: null });
    expect(k).toContain("silhouette");
    expect(k).not.toContain("photo");
    expect(k).toContain("photoFrame");
  });

  it("draws the photo, not the silhouette, when one has loaded", () => {
    const layout = layoutShareCard(
      { ...BASE, photoSrc: "/images/mice/x.png" },
      measure,
    );
    expect(layout.ops.find((o) => o.kind === "photo")).toMatchObject({
      src: "/images/mice/x.png",
    });
    expect(layout.ops.map((o) => o.kind)).not.toContain("silhouette");
  });

  it("refuses a photo path that is not on this site", () => {
    for (const src of [
      "//evil.example/x.png",
      "https://evil.example/x.png",
      "/a/../b.png",
      "\\x.png",
      "",
    ]) {
      const k = kinds({ ...BASE, photoSrc: src });
      expect(k, src).toContain("silhouette");
      expect(k, src).not.toContain("photo");
    }
  });
});

describe("layoutShareCard: what the card must never carry", () => {
  const FIT_SCAN_ID = "a1b2c3d4-1111-4a2b-8c3d-9e0f1a2b3c4d";

  it("points the QR code at the site root and nothing else", () => {
    const qr = layoutShareCard(BASE, measure).ops.find((o) => o.kind === "qr");
    expect(qr).toMatchObject({ text: SITE_URL });
    expect(shareQrTarget()).toBe(SITE_URL);
    expect(SITE_URL).toMatch(/^https:\/\/[^/?#]+\/?$/);
    expect(SITE_URL).not.toContain(FIT_SCAN_ID);
    expect(shareQrTarget()).not.toMatch(/[?#]/);
  });

  it("shows no millimetres and no number but the fit total", () => {
    for (const lang of ["zh-TW", "en"] as const) {
      for (const handType of [HAND, undefined]) {
        const layout = layoutShareCard({ ...BASE, lang, handType }, measure);
        for (const o of texts(layout.ops)) {
          expect(o.text, o.text).not.toMatch(/mm|毫米|公釐/i);
          if (/\d/.test(o.text) && !o.text.includes("Superlight"))
            expect(o.text).toBe("79");
        }
      }
    }
  });
});

describe("qrGrid", () => {
  const QUIET = 3;

  it("uses a whole-pixel step, never overlaps a module, and stays inside the panel (21 to 41 modules)", () => {
    for (let modules = 21; modules <= 41; modules += 4) {
      const { step, offset } = qrGrid(QR_SIZE, modules, QUIET);
      expect(Number.isInteger(step), `step ${modules}`).toBe(true);
      expect(Number.isInteger(offset), `offset ${modules}`).toBe(true);
      expect(step).toBeGreaterThanOrEqual(1);
      // A module is `step` wide and starts every `step`: the next one starts
      // exactly where this one ends, so none overlaps.
      for (let col = 0; col + 1 < modules; col++) {
        expect(offset + col * step + step).toBeLessThanOrEqual(
          offset + (col + 1) * step,
        );
      }
      // The code, with at least the quiet zone on each side, is in the panel.
      expect(offset).toBeGreaterThanOrEqual(QUIET * step);
      expect(offset + modules * step + QUIET * step).toBeLessThanOrEqual(
        QR_SIZE,
      );
    }
  });

  it("covers every size from 21 to 41, and centres the code to within a pixel", () => {
    for (let modules = 21; modules <= 41; modules++) {
      const { step, offset } = qrGrid(QR_SIZE, modules, QUIET);
      const right = QR_SIZE - (offset + modules * step);
      expect(Math.abs(offset - right)).toBeLessThanOrEqual(1);
      expect(offset + modules * step).toBeLessThanOrEqual(QR_SIZE);
    }
  });

  it("gives the current 29-module code a 6 px step, not the old 7 px overdraw", () => {
    expect(qrGrid(QR_SIZE, 29, QUIET).step).toBe(6);
  });
});
