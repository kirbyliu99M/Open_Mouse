/**
 * The viewer's on-screen strings. English until i18n lands, and CANDIDATES
 * (未拍板): Kirby has not approved the results-page UI. The first two are the
 * exact strings of his Pencil demo (design-exports/results-v2-demo-2026-10-06);
 * the third is the accessible name, which describes what is shown.
 */

/** Shown under the viewer while a model is, or is about to be, on screen. */
export const VIEWER_CAPTION =
  "Size illustration, not a contact simulation. The hand is scaled to your measured hand length and palm width.";

/** Shown in the viewer's box when there is nothing to show; never a raw error. */
export const VIEWER_FALLBACK = "3D preview isn't available for this mouse.";

/** The accessible name of the viewer once it holds a model. */
export function viewerLabel(mouseName: string): string {
  return `3D view of the ${mouseName}, with a hand model scaled to your measured hand length`;
}
