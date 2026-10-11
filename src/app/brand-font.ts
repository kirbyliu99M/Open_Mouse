import { Inter } from "next/font/google";

/**
 * The wordmark's typeface: Inter 700, the weight of the official logo frame
 * ("Logo · Palmate (Official)" in Pencil). Used on the site name only (the home
 * wordmark, the results top bar, the footer's name, the share card) and not as
 * the page font, so the one weight and the latin subset keep it small.
 * next/font serves the file from this site (the CSP's `default-src 'self'`
 * covers it) with `display: swap` and a size-adjusted fallback, so it never
 * holds up the first paint. `--font-brand` is set on <html> by layout.tsx.
 */
export const brandFont = Inter({
  subsets: ["latin"],
  weight: "700",
  display: "swap",
  variable: "--font-brand",
});
