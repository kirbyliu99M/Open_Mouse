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

/**
 * What a glyph pixel and the pixel next to it look like when an element is laid
 * over a WHITE picture (the worst case under light text): the element's own
 * text colour with its alpha, its own fill with its alpha (`null` = no fill of
 * its own), and its opacity (its own times its ancestors' inside the screen)
 * that fades the element as a whole.
 *
 * The element is drawn into a group first (fill, then the glyph over it) and
 * the group is then faded over the picture, which is how `opacity` works:
 *
 *   group coverage   A = at + ab * (1 - at)
 *   group colour    C*A = text * at + fill * ab * (1 - at)
 *   on the picture  white * (1 - o * A) + o * C*A
 *
 * Returned as opaque "rgb(r, g, b)" strings for `contrast`.
 */
export function glyphAndBackOverWhite(
  text: Rgba,
  fill: Rgba | null,
  opacity: number,
): { glyph: string; back: string } {
  const at = text[3];
  const ab = fill ? fill[3] : 0;
  const coverage = at + ab * (1 - at);
  const rgb = (channels: number[]) =>
    `rgb(${channels.map((v) => Math.round(v)).join(", ")})`;
  const glyph = [0, 1, 2].map(
    (i) =>
      255 * (1 - opacity * coverage) +
      opacity * (text[i] * at + (fill ? fill[i] * ab : 0) * (1 - at)),
  );
  const back = [0, 1, 2].map(
    (i) => 255 * (1 - opacity * ab) + opacity * (fill ? fill[i] * ab : 0),
  );
  return { glyph: rgb(glyph), back: rgb(back) };
}
