import { describe, expect, it } from "vitest";
import {
  CARD_HEIGHT,
  CARD_PADDING,
  CARD_WIDTH,
  MIN_PHOTO_HEIGHT,
  DEFAULT_QR_SIZE,
  MARK_SIZE,
  QR_MIN_QUIET_MODULES,
  type Box,
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
  const SIZES = [144, 160, 176] as const;

  it("uses a whole-pixel step, never overlaps a module, and stays inside the panel (21 to 41 modules)", () => {
    for (const panel of SIZES) {
      for (let modules = 21; modules <= 41; modules++) {
        const { step, offset } = qrGrid(panel, modules, QR_MIN_QUIET_MODULES);
        const at = `${panel} px, ${modules} modules`;
        expect(Number.isInteger(step), at).toBe(true);
        expect(Number.isInteger(offset), at).toBe(true);
        expect(step, at).toBeGreaterThanOrEqual(1);
        // A module is `step` wide and starts every `step`: the next one starts
        // exactly where this one ends, so none overlaps.
        for (let col = 0; col + 1 < modules; col++) {
          expect(offset + col * step + step, at).toBeLessThanOrEqual(
            offset + (col + 1) * step,
          );
        }
        // At least the minimum quiet zone on each side, and inside the panel.
        expect(offset, at).toBeGreaterThanOrEqual(QR_MIN_QUIET_MODULES * step);
        expect(
          offset + modules * step + QR_MIN_QUIET_MODULES * step,
          at,
        ).toBeLessThanOrEqual(panel);
        // Centred to within a pixel.
        const right = panel - (offset + modules * step);
        expect(Math.abs(offset - right), at).toBeLessThanOrEqual(1);
      }
    }
  });

  it("gives the current 29-module code its step at each preview size", () => {
    expect(qrGrid(144, 29, QR_MIN_QUIET_MODULES).step).toBe(4);
    expect(qrGrid(160, 29, QR_MIN_QUIET_MODULES).step).toBe(4);
    expect(qrGrid(176, 29, QR_MIN_QUIET_MODULES).step).toBe(5);
  });
});

describe("the footer lockup and the QR", () => {
  type Layout = ReturnType<typeof layoutShareCard>;
  const MARK_GAP_MIN = 20;
  const findMark = (l: Layout) =>
    l.ops.find((o) => o.kind === "mark") as Extract<DrawOp, { kind: "mark" }>;
  const findQr = (l: Layout) =>
    l.ops.find((o) => o.kind === "qr") as Extract<DrawOp, { kind: "qr" }>;
  const overlap = (a: Box, b: Box) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const boxOf = (o: TextOp, m: MeasureText = measure): Box => {
    const [left, right] = edges(o, m);
    return {
      x: left,
      y: o.baseline - o.font.size,
      w: right - left,
      h: o.font.size,
    };
  };

  const CASES: [string, ShareCardInput, MeasureText][] = [
    ["standard zh-TW", BASE, measure],
    ["English", { ...BASE, lang: "en", bandLabel: "A very good fit" }, measure],
    ["no handType", { ...BASE, handType: undefined }, measure],
    [
      "long model name",
      {
        ...BASE,
        model: "Pro X Superlight 2 DEX Lightspeed Wireless Gaming Mouse",
      },
      measure,
    ],
    ["a font nearly twice as wide", BASE, fakeMeasure(0.55, 1.9)],
    ["a photo", { ...BASE, photoSrc: "/images/a.png" }, measure],
  ];

  it("puts the mark at the bottom-left, with the name and tagline centred on it", () => {
    for (const [name, input, m] of CASES) {
      const layout = layoutShareCard(input, m);
      const mark = findMark(layout);
      expect(mark.box, name).toEqual({
        x: CARD_PADDING,
        y: CARD_HEIGHT - CARD_PADDING - MARK_SIZE,
        w: MARK_SIZE,
        h: MARK_SIZE,
      });
      const nameOp = texts(layout.ops).find((o) => o.text === SITE_NAME)!;
      const tagOp = texts(layout.ops).find(
        (o) => o.text === shareCardCopy(input.lang).tagline,
      )!;
      expect(nameOp.x, name).toBeGreaterThanOrEqual(
        mark.box.x + mark.box.w + MARK_GAP_MIN,
      );
      expect(tagOp.x, name).toBe(nameOp.x);
      // The text block (name's cap height to the tagline's baseline) is
      // centred on the mark, to within a few pixels, and inside its height.
      const top = nameOp.baseline - nameOp.font.size * 0.75;
      const bottom = tagOp.baseline;
      const mid = mark.box.y + mark.box.h / 2;
      expect(Math.abs((top + bottom) / 2 - mid), name).toBeLessThanOrEqual(6);
      expect(top, name).toBeGreaterThanOrEqual(mark.box.y);
      expect(bottom, name).toBeLessThanOrEqual(mark.box.y + mark.box.h);
    }
  });

  it("makes the QR 160 px by default, resting on the mark's bottom edge, with the right margin", () => {
    expect(DEFAULT_QR_SIZE).toBe(160);
    for (const [name, input, m] of CASES) {
      const layout = layoutShareCard(input, m);
      const qr = findQr(layout);
      const mark = findMark(layout);
      expect(qr.box.w, name).toBe(160);
      expect(qr.box.h, name).toBe(160);
      expect(qr.box.y + qr.box.h, name).toBe(mark.box.y + mark.box.h);
      expect(qr.box.x + qr.box.w, name).toBe(CARD_WIDTH - CARD_PADDING);
      expect(qr.text, name).toBe(SITE_URL);
    }
  });

  it("takes the QR size as a parameter and keeps it inside the card", () => {
    for (const size of [144, 160, 176]) {
      const qr = findQr(layoutShareCard(BASE, measure, { qrSize: size }));
      expect(qr.box.w).toBe(size);
      expect(qr.box.x + qr.box.w).toBeLessThanOrEqual(
        CARD_WIDTH - CARD_PADDING,
      );
      expect(qr.box.y + qr.box.h).toBeLessThanOrEqual(
        CARD_HEIGHT - CARD_PADDING,
      );
    }
  });

  it("overlaps nothing: mark, name, tagline, QR, the result block and the photo stay apart", () => {
    for (const size of [144, 160, 176]) {
      for (const [name, input, m] of CASES) {
        const layout = layoutShareCard(input, m, { qrSize: size });
        const mark = findMark(layout).box;
        const qr = findQr(layout).box;
        const footerText = texts(layout.ops).filter((o) =>
          [SITE_NAME, shareCardCopy(input.lang).tagline].includes(o.text),
        );
        const at = `${name} @ ${size}`;
        expect(footerText, at).toHaveLength(2);
        expect(overlap(mark, qr), at).toBe(false);
        for (const o of footerText) {
          const b = boxOf(o, m);
          expect(overlap(b, mark), at).toBe(false);
          expect(overlap(b, qr), at).toBe(false);
        }
        const footerTop = Math.min(mark.y, qr.y);
        expect(layout.photoBox.y + layout.photoBox.h, at).toBeLessThan(
          footerTop,
        );
        for (const o of texts(layout.ops)) {
          if (footerText.includes(o)) continue;
          expect(o.baseline, `${at}: ${o.text}`).toBeLessThan(footerTop);
        }
        expect(layout.photoBox.h, at).toBeGreaterThanOrEqual(MIN_PHOTO_HEIGHT);
      }
    }
  });

  it("keeps the lockup and the QR with no hand type, and gives the photo the room instead", () => {
    const withType = layoutShareCard(BASE, measure);
    const without = layoutShareCard({ ...BASE, handType: undefined }, measure);
    for (const l of [withType, without]) {
      expect(l.ops.filter((o) => o.kind === "mark")).toHaveLength(1);
      expect(l.ops.filter((o) => o.kind === "qr")).toHaveLength(1);
    }
    expect(findMark(without).box).toEqual(findMark(withType).box);
    expect(without.photoBox.h).toBeGreaterThan(withType.photoBox.h);
  });
});
