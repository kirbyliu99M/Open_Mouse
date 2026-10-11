/**
 * The photo-privacy promise, zh-TW and English. Every zh-TW string is a
 * CANDIDATE (未拍板), Claude's wording, until Kirby has read it. The sentences
 * live in `scan-common.ts` (the scan screens use them too); this module
 * re-exports them under the pages' names. The English is
 * pinned by e2e specs; `src/components/privacy-copy.ts` keeps exporting it as
 * constants for the scan screens.
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";
import * as scanCommon from "./scan-common";

export interface PrivacyCopy {
  /** On a phone. */
  photoStaysOnPhone: string;
  /** On a screen reachable from a computer, where "phone" would be wrong. */
  photoStaysOnDevice: string;
}

export const zhTW: PrivacyCopy = {
  photoStaysOnPhone: scanCommon.zhTW.privacyPhone,
  photoStaysOnDevice: scanCommon.zhTW.privacyDevice,
};

export const en: PrivacyCopy = {
  photoStaysOnPhone: scanCommon.en.privacyPhone,
  photoStaysOnDevice: scanCommon.en.privacyDevice,
};

export function privacyCopy(locale: Locale): PrivacyCopy {
  return pickCopy(locale, { zhTW, en });
}
