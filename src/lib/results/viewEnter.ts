/**
 * How a results page comes in (V3.2 motion pass #6, candidate / 未拍板). Main
 * and detail are two routes, so the page component mounts afresh on each;
 * this module remembers the page last shown, for as long as the results
 * layout (`ResultsScanProvider`) stays mounted. Leaving the results (home,
 * the scan, another site) unmounts the layout, which forgets it: coming back
 * later is a first arrival, with no direction.
 */

export type ViewEnter = "forward" | "back";

export interface ShownView {
  scanId: string;
  /** "main", or the detail page's mouse slug. */
  key: string;
}

let lastView: ShownView | null = null;

/**
 * The direction a page comes in from, given the page shown just before it in
 * the same results layout: a detail page from the right, the main page from
 * the left; none on a first arrival, for another scan, or for the same page.
 */
export function enterDirection(
  before: ShownView | null,
  scanId: string,
  key: string,
): ViewEnter | undefined {
  if (before === null || before.scanId !== scanId || before.key === key)
    return undefined;
  return key === "main" ? "back" : "forward";
}

export function lastShownView(): ShownView | null {
  return lastView;
}

export function noteShownView(view: ShownView): void {
  lastView = view;
}

/** The results layout unmounted: the next results page is a first arrival. */
export function forgetShownView(): void {
  lastView = null;
}
