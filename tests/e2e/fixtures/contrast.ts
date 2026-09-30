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
