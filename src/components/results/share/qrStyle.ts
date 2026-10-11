/**
 * How the share card's QR code is styled, and the pure geometry behind it.
 * `render.ts` paints; everything that can be checked without a canvas is here.
 *
 * Every style keeps whole-pixel module placement (`qrGrid`) and a quiet zone.
 * Kirby picked `frameless` as the default on 2026-10-10, pending a phone-camera
 * scan of the inverted code. `classic` (the plain black-on-white square the card
 * shipped with) and `softLight` stay in code as the fallbacks: switching back is
 * the one constant `DEFAULT_QR_STYLE`. The candidates (未拍板), in the site's
 * design language:
 *
 * - `softLight`: a light blue-white rounded panel, navy dots, blue-ringed eyes.
 *   Dark modules on a light ground, so it is not inverted.
 * - `darkTile`: the photo frame's look (dark fill, thin border), light dots,
 *   light-blue eyes. Inverted: light modules on a dark ground.
 * - `frameless`: no panel; light dots straight on the card, with a quiet zone of
 *   at least four modules of plain background. Inverted.
 *
 * Inverted codes only scan in readers that try the inverted image too; some
 * phone scanners do not.
 */
/**
 * Where a QR code's modules go inside its panel: a whole-pixel step per module
 * (so no module is wider than its slot and none overlaps the next) and the
 * offset that centres the code. `quiet` is the margin in modules. The remainder
 * after the integer step is split evenly around the code.
 */
export function qrGrid(
  panelSize: number,
  modules: number,
  quiet: number,
): { step: number; offset: number } {
  const step = Math.max(1, Math.floor(panelSize / (modules + 2 * quiet)));
  const offset = Math.floor((panelSize - step * modules) / 2);
  return { step, offset };
}

export type QrStyle = "classic" | "softLight" | "darkTile" | "frameless";
export const QR_STYLES_LIST: readonly QrStyle[] = [
  "classic",
  "softLight",
  "darkTile",
  "frameless",
];
/** Kirby picked the frameless style (V3) on 2026-10-10. `classic` and `softLight` stay as fallbacks if a phone camera cannot read the inverted code. */
export const DEFAULT_QR_STYLE: QrStyle = "frameless";

/** Modules per side of the QR code for the site URL (`qrcode`, level M); a unit test pins it. */
export const SITE_URL_QR_MODULES = 29;

/** A finder pattern ("eye") is 7 modules square. */
export const FINDER_SIZE = 7;

/** The photo frame's corner radius over its width (48 / 912), reused for the QR panel. */
export const FRAME_RADIUS_RATIO = 48 / 912;

/** Dot diameter over the cell side for the dot styles. */
export const DOT_RATIO = 0.86;

export interface QrStyleSpec {
  /** The panel behind the code, or null for none. */
  panel: null | {
    fill: "white" | "softLight" | "frame";
    /** Border colour, or null for none. */
    border: string | null;
    /** Corner radius for a panel of this side. */
    radius: (side: number) => number;
  };
  moduleShape: "square" | "dot";
  /** `null` = the card background colour (the classic look). */
  moduleColor: string | null;
  /** Finder eyes drawn as rounded shapes, or null to draw them as plain modules. */
  eye: null | { ring: string; center: string };
  /** True when the modules are lighter than their ground. */
  inverted: boolean;
  /** Plain ground around the code, in modules, at the least. */
  minQuiet: number;
}

export const QR_STYLE_SPECS: Record<QrStyle, QrStyleSpec> = {
  classic: {
    panel: { fill: "white", border: null, radius: () => 28 },
    moduleShape: "square",
    moduleColor: null,
    eye: null,
    inverted: false,
    minQuiet: 2,
  },
  softLight: {
    panel: {
      fill: "softLight",
      border: null,
      radius: (side) => Math.round(side * FRAME_RADIUS_RATIO),
    },
    moduleShape: "dot",
    moduleColor: "#0A1430",
    eye: { ring: "#2463EB", center: "#0A1430" },
    inverted: false,
    minQuiet: 2,
  },
  darkTile: {
    panel: {
      fill: "frame",
      border: "#ffffff24",
      radius: (side) => Math.round(side * FRAME_RADIUS_RATIO),
    },
    moduleShape: "dot",
    moduleColor: "#CFE0FF",
    eye: { ring: "#7FA8FF", center: "#CFE0FF" },
    inverted: true,
    minQuiet: 2,
  },
  frameless: {
    panel: null,
    moduleShape: "dot",
    moduleColor: "#CFE0FF",
    eye: { ring: "#7FA8FF", center: "#CFE0FF" },
    inverted: true,
    minQuiet: 4,
  },
};

/** Fills used by the panel styles. */
export const SOFT_LIGHT_PANEL_FILL = "#DCE6FF";

/**
 * The side of the QR box. A panel style is `qrSize` wide. `frameless` has no
 * panel, so its box is the code plus its four-module quiet zone, at the same
 * module step the panel styles get from `qrSize`: the card keeps the step and
 * the box grows by the quiet zone.
 *
 * The step is computed with the panel styles' quiet zone (`classic.minQuiet`,
 * 2 modules) as the base, so that `qrSize` means the same step in every style.
 * That is only right while all the panel styles share one `minQuiet`; a unit
 * test pins it.
 */
export function qrBoxSize(
  style: QrStyle,
  qrSize: number,
  modules: number,
): number {
  if (QR_STYLE_SPECS[style].panel !== null) return qrSize;
  const step = Math.max(
    1,
    Math.floor(qrSize / (modules + 2 * QR_STYLE_SPECS.classic.minQuiet)),
  );
  return step * (modules + 2 * QR_STYLE_SPECS[style].minQuiet);
}

/** Step and offset of the modules inside a QR box of this style. */
export function qrStyleGrid(style: QrStyle, boxSize: number, modules: number) {
  return qrGrid(boxSize, modules, QR_STYLE_SPECS[style].minQuiet);
}

/** Top-left (row, col) of the three finder patterns. */
export function finderOrigins(
  modules: number,
): readonly { row: number; col: number }[] {
  return [
    { row: 0, col: 0 },
    { row: 0, col: modules - FINDER_SIZE },
    { row: modules - FINDER_SIZE, col: 0 },
  ];
}

export function isFinderCell(row: number, col: number, modules: number) {
  return finderOrigins(modules).some(
    (o) =>
      row >= o.row &&
      row < o.row + FINDER_SIZE &&
      col >= o.col &&
      col < o.col + FINDER_SIZE,
  );
}

/** The dot for the module at pixel (x, y) with a cell of `step`: centred in the cell. */
export function dotGeometry(x: number, y: number, step: number) {
  return { cx: x + step / 2, cy: y + step / 2, r: (step * DOT_RATIO) / 2 };
}
