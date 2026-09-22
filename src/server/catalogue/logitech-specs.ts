export interface PageDimensions {
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  weightG: number | null;
}

type Axis = keyof PageDimensions;

/**
 * The two Logitech storefronts label axes differently — verified on
 * 2026-09-21 against pages whose true dimensions are known:
 *
 *   logitechg.com  PRO X SUPERLIGHT 2: Height 40, Width 63.5, Length 125
 *   logitech.com   MX Master 3S:       Height 124.9, Width 84.3, Depth 51
 *
 * On logitech.com "Height" is the mouse's length and "Depth" its height.
 * Mapping by label alone silently swaps length and height for every consumer
 * mouse; mapping by magnitude breaks on vertical mice (taller than wide).
 */
export const AXIS_CONVENTIONS: Record<
  "logitechg" | "logitech",
  Record<string, Axis>
> = {
  logitechg: {
    height: "heightMm",
    width: "widthMm",
    length: "lengthMm",
    depth: "lengthMm",
    weight: "weightG",
  },
  logitech: {
    height: "lengthMm",
    width: "widthMm",
    depth: "heightMm",
    length: "lengthMm",
    weight: "weightG",
  },
};

export function conventionFor(url: string): keyof typeof AXIS_CONVENTIONS {
  const host = new URL(url).hostname;
  if (host.endsWith("logitechg.com")) return "logitechg";
  if (host.endsWith("logitech.com")) return "logitech";
  throw new Error(`No axis convention for ${host}`);
}

const MM = /\(\s*(\d+(?:\.\d+)?)\s*mm\s*\)/;
const GRAMS = /\(\s*(\d+(?:\.\d+)?)\s*g\s*\)/;

/**
 * Reads the first labelled group inside the page's embedded `productDimensions`
 * block. Stops at the second group so receiver/cable dimensions never leak in;
 * the first value per axis wins.
 */
export function parseLogitechDimensions(
  html: string,
  url: string,
): PageDimensions {
  const out: PageDimensions = {
    lengthMm: null,
    widthMm: null,
    heightMm: null,
    weightG: null,
  };
  const start = html.indexOf("productDimensions:");
  if (start < 0) return out;
  const axes = AXIS_CONVENTIONS[conventionFor(url)];
  let groups = 0;
  for (const [, name, value] of html
    .slice(start, start + 4000)
    .matchAll(/facet:"([^"]+)",value:"([^"]*)"/g)) {
    const axis = axes[name!.trim().toLowerCase()];
    if (!axis) {
      // A header facet with no value opens a group ("Dimensions", "<Model> Mouse", "USB Receiver").
      if (value === "" && name !== "Dimensions" && ++groups > 1) break;
      continue;
    }
    if (out[axis] !== null) continue;
    const m = (axis === "weightG" ? GRAMS : MM).exec(value!);
    if (m) out[axis] = Number(m[1]);
  }
  return out;
}

/** Problems that mean a human should look before the row is seeded. */
export function dimensionWarnings(d: PageDimensions): string[] {
  const w: string[] = [];
  for (const [k, v] of Object.entries(d))
    if (v === null) w.push(`missing ${k}`);
  const { lengthMm: l, widthMm: wd, heightMm: h } = d;
  if (l !== null && wd !== null && h !== null) {
    if (l < wd || l < h)
      w.push("length is not the largest dimension — check the axis convention");
    if (l < 50 || l > 200) w.push(`implausible length ${l} mm`);
  }
  return w;
}
