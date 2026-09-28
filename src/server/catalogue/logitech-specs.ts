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

/**
 * Per-page exceptions for the handful of product pages that don't follow
 * their storefront's usual convention. Keyed by the exact source URL from
 * `LOGITECH_SOURCES`. Never a hand-typed dimension — only which label means
 * which axis, or which dimension group holds the weight to read; the actual
 * numbers still come from the fetched page.
 */
export interface AxisOverride {
  /**
   * Facet name (lowercased) → axis, replacing — not merging on top of a
   * default that would otherwise apply — the host convention's mapping for
   * that facet on this one page.
   */
  axes?: Record<string, Axis>;
  /**
   * This page carries more than one weight (e.g. with/without an accessory).
   * Read the Weight facet from the first dimension-group header whose name
   * contains this substring (case-insensitive), instead of the first group
   * found. Leaves the default stop-at-second-group behaviour untouched for
   * every page without this override.
   */
  weightGroupContains?: string;
}

export const AXIS_OVERRIDES: Readonly<Record<string, AxisOverride>> = {
  // 2026-09-27: logitech.com/en-us/shop/p/mobi-fold-mouse's first dimension
  // group (the open/unfolded mouse, header "Mobi Fold") literally reads
  // "Height 1.3 in (33 mm) / Width 2.24 in (57 mm) / Depth 4.8 in (122 mm)".
  // Every other logitech.com page in this lineup has "Height" label the
  // mouse's length and "Depth" label its height (AXIS_CONVENTIONS.logitech
  // above) — this page is the opposite: Height really is the height, Depth
  // really is the length.
  "https://www.logitech.com/en-us/shop/p/mobi-fold-mouse": {
    axes: { height: "heightMm", depth: "lengthMm" },
  },
  // 2026-09-27: logitech.com/en-us/shop/p/mx-ergo-s-wireless-trackball-mouse
  // lists three dimension groups: "Mouse" (Height/Width/Depth, no weight),
  // "Mouse (without metal plate/without receiver)" (Weight 5.78 oz / 164 g),
  // and "Mouse (with metal plate/without receiver)" (Weight 9.14 oz / 259 g).
  // The shared parser stops after the second group header so a mouse's own
  // USB-receiver dimensions never leak in — which also skips this page's
  // only usable weight. Read it from the "without metal plate" group.
  "https://www.logitech.com/en-us/shop/p/mx-ergo-s-wireless-trackball-mouse": {
    weightGroupContains: "without metal plate",
  },
};

const MM = /\(\s*(\d+(?:\.\d+)?)\s*mm\s*\)/;
const GRAMS = /\(\s*(\d+(?:\.\d+)?)\s*g\s*\)/;

/**
 * Reads the first labelled group inside the page's embedded `productDimensions`
 * block. Stops at the second group so receiver/cable dimensions never leak in
 * — unless `AXIS_OVERRIDES[url].weightGroupContains` names a later group to
 * pull the weight from, in which case scanning continues and only a Weight
 * facet found inside that specific group is accepted. The first value per
 * axis still wins either way.
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
  const override = AXIS_OVERRIDES[url];
  const axes = { ...AXIS_CONVENTIONS[conventionFor(url)], ...override?.axes };
  const weightGroupContains = override?.weightGroupContains?.toLowerCase();
  let groups = 0;
  let currentGroup = "";
  for (const [, name, value] of html
    .slice(start, start + 4000)
    .matchAll(/facet:"([^"]+)",value:"([^"]*)"/g)) {
    const axis = axes[name!.trim().toLowerCase()];
    if (!axis) {
      // A header facet with no value opens a group ("Dimensions", "<Model> Mouse", "USB Receiver").
      if (value === "" && name !== "Dimensions") {
        groups++;
        currentGroup = name!.toLowerCase();
        if (!weightGroupContains && groups > 1) break;
      }
      continue;
    }
    if (out[axis] !== null) continue;
    if (
      axis === "weightG" &&
      weightGroupContains &&
      !currentGroup.includes(weightGroupContains)
    )
      continue; // a weight in a group this override isn't targeting
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
