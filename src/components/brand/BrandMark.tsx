/** The Palmate brand mark, version L2 (Kirby, 2026-10-10): a rounded square
 * holding a line drawing of a hand. Purely decorative: the site name beside it
 * is the accessible name, so the SVG is hidden from assistive technology and
 * is never focusable. Colours come from classes in globals.css (tokens, with
 * print, high-contrast and forced-colours rules), never from here. The size is
 * 28 px by default and can be set by CSS on `.brand-mark`.
 *
 * The frame is drawn inside the square (x = y = 0.5, 31 x 31) so its stroke is
 * not half-clipped at the edge of the viewBox. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      className={className ? `brand-mark ${className}` : "brand-mark"}
      data-testid="brand-mark"
      viewBox="0 0 32 32"
      width={28}
      height={28}
      aria-hidden="true"
      focusable="false"
    >
      <rect
        className="brand-mark-plate"
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="7.5"
      />
      <g transform="translate(-5.16 -2.4) scale(0.46)">
        <path
          className="brand-mark-hand"
          d="M38 48c0 4 4 6 7 4 3-2 3-8-1-11-6-4-16 1-18 11-2 12 10 20 22 20 12 0 22-8 24-22 1-12-4-24-8-28-2-2-5-1-5 2 0 8 4 20 3 30m-4-16c0-12-2-22-6-24-2-2-5-1-6 2-2 8 0 20 0 30m-2-14c-1-8-3-14-7-16-2-2-5-1-6 2-2 8 1 20 3 28m-4-10c-2-6-5-12-8-12-3 0-4 3-3 8 1 8 3 16 5 22"
          fill="none"
          strokeWidth="7.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
