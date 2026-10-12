/**
 * Which of several elements is on screen. `getClientRects()` is empty for an
 * element that is `display: none` or inside one (what hides the table or the
 * cards), and it exists in every browser, unlike `checkVisibility()` (Safari
 * 17.4 and later), which would throw where it is missing.
 */
export interface HasClientRects {
  getClientRects(): ArrayLike<unknown>;
}

export function isRendered(el: HasClientRects): boolean {
  return el.getClientRects().length > 0;
}

/** The first element that is rendered, or null. */
export function firstRendered<T extends HasClientRects>(
  els: Iterable<T>,
): T | null {
  for (const el of els) if (isRendered(el)) return el;
  return null;
}
