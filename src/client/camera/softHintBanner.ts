/**
 * The post-shot soft-hint banner (V3.3 WP3b, Kirby 2026-10-26, candidate
 * 未拍板; F20 DESIGN-placement-guidance appendix A and B). At most one light,
 * dismissible line per measured photo, over the photo above the "手部測量完成"
 * sheet, e.g. "Wrist isn't at the bottom edge. Try a retake." A HINT: it never
 * blocks Continue or a retake and never changes a number.
 *
 * The choice is softHint.ts's (`pickSoftHint`: one hint, the first in its
 * priority order, and its repeat throttle: the same one 3 photos in a row on
 * this device is not shown again). Which hints the banner may show is
 * `CAMERA_CONSTANTS.placement.postShot`: a hint switched off is taken out of
 * the picker's thresholds (it never fires), so a switched-off hint cannot
 * stand in front of one that is on. By default only `wrist-align` is on:
 * `blurry` is off (WP1a ruling 1: today's floor fires on most frames),
 * `hand-flat` and the 3D readings wait for WP2, and the hints without banner
 * words yet (`paper-small`, `hand-inside`, `hand-straight`) are off.
 *
 * The device's history is the banner block of the local attempt log
 * (attemptLog.ts `softHintBannerHistoryOf`), so it is kept and deleted with
 * that log. Pure.
 */
import type { Locale } from "../../lib/contracts/locale";
import { cameraCuesCopy } from "../../lib/copy/camera-cues";
import {
  SOFT_HINT_THRESHOLDS,
  pickSoftHint,
  type SoftHintCode,
  type SoftHintInput,
  type SoftHintResult,
  type SoftHintThresholds,
} from "../photo/softHint";
import { CAMERA_CONSTANTS } from "./constants";

/** `CAMERA_CONSTANTS.placement.postShot`, widened for tests. */
export interface SoftHintBannerSwitches {
  readonly wristAlign: boolean;
  readonly handFlat: boolean;
  readonly blurry: boolean;
  readonly palmTilt: boolean;
  readonly fingerFlex: boolean;
  /** The fingers' mean distal/proximal ratio (softHint.ts `fingerRatioMin`). */
  readonly fingerCurl: boolean;
  readonly handStraight: boolean;
  readonly handInside: boolean;
  readonly paperSmall: boolean;
  readonly blurryMinSharpness: number;
  readonly palmTiltMaxDeg: number;
  readonly fingerFlexMaxDeg: number;
}

export const SOFT_HINT_BANNER_SWITCHES: SoftHintBannerSwitches =
  CAMERA_CONSTANTS.placement.postShot;

/** The hints the banner has words for (camera-cues.ts `softHint`). */
export const SOFT_HINT_BANNER_CODES = [
  "wrist-align",
  "hand-flat",
  "blurry",
] as const satisfies readonly SoftHintCode[];
export type SoftHintBannerCode = (typeof SOFT_HINT_BANNER_CODES)[number];

export function isSoftHintBannerCode(
  code: unknown,
): code is SoftHintBannerCode {
  return (
    typeof code === "string" &&
    (SOFT_HINT_BANNER_CODES as readonly string[]).includes(code)
  );
}

/**
 * The picker's thresholds with every switched-off hint taken out (its bounds
 * opened to ±Infinity or set to null), the rest as softHint.ts has them. Pure.
 */
export function softHintBannerThresholds(
  switches: SoftHintBannerSwitches = SOFT_HINT_BANNER_SWITCHES,
  base: SoftHintThresholds = SOFT_HINT_THRESHOLDS,
): SoftHintThresholds {
  return {
    ...base,
    wristToEdgeMinMm: switches.wristAlign ? base.wristToEdgeMinMm : -Infinity,
    wristToEdgeMaxMm: switches.wristAlign ? base.wristToEdgeMaxMm : Infinity,
    handAxisMaxDeg: switches.handStraight ? base.handAxisMaxDeg : Infinity,
    minSideMarginMm: switches.handInside ? base.minSideMarginMm : -Infinity,
    palmOverHandMin: switches.handFlat ? base.palmOverHandMin : -Infinity,
    palmOverHandMax: switches.handFlat ? base.palmOverHandMax : Infinity,
    reachMeanMin: switches.handFlat ? base.reachMeanMin : -Infinity,
    reachMeanMax: switches.handFlat ? base.reachMeanMax : Infinity,
    palmTiltMaxDeg:
      switches.handFlat && switches.palmTilt ? switches.palmTiltMaxDeg : null,
    fingerFlexMaxDeg:
      switches.handFlat && switches.fingerFlex
        ? switches.fingerFlexMaxDeg
        : null,
    fingerRatioMin: switches.fingerCurl ? base.fingerRatioMin : null,
    minPaperWidthFraction: switches.paperSmall
      ? base.minPaperWidthFraction
      : -Infinity,
    minSharpness: switches.blurry ? switches.blurryMinSharpness : null,
  };
}

/**
 * The banner for one measured photo. `history`: this device's earlier banner
 * candidates, oldest first. A code the banner has no words for is never
 * shown (it cannot fire with the default switches). Pure.
 */
export function pickSoftHintBanner(
  input: SoftHintInput,
  history: readonly (SoftHintCode | null)[],
  switches: SoftHintBannerSwitches = SOFT_HINT_BANNER_SWITCHES,
): SoftHintResult {
  const result = pickSoftHint(
    input,
    history,
    softHintBannerThresholds(switches),
  );
  return isSoftHintBannerCode(result.code) || result.code === null
    ? result
    : { ...result, code: null };
}

/** The banner's words. */
export function softHintBannerText(
  code: SoftHintBannerCode,
  locale: Locale,
): string {
  const words = cameraCuesCopy(locale).softHint;
  switch (code) {
    case "wrist-align":
      return words.wristAlign;
    case "hand-flat":
      return words.handFlat;
    case "blurry":
      return words.blurry;
  }
}
