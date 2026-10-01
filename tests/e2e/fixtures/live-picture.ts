import { expect, type Page } from "@playwright/test";
import {
  contrast,
  glyphAndBackOverWhiteLayers,
  type Layer,
  type Rgba,
} from "./contrast";

/**
 * Text over the live camera picture, measured directly.
 *
 * Axe cannot see the picture behind translucent controls, so contrast over it
 * is checked here, on the worst picture there is: white. Three guards, and
 * the first two fail closed:
 *
 * 1. `measureOverPicture`: every listed element that is on screen, AND every
 *    visible descendant of it that carries text (an icon, a nested span, a
 *    ::before or ::after with content), is measured with the element's own
 *    text colour and alpha, and the fill and opacity of it and each ancestor
 *    inside the camera screen, laid over white (`glyphAndBackOverWhiteLayers`).
 *    Every one must keep 4.5:1.
 * 2. The same measure refuses what it does not model. If the element or an
 *    ancestor inside the screen has a `filter`, a `backdrop-filter`, a
 *    `mix-blend-mode` other than normal, a `background-image`, or a text fill
 *    (`-webkit-text-fill-color`) other than its `color`, the test fails with
 *    the feature named, unless that exact feature is on `ALLOWED_FEATURES`
 *    with a reason. Today nothing needs it.
 * 3. `scanForUnlisted`: an independent walk of everything visible in the
 *    screen that carries text or a non-transparent fill (not the video, the
 *    canvas or the photo layer). Each must be on the list or inside a listed
 *    element, or be decoration with no text of its own. It does not depend on
 *    what axe reports, so it holds with the colour-contrast rule off.
 */

/** The screen the controls are laid over: contrast is measured up to it. */
export const CAMERA_SCREEN = ".cameraViewfinder";

/** A style feature the measure does not model, allowed on one selector with a reason. */
export interface AllowedFeature {
  readonly selector: string;
  /** The feature as named in the failure message, for example "background-image". */
  readonly feature: string;
  readonly why: string;
}
/** Empty on purpose: nothing in the camera screen needs one. */
export const ALLOWED_FEATURES: readonly AllowedFeature[] = [];

/** Decoration: drawn in the screen, with a fill and no text. A text-carrying element can never be on it. */
export interface Decoration {
  readonly selector: string;
  readonly why: string;
}
export const DECORATION: readonly Decoration[] = [
  {
    selector: ".easyStage",
    why: "the near-black backing the video is drawn on; no text",
  },
  {
    selector: ".easyCorners",
    why: "the corner dots, rings and outline segments; aria-hidden, no text",
  },
  {
    selector: ".cameraShutter",
    why: "the shutter: a white disc and a ring; its name is an aria-label, no text",
  },
];

interface Found {
  readonly root: string;
  readonly what: string;
  readonly text: Rgba;
  /** Outermost first, down to the element that carries the text. */
  readonly layers: Layer[];
  readonly features: string[];
}

export interface Measured {
  /** How many visible elements each listed selector matched. */
  readonly present: Record<string, number>;
  readonly items: readonly (Found & { readonly ratio: number })[];
  /** Style features that are not modelled and not allowed. */
  readonly unmodelled: readonly string[];
}

/** Everything in `roots` (selectors) that is on screen, with its descendants, measured. */
export async function measureOverPicture(
  page: Page,
  roots: readonly string[],
): Promise<Measured> {
  const raw = await page.evaluate(
    ({ roots, screen }) => {
      const rgba = (
        color: string,
        extraAlpha = 1,
      ): [number, number, number, number] => {
        const inside = color.match(/^rgba?\((.+)\)$/)?.[1];
        if (!inside)
          throw new Error(`a colour this test cannot read: ${color}`);
        const parts = inside.split(/[\s,/]+/).filter(Boolean);
        const num = (text: string, scale: number) =>
          text.endsWith("%")
            ? (parseFloat(text) / 100) * scale
            : parseFloat(text);
        return [
          num(parts[0], 255),
          num(parts[1], 255),
          num(parts[2], 255),
          (parts[3] === undefined ? 1 : num(parts[3], 1)) * extraAlpha,
        ];
      };
      const isVisible = (el: Element) => {
        const style = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        // A 1 px box is how text is hidden visually (the visuallyHidden class).
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          box.width > 2 &&
          box.height > 2
        );
      };
      const chainOf = (el: Element): Element[] => {
        const chain: Element[] = [];
        for (
          let n: Element | null = el;
          n && !n.matches(screen);
          n = n.parentElement
        )
          chain.unshift(n);
        return chain;
      };
      const featuresOf = (
        style: CSSStyleDeclaration,
        withTextFill: boolean,
      ) => {
        const found: string[] = [];
        if (style.filter && style.filter !== "none")
          found.push(`filter: ${style.filter}`);
        if (style.backdropFilter && style.backdropFilter !== "none")
          found.push(`backdrop-filter: ${style.backdropFilter}`);
        if (style.mixBlendMode !== "normal")
          found.push(`mix-blend-mode: ${style.mixBlendMode}`);
        if (style.backgroundImage !== "none")
          found.push(`background-image: ${style.backgroundImage.slice(0, 60)}`);
        if (withTextFill) {
          const fill = style.getPropertyValue("-webkit-text-fill-color");
          if (fill && fill !== style.color)
            found.push(`-webkit-text-fill-color: ${fill}`);
        }
        return found;
      };
      const layerOf = (el: Element, pseudo?: string) => {
        const style = getComputedStyle(el, pseudo);
        const fill = rgba(style.backgroundColor);
        return {
          fill: fill[3] > 0 ? fill : null,
          opacity: Number(style.opacity),
        };
      };
      const SHAPES = new Set([
        "path",
        "circle",
        "ellipse",
        "rect",
        "line",
        "polyline",
        "polygon",
      ]);
      const out: {
        root: string;
        what: string;
        text: [number, number, number, number];
        layers: {
          fill: [number, number, number, number] | null;
          opacity: number;
        }[];
        features: string[];
      }[] = [];
      const present: Record<string, number> = {};
      const measuredEls = new Set<Element>();
      const describe = (el: Element, pseudo?: string) => {
        const classes = (el.getAttribute("class") ?? "").trim();
        return `${el.tagName.toLowerCase()}${classes ? "." + classes.split(/\s+/).join(".") : ""}${pseudo ?? ""}`;
      };
      for (const root of roots) {
        present[root] = 0;
        for (const rootEl of document.querySelectorAll(root)) {
          if (!isVisible(rootEl)) continue;
          present[root] += 1;
          for (const el of [rootEl, ...rootEl.querySelectorAll("*")]) {
            if (measuredEls.has(el)) continue;
            measuredEls.add(el);
            const inSvg = el.closest("svg") !== null;
            // An SVG shape is visible when its svg is.
            if (!isVisible(inSvg ? (el.closest("svg") as Element) : el))
              continue;
            const style = getComputedStyle(el);
            const chain = chainOf(el);
            const layers = chain.map((node) => layerOf(node));
            const ownText = [...el.childNodes].some(
              (n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "",
            );
            // The element's own paint for its text, or for a shape.
            let paint: [number, number, number, number] | null = null;
            if (inSvg && SHAPES.has(el.tagName.toLowerCase())) {
              const fill =
                style.fill !== "none"
                  ? rgba(style.fill, Number(style.fillOpacity))
                  : null;
              const stroke =
                style.stroke !== "none"
                  ? rgba(style.stroke, Number(style.strokeOpacity))
                  : null;
              paint = fill ?? stroke;
            } else if (ownText) {
              paint = rgba(inSvg ? style.fill : style.color);
            }
            if (paint) {
              out.push({
                root,
                what: describe(el),
                text: paint,
                layers,
                features: chain.flatMap((node) =>
                  featuresOf(getComputedStyle(node), node === el),
                ),
              });
            }
            for (const pseudo of ["::before", "::after"]) {
              const content = getComputedStyle(el, pseudo).content;
              if (
                content === "none" ||
                content === "normal" ||
                content === '""'
              )
                continue;
              const pseudoStyle = getComputedStyle(el, pseudo);
              out.push({
                root,
                what: describe(el, pseudo),
                text: rgba(pseudoStyle.color),
                layers: [...layers, layerOf(el, pseudo)],
                features: [
                  ...chain.flatMap((node) =>
                    featuresOf(getComputedStyle(node), false),
                  ),
                  ...featuresOf(pseudoStyle, true),
                ],
              });
            }
          }
        }
      }
      return { out, present };
    },
    { roots: [...roots], screen: CAMERA_SCREEN },
  );

  const unmodelled: string[] = [];
  const items = raw.out.map((item) => {
    for (const feature of item.features) {
      const allowed = ALLOWED_FEATURES.some(
        (rule) =>
          feature.startsWith(rule.feature) && item.root === rule.selector,
      );
      if (!allowed)
        unmodelled.push(
          `${item.what} (in ${item.root}) has ${feature}: the contrast measure does not model it. Remove it, or allow that exact feature on that selector in ALLOWED_FEATURES with a reason.`,
        );
    }
    const { glyph, back } = glyphAndBackOverWhiteLayers(item.text, item.layers);
    return { ...item, ratio: contrast(glyph, back) };
  });
  return {
    present: raw.present,
    items,
    unmodelled: [...new Set(unmodelled)],
  };
}

/** Fails on what the measure cannot vouch for, then on any measured pair under 4.5:1. */
export function assertMeasured(
  measured: Measured,
  options: { required?: readonly string[]; label?: string } = {},
): void {
  const label = options.label ?? "over a white picture";
  expect(
    measured.unmodelled,
    "style the contrast measure does not model",
  ).toEqual([]);
  for (const selector of options.required ?? [])
    expect(
      measured.present[selector] ?? 0,
      `${selector} is on the live screen`,
    ).toBeGreaterThan(0);
  for (const item of measured.items) {
    const text = item.text;
    const fills = item.layers
      .map((layer) => (layer.fill ? layer.fill[3] : "none"))
      .join(" / ");
    const opacities = item.layers.map((layer) => layer.opacity).join(" / ");
    console.log(
      `${label}: ${item.what} (${item.root}) ${item.ratio.toFixed(2)}:1 (text alpha ${text[3]}, fill alpha ${fills}, opacity ${opacities})`,
    );
    expect(
      item.ratio,
      `${item.what} in ${item.root} ${label} (${item.ratio.toFixed(2)}:1; text alpha ${text[3]}, fill alpha ${fills}, opacity ${opacities})`,
    ).toBeGreaterThanOrEqual(4.5);
  }
}

/**
 * Everything visible in the camera screen that carries text or a
 * non-transparent fill must be listed, inside a listed element, or decoration
 * with no text of its own. Independent of axe.
 */
export async function scanForUnlisted(
  page: Page,
  listed: readonly string[],
): Promise<string[]> {
  return page.evaluate(
    ({ listed, decoration, screen }) => {
      const root = document.querySelector(screen);
      if (!root) return ["there is no camera screen to scan"];
      const listedSelector = listed.join(",");
      const decorationSelector = decoration.join(",");
      const problems: string[] = [];
      for (const el of root.querySelectorAll("*")) {
        const tag = el.tagName.toLowerCase();
        if (
          tag === "video" ||
          tag === "canvas" ||
          tag === "style" ||
          tag === "script"
        )
          continue;
        // The photo layer (the frozen picture and its drawing).
        if (el.closest(".easyFrozenSvg, .easyStageContent")) continue;
        const style = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          box.width <= 2 ||
          box.height <= 2 ||
          Number(style.opacity) === 0
        )
          continue;
        const ownText = [...el.childNodes].some(
          (n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "",
        );
        const pseudo = ["::before", "::after"].some((p) => {
          const content = getComputedStyle(el, p).content;
          return content !== "none" && content !== "normal" && content !== '""';
        });
        const bg = style.backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [
          0, 0, 0, 0,
        ];
        const hasFill = (bg[3] ?? 1) > 0;
        if (!ownText && !pseudo && !hasFill) continue;
        if (listedSelector && el.closest(listedSelector)) continue;
        const classes = (el.getAttribute("class") ?? "").trim();
        const name = `${tag}${classes ? "." + classes.split(/\s+/).join(".") : ""}`;
        const what = `${name}${ownText ? ` text "${(el.textContent ?? "").trim().slice(0, 30)}"` : ""}${hasFill ? ` fill ${style.backgroundColor}` : ""}`;
        if (decorationSelector && el.closest(decorationSelector)) {
          if (ownText || pseudo)
            problems.push(`${what}: decoration may not carry text`);
          continue;
        }
        problems.push(
          `${what}: in the camera screen, carrying ${ownText || pseudo ? "text" : "a fill"}, and neither listed (OVER_LIVE_PICTURE) nor decoration (DECORATION)`,
        );
      }
      return problems;
    },
    {
      listed: [...listed],
      decoration: DECORATION.map((d) => d.selector),
      screen: CAMERA_SCREEN,
    },
  );
}
