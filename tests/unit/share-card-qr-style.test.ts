import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import {
  CARD_HEIGHT,
  CARD_PADDING,
  CARD_WIDTH,
  layoutShareCard,
  type DrawOp,
  type ShareCardInput,
} from "../../src/components/results/share/layout";
import {
  DEFAULT_QR_STYLE,
  DOT_RATIO,
  FINDER_SIZE,
  FRAME_RADIUS_RATIO,
  QR_STYLES_LIST,
  QR_STYLE_SPECS,
  SITE_URL_QR_MODULES,
  dotGeometry,
  finderOrigins,
  isFinderCell,
  qrBoxSize,
  qrStyleGrid,
  type QrStyle,
} from "../../src/components/results/share/qrStyle";
import { SITE_URL } from "../../src/lib/site";

const measure = (text: string, font: { size: number }) =>
  text.length * font.size * 0.55;
const BASE: ShareCardInput = {
  lang: "en",
  handType: { size: "medium", grip: "palm", width: "slim" },
  brand: "ASUS",
  model: "ROG Strix Impact III",
  total: 92,
  bandLabel: "A very good fit",
  photoSrc: null,
};
const qrOp = (ops: DrawOp[]) =>
  ops.find((o) => o.kind === "qr") as Extract<DrawOp, { kind: "qr" }>;

describe("QR style: the default", () => {
  it("stays classic until Kirby picks, in the layout and in the spec", () => {
    expect(DEFAULT_QR_STYLE).toBe("classic");
    expect(qrOp(layoutShareCard(BASE, measure).ops).style).toBe("classic");
    expect(QR_STYLE_SPECS.classic.moduleShape).toBe("square");
    expect(QR_STYLE_SPECS.classic.eye).toBeNull();
    expect(QR_STYLE_SPECS.classic.inverted).toBe(false);
  });

  it("lists the four styles and says which are inverted", () => {
    expect([...QR_STYLES_LIST].sort()).toEqual(
      ["classic", "darkTile", "frameless", "softLight"].sort(),
    );
    expect(QR_STYLE_SPECS.softLight.inverted).toBe(false);
    expect(QR_STYLE_SPECS.darkTile.inverted).toBe(true);
    expect(QR_STYLE_SPECS.frameless.inverted).toBe(true);
  });

  it("knows the site URL's code is 29 modules (the layout's default)", () => {
    const qr = QRCode.create(SITE_URL, { errorCorrectionLevel: "M" });
    expect(qr.modules.size).toBe(SITE_URL_QR_MODULES);
  });
});

describe("QR style: dot geometry", () => {
  it("keeps every dot inside its own cell and apart from its neighbours", () => {
    for (const step of [3, 4, 5, 6, 8]) {
      for (const [x, y] of [
        [0, 0],
        [37, 112],
      ] as const) {
        const d = dotGeometry(x, y, step);
        expect(d.r * 2).toBeCloseTo(step * DOT_RATIO, 10);
        expect(d.cx - d.r).toBeGreaterThanOrEqual(x);
        expect(d.cx + d.r).toBeLessThanOrEqual(x + step);
        expect(d.cy - d.r).toBeGreaterThanOrEqual(y);
        expect(d.cy + d.r).toBeLessThanOrEqual(y + step);
        // The next cell's dot is `step` away: the circles do not touch.
        const right = dotGeometry(x + step, y, step);
        const below = dotGeometry(x, y + step, step);
        expect(Math.hypot(right.cx - d.cx, right.cy - d.cy)).toBeGreaterThan(
          2 * d.r,
        );
        expect(Math.hypot(below.cx - d.cx, below.cy - d.cy)).toBeGreaterThan(
          2 * d.r,
        );
      }
    }
  });

  it("centres a dot on its cell, on a whole or half pixel", () => {
    expect(dotGeometry(10, 20, 5)).toMatchObject({ cx: 12.5, cy: 22.5 });
    expect(dotGeometry(10, 20, 4)).toMatchObject({ cx: 12, cy: 22 });
  });
});

describe("QR style: the three eyes", () => {
  it("sit at the top-left, top-right and bottom-left corners, 7 modules square", () => {
    for (let m = 21; m <= 41; m += 4) {
      expect(finderOrigins(m)).toEqual([
        { row: 0, col: 0 },
        { row: 0, col: m - FINDER_SIZE },
        { row: m - FINDER_SIZE, col: 0 },
      ]);
      let cells = 0;
      for (let r = 0; r < m; r++)
        for (let c = 0; c < m; c++) if (isFinderCell(r, c, m)) cells += 1;
      expect(cells).toBe(3 * FINDER_SIZE * FINDER_SIZE);
      // Not the fourth corner, and not the middle.
      expect(isFinderCell(m - 1, m - 1, m)).toBe(false);
      expect(isFinderCell(Math.floor(m / 2), Math.floor(m / 2), m)).toBe(false);
    }
  });

  it("every dark finder module of the real code is inside a finder block", () => {
    const qr = QRCode.create(SITE_URL, { errorCorrectionLevel: "M" });
    const m = qr.modules.size;
    for (const o of finderOrigins(m)) {
      // The 7x7 finder: dark ring, light ring, dark 3x3.
      for (let r = 0; r < FINDER_SIZE; r++)
        for (let c = 0; c < FINDER_SIZE; c++) {
          const ring = r === 0 || r === 6 || c === 0 || c === 6;
          const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          expect(qr.modules.get(o.row + r, o.col + c) === 1).toBe(ring || core);
        }
    }
  });

  it("are drawn as shapes in the three candidate styles, not in classic", () => {
    expect(QR_STYLE_SPECS.classic.eye).toBeNull();
    expect(QR_STYLE_SPECS.softLight.eye).toEqual({
      ring: "#2463EB",
      center: "#0A1430",
    });
    expect(QR_STYLE_SPECS.darkTile.eye).toEqual({
      ring: "#7FA8FF",
      center: "#CFE0FF",
    });
    expect(QR_STYLE_SPECS.frameless.eye).toEqual({
      ring: "#7FA8FF",
      center: "#CFE0FF",
    });
  });
});

describe("QR style: box, grid and place on the card", () => {
  const STYLES: QrStyle[] = ["classic", "softLight", "darkTile", "frameless"];

  it("gives a 29-module code a 5 px step at the 176 px panel, in every style", () => {
    for (const style of STYLES) {
      const box = qrBoxSize(style, 176, SITE_URL_QR_MODULES);
      const { step, offset } = qrStyleGrid(style, box, SITE_URL_QR_MODULES);
      expect(step, style).toBe(5);
      expect(offset, style).toBeGreaterThanOrEqual(
        QR_STYLE_SPECS[style].minQuiet * step,
      );
      expect(offset + SITE_URL_QR_MODULES * step, style).toBeLessThanOrEqual(
        box,
      );
    }
  });

  it("keeps a panel style's box at the panel size, and grows the frameless one by its quiet zone", () => {
    for (const style of ["classic", "softLight", "darkTile"] as const)
      expect(qrBoxSize(style, 176, 29)).toBe(176);
    // 5 px step x (29 modules + 4 quiet on each side).
    expect(qrBoxSize("frameless", 176, 29)).toBe(5 * 37);
    const { step, offset } = qrStyleGrid("frameless", 185, 29);
    expect(offset).toBeGreaterThanOrEqual(4 * step);
  });

  it("uses the photo frame's corner ratio for the candidate panels", () => {
    expect(QR_STYLE_SPECS.softLight.panel!.radius(176)).toBe(
      Math.round(176 * FRAME_RADIUS_RATIO),
    );
    expect(QR_STYLE_SPECS.darkTile.panel!.radius(176)).toBe(9);
    expect(QR_STYLE_SPECS.frameless.panel).toBeNull();
    expect(QR_STYLE_SPECS.darkTile.panel!.border).not.toBeNull();
  });

  it("lays the QR on the card inside the margins, apart from the mark, in every style", () => {
    for (const style of STYLES) {
      const layout = layoutShareCard(BASE, measure, {
        qrSize: 176,
        qrStyle: style,
      });
      const qr = qrOp(layout.ops);
      const mark = layout.ops.find((o) => o.kind === "mark") as Extract<
        DrawOp,
        { kind: "mark" }
      >;
      expect(qr.style).toBe(style);
      expect(qr.box.x + qr.box.w).toBe(CARD_WIDTH - CARD_PADDING);
      expect(qr.box.y + qr.box.h).toBe(CARD_HEIGHT - CARD_PADDING);
      expect(qr.box.x).toBeGreaterThan(mark.box.x + mark.box.w);
      expect(qr.text).toBe(SITE_URL);
      expect(layout.photoBox.y + layout.photoBox.h).toBeLessThan(qr.box.y);
    }
  });
});
