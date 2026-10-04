import { expect, type Page } from "@playwright/test";
import {
  contrast,
  glyphAndBackOverWhiteLayers,
  type Layer,
  type Rgba,
} from "./contrast";

/**
 * The print check shared by the print specs. Chrome prints no backgrounds
 * unless the user asks for them, and the site is dark on screen, so a colour
 * written for the dark theme (light grey captions, near-white button labels)
 * would print as light text on white. In print the text must be dark on white.
 *
 * Two things are checked, for every piece of visible text: its contrast against
 * white (what a printer without "background graphics" produces), and against
 * the background actually behind it in the print layout (what it produces
 * with them on). Both must reach 4.5:1. No assertion depends on a font.
 */

const WHITE = "rgb(255, 255, 255)";
export const MIN_CONTRAST = 4.5;
/** The check must find real text, not pass over an empty page. */
const DEFAULT_MIN_SAMPLES = 20;

export interface Sample {
  readonly text: string;
  readonly where: string;
  readonly color: Rgba;
  readonly layers: readonly Layer[];
}

/**
 * Every visible text node's colour and the chain of fills and opacities from
 * the page down to it. `skip` is a selector for a subtree left out (the demo's
 * developer controls, which are never printed from production). `root` is the
 * subtree read: `main` (the default; `body` when the page has none).
 */
export async function textSamples(
  page: Page,
  { skip, root: rootSelector = "main" }: { skip?: string; root?: string } = {},
): Promise<Sample[]> {
  return page.evaluate(
    ({ skipSelector, rootSelector }) => {
      const rgba = (value: string): [number, number, number, number] => {
        const n = (value.match(/[\d.]+/g) ?? []).map(Number);
        return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, n[3] ?? 1];
      };
      const describe = (el: Element) =>
        el.tagName.toLowerCase() +
        (el.className && typeof el.className === "string"
          ? "." + el.className.trim().split(/\s+/).join(".")
          : "");
      const found: {
        text: string;
        where: string;
        color: [number, number, number, number];
        layers: {
          fill: [number, number, number, number] | null;
          opacity: number;
        }[];
      }[] = [];
      const root = document.querySelector(rootSelector) ?? document.body;
      for (const el of [root, ...root.querySelectorAll("*")]) {
        if (skipSelector && el.closest(skipSelector)) continue;
        if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(el.tagName)) continue;
        const own = [...el.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? "")
          .join(" ")
          .trim();
        if (!own) continue;
        const style = getComputedStyle(el);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          el.getClientRects().length === 0
        )
          continue;
        const layers: {
          fill: [number, number, number, number] | null;
          opacity: number;
        }[] = [];
        const chain: Element[] = [];
        for (let node: Element | null = el; node; node = node.parentElement)
          chain.unshift(node);
        for (const node of chain) {
          const s = getComputedStyle(node);
          const fill = rgba(s.backgroundColor);
          layers.push({
            fill: fill[3] === 0 ? null : fill,
            opacity: Number(s.opacity),
          });
        }
        found.push({
          text: own.slice(0, 48),
          where: describe(el),
          color: rgba(style.color),
          layers,
        });
      }
      return found;
    },
    { skipSelector: skip ?? null, rootSelector },
  );
}

/** Every text sample that does not reach 4.5:1 on white or on its own backing. */
export function weakSamples(samples: readonly Sample[]): string[] {
  const weak: string[] = [];
  for (const { text, where, color, layers } of samples) {
    const { glyph, back } = glyphAndBackOverWhiteLayers(color, layers);
    const onWhite = contrast(glyph, WHITE);
    const onBacking = contrast(glyph, back);
    if (onWhite < MIN_CONTRAST || onBacking < MIN_CONTRAST)
      weak.push(
        `${where} "${text}": ${onWhite.toFixed(2)}:1 on white, ${onBacking.toFixed(2)}:1 on its backing`,
      );
  }
  return weak;
}

export async function expectPrintsDark(
  page: Page,
  label: string,
  options: { skip?: string; root?: string; minSamples?: number } = {},
) {
  const samples = await textSamples(page, options);
  expect(samples.length, `${label}: text found`).toBeGreaterThan(
    options.minSamples ?? DEFAULT_MIN_SAMPLES,
  );
  expect(weakSamples(samples), label).toEqual([]);
}
