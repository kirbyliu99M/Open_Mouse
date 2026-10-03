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
