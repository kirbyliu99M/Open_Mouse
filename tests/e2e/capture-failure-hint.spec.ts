import { expect, test } from "@playwright/test";
import { checkHandDetected } from "../../src/client/photo/gates";
import { HOLD_STILL_TAKING_THE_PHOTO } from "../../src/client/camera/cues";
import {
  CAPTURE_FAILURE_HINT_COPY,
  CAPTURE_FAILURE_HINT_THRESHOLD,
  type CaptureFailureLanguage,
} from "../../src/client/camera/captureFailure";

/**
 * The capture-failure hint in the real component: what the pure counting
 * tests (tests/unit/camera-capture-failure.test.ts) cannot show is that the
 * glue keeps the count across retries (a reset on every retry would keep it
 * from ever reaching 3), shows the line in the cue slot, hides the line under
 * the viewfinder, and clears it after a success.
 *
 * `toBlob` is made to call back with null, which is a frame capture that
 * fails. The fake camera locks onto the paper and the auto-shutter fires by
 * itself, fails, and tries again after the ring refills (about a second).
 * Each `toBlob` call records the screen as it was when the capture ran: call
 * k is made after k - 1 failures have been counted, so call 3 is "after the
 * 2nd" and call 4 is "after the 3rd".
 */

interface ToBlobSnapshot {
  hintShown: boolean;
  cueText: string | null;
  line: string | null;
}

declare global {
  interface Window {
    __toBlobFail: boolean;
    __toBlobLog: ToBlobSnapshot[];
  }
}

const CUE = "[data-testid='camera-cue']";
const LINE_UNDER_VIEWFINDER = "[data-testid='easy-hint']";

const CASES: readonly {
  locale: string;
  language: CaptureFailureLanguage;
}[] = [
  { locale: "zh-TW", language: "zh-TW" },
  { locale: "en-US", language: "en" },
];

for (const { locale, language } of CASES) {
  test.describe(`capture failure hint, browser language ${locale}`, () => {
    test.use({ locale });

    test("shows after the 3rd failed capture in a row, hides the line under the viewfinder, and goes away after a success", async ({
      page,
    }, testInfo) => {
      test.skip(
        testInfo.project.name !== "chromium-camera-paper-edge",
        "Needs the fake-media-device project (paper-edge-full.y4m).",
      );
      const approved = CAPTURE_FAILURE_HINT_COPY[language];

      await page.addInitScript(() => {
        window.__toBlobFail = true;
        window.__toBlobLog = [];
        const real = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob = function (callback, ...rest) {
          const cue = document.querySelector("[data-testid='camera-cue']");
          window.__toBlobLog.push({
            hintShown: cue?.getAttribute("data-capture-failure") === "true",
            cueText: cue?.textContent ?? null,
            line:
              document.querySelector("[data-testid='easy-hint']")
                ?.textContent ?? null,
          });
          if (window.__toBlobFail) {
            setTimeout(() => callback(null), 0);
            return;
          }
          real.call(this, callback, ...rest);
        };
      });

      await page.goto("/scan/easy");
      expect(await page.evaluate(() => navigator.languages[0])).toBe(locale);
      await page.waitForResponse((res) =>
        res.url().includes("/mediapipe/models/hand_landmarker.task"),
      );
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: "Got it" }).click();

      // The 4th capture attempt happens after 3 failures were counted.
      await expect
        .poll(() => page.evaluate(() => window.__toBlobLog.length), {
          timeout: 45_000,
        })
        .toBeGreaterThanOrEqual(CAPTURE_FAILURE_HINT_THRESHOLD + 1);
      const log = await page.evaluate(() => window.__toBlobLog);

      // (1) Not after the 1st or 2nd failure (calls 1, 2 and 3)...
      for (const call of log.slice(0, CAPTURE_FAILURE_HINT_THRESHOLD)) {
        expect(call.hintShown).toBe(false);
        expect(call.cueText).not.toBe(approved);
      }
      // ...and the line under the viewfinder is the usual one while the ring
      // is full, so the next check is not passing for want of it.
      expect(log[0]?.line).toBe(HOLD_STILL_TAKING_THE_PHOTO);
      // After the 3rd, the cue shows the approved line in the page's language.
      expect(log[CAPTURE_FAILURE_HINT_THRESHOLD]?.hintShown).toBe(true);
      expect(log[CAPTURE_FAILURE_HINT_THRESHOLD]?.cueText).toBe(approved);

      const cue = page.locator(CUE);
      await expect(cue).toHaveAttribute("data-capture-failure", "true");
      await expect(cue).toHaveText(approved);
      // (2) The line under the viewfinder is empty while it shows, even
      // with the ring refilling at the moment of the 4th attempt.
      expect(log[CAPTURE_FAILURE_HINT_THRESHOLD]?.line).toBeNull();
      await expect(page.locator(LINE_UNDER_VIEWFINDER)).toHaveCount(0);

      // (3) Restore toBlob: the next capture works, the hint is gone and the
      // flow goes on to the pipeline (no real hand in this scene, so it stops
      // at the hand gate with the retake sheet, as easy-scan.spec.ts expects).
      await page.evaluate(() => {
        window.__toBlobFail = false;
      });
      const sheet = page.getByRole("dialog", { name: "Retake needed" });
      await expect(sheet).toBeVisible({ timeout: 20_000 });
      await expect(sheet).toContainText(checkHandDetected(0)!.message);
      await expect(page.locator("[data-capture-failure]")).toHaveCount(0);

      // A retake starts a fresh count: the camera is live again with no hint.
      await sheet.getByRole("button", { name: "Try again" }).click();
      await expect(sheet).toBeHidden();
      await expect(page.locator("[data-capture-failure]")).toHaveCount(0);
    });
  });
}
