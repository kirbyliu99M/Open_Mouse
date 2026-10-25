import { expect, type Page } from "@playwright/test";

/**
 * V3.2 motion pass (candidate / 未拍板): a record of every piece of the scan
 * flow that leaves the screen, taken the moment it starts to leave, so a spec
 * can check how it goes without racing a 120–240 ms animation.
 *
 * A piece starts to leave when the script sets `data-leaving="true"` on it
 * (useLeaving.ts), or, for the retaken photo and the tip's scrim, when the
 * leaving layer is added. The observer runs after React's commit, so a
 * native dialog has already been closed by then (`open` is read too).
 */
export interface LeavingRecord {
  readonly className: string;
  readonly animationName: string;
  readonly animationDuration: string;
  readonly inert: boolean;
  /** For a <dialog>: whether it was still open; null for anything else. */
  readonly open: boolean | null;
}

type LeavingWindow = Window & { __leaving?: LeavingRecord[] };

/** Installs the recorder; call before `page.goto`. */
export async function recordLeaving(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as Window & {
      __leaving?: {
        className: string;
        animationName: string;
        animationDuration: string;
        inert: boolean;
        open: boolean | null;
      }[];
    };
    w.__leaving = [];
    const note = (el: Element) => {
      const style = getComputedStyle(el);
      w.__leaving!.push({
        className:
          typeof el.className === "string"
            ? el.className
            : (el.getAttribute("class") ?? ""),
        animationName: style.animationName,
        animationDuration: style.animationDuration,
        inert: (el as HTMLElement).inert === true,
        open: el instanceof HTMLDialogElement ? el.open : null,
      });
    };
    const added = [".easyPhotoLeaving", ".easyTipScrim"];
    const start = () =>
      new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === "attributes") {
            const el = record.target as Element;
            if (el.getAttribute("data-leaving") === "true") note(el);
            continue;
          }
          for (const node of record.addedNodes) {
            if (!(node instanceof Element)) continue;
            for (const selector of added)
              if (node.matches(selector)) note(node);
          }
        }
      }).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["data-leaving"],
      });
    start();
  });
}

/** What left so far, in order. */
export function leavingRecords(page: Page): Promise<LeavingRecord[]> {
  return page.evaluate(() => (window as LeavingWindow).__leaving ?? []);
}

/** The first record whose class list has `cls`. */
export function leftWith(
  records: readonly LeavingRecord[],
  cls: string,
): LeavingRecord | undefined {
  return records.find((r) => r.className.split(/\s+/).includes(cls));
}

/**
 * Fix round (review item 8): an interrupted transition must not leave
 * anything behind. Once it has played out, nothing is still marked leaving
 * and nothing is still inert (nothing in the scan flow is inert at rest: the
 * modal dialogs make the page inert without the attribute).
 */
export async function expectSettled(page: Page): Promise<void> {
  await expect(page.locator("[data-leaving]")).toHaveCount(0);
  await expect(page.locator("[inert]")).toHaveCount(0);
}
