import type { Page } from "@playwright/test";
import { easyScanCopy } from "../../../src/lib/copy/easy-scan";

/**
 * v3.4: the first visit to the camera screen opens the scan tour's
 * "First time scanning?" question (tour/ScanTour.tsx) where it used to open
 * the first-run tip sheet ("Got it"); the typed-length mode keeps the tip.
 * Both are first-run screens that hold the live loop until they close, and
 * both mark `openMouse.easyScan.firstRunTipSeen` when closed this way.
 *
 * A spec that only needs the camera screen open clicks whichever of the two
 * is up: "Got it" on the tip, or "Not my first time, start scanning" on the
 * tour (the answer that closes it at once). A spec ABOUT the tip or the tour
 * asserts its own screen instead (v34-tour.spec.ts).
 *
 * The tour's words are spelled out (not imported) so this helper also runs
 * on a tree without the tour.
 */
const RETURNING_EN = "Not my first time, start scanning";
const RETURNING_ZH = "不是第一次，直接掃描";

export function firstRunCloseButton(page: Page) {
  const names = [
    easyScanCopy("en").tipGotIt,
    easyScanCopy("zh-TW").tipGotIt,
    RETURNING_EN,
    RETURNING_ZH,
  ];
  // Exact names: one of these, nothing else (none has a regex character).
  return page
    .getByRole("button", { name: new RegExp(`^(${names.join("|")})$`) })
    .first();
}

/** Closes the first-run screen (tip or tour question), whichever is up. */
export async function dismissFirstRun(page: Page, timeout = 15_000) {
  await firstRunCloseButton(page).click({ timeout });
}

/**
 * For a spec that freezes the page's animation frames from the moment the
 * picture plays (fixtures/freeze-loop.ts): since v3.4 the tour opens only
 * over a playing picture and lays itself out on animation frames, so with the
 * frames frozen it would never open and could not be closed. Such a spec is
 * not about the first visit: it starts as a returning visitor (the same key
 * the tip and the tour write when closed).
 */
export async function skipFirstRun(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("openMouse.easyScan.firstRunTipSeen", "1");
    } catch {
      // A refused store: the first-run screen shows, and the spec fails loudly.
    }
  });
}
