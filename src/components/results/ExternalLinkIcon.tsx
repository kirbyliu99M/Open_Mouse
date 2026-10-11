/**
 * The small "opens elsewhere" arrow used by the official link and the purchase
 * rows: a box with an arrow leaving its top right corner. Decorative (the link
 * says it opens in a new tab in words). Drawn on a 16 px grid, stroke 1.5, with
 * `currentColor`, so the link's colour and the high-contrast variants apply.
 */
export function ExternalLinkIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`results-extIcon ${className}`.trim()}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6.5 3.5H4a1 1 0 0 0-1 1V12a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1V9.5" />
      <path d="M9 3h4v4" />
      <path d="M13 3 7.5 8.5" />
    </svg>
  );
}
