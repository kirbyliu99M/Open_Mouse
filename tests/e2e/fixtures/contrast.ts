/**
 * WCAG contrast ratio of two opaque CSS colours as computed styles report
 * them ("rgb(r, g, b)" or "rgba(r, g, b, a)"; alpha is ignored).
 */
export function contrast(fg: string, bg: string): number {
  const channels = (color: string) =>
    (color.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => Number(v) / 255);
  const luminance = ([r, g, b]: number[]) => {
    const f = (v: number) =>
      v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const [lighter, darker] = [
    luminance(channels(fg)),
    luminance(channels(bg)),
  ].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * A translucent CSS colour laid over white, as an opaque "rgb(r, g, b)": the
 * worst case under white text that sits on a photograph. `extraOpacity` is an
 * element's own `opacity` on top of the colour's alpha.
 */
export function overWhite(color: string, extraOpacity = 1): string {
  const n = (color.match(/[\d.]+/g) ?? []).map(Number);
  const alpha = (n[3] ?? 1) * extraOpacity;
  const [r, g, b] = n
    .slice(0, 3)
    .map((v) => Math.round(v * alpha + 255 * (1 - alpha)));
  return `rgb(${r}, ${g}, ${b})`;
}

/** A computed style colour as [r, g, b, a] (0-255, alpha 0-1). */
export type Rgba = readonly [number, number, number, number];

/** One element of the chain between the camera screen and the text: its own fill and its opacity. */
export interface Layer {
  readonly fill: Rgba | null;
  readonly opacity: number;
}

interface Premultiplied {
  readonly c: readonly [number, number, number];
  readonly a: number;
}
const NOTHING: Premultiplied = { c: [0, 0, 0], a: 0 };
const premultiplied = (colour: Rgba): Premultiplied => ({
  c: [colour[0] * colour[3], colour[1] * colour[3], colour[2] * colour[3]],
  a: colour[3],
});
/** `top` laid over `bottom` (normal blending, premultiplied). */
const over = (top: Premultiplied, bottom: Premultiplied): Premultiplied => ({
  c: [
    top.c[0] + bottom.c[0] * (1 - top.a),
    top.c[1] + bottom.c[1] * (1 - top.a),
    top.c[2] + bottom.c[2] * (1 - top.a),
  ],
  a: top.a + bottom.a * (1 - top.a),
});

/**
 * What a glyph pixel and the pixel next to it look like when an element is laid
 * over a WHITE picture (the worst case under light text). `layers` are the
 * elements from the outermost inside the camera screen down to the one that
 * carries the text, each with its own fill (`null` = none) and its `opacity`;
 * `text` is the text colour with its alpha.
 *
 * Exactly as the browser draws it: an element is drawn into a group (its fill,
 * then its children over that), and the group is faded by the element's
 * opacity before it goes over what is behind. So, from the text outwards:
 *
 *   group      = (inner group, or the text) over this element's fill
 *   faded      = group * opacity
 *   at the end = the outermost faded group over white
 *
 * The pixel beside the glyph is the same walk without the text. Returned as
 * opaque "rgb(r, g, b)" strings for `contrast`.
 */
export function glyphAndBackOverWhiteLayers(
  text: Rgba,
  layers: readonly Layer[],
): { glyph: string; back: string } {
  const walk = (start: Premultiplied) => {
    let content = start;
    for (let j = layers.length - 1; j >= 0; j--) {
      const { fill, opacity } = layers[j];
      const merged = over(content, fill ? premultiplied(fill) : NOTHING);
      content = {
        c: [
          merged.c[0] * opacity,
          merged.c[1] * opacity,
          merged.c[2] * opacity,
        ],
        a: merged.a * opacity,
      };
    }
    const channel = (i: 0 | 1 | 2) =>
      Math.round(255 * (1 - content.a) + content.c[i]);
    return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
  };
  return { glyph: walk(premultiplied(text)), back: walk(NOTHING) };
}

/**
 * One element: its text, its fill (`null` = none) and its opacity. The special
 * case of `glyphAndBackOverWhiteLayers` with a single layer.
 */
export function glyphAndBackOverWhite(
  text: Rgba,
  fill: Rgba | null,
  opacity: number,
): { glyph: string; back: string } {
  return glyphAndBackOverWhiteLayers(text, [{ fill, opacity }]);
}
