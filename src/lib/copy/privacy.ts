/**
 * The photo-privacy promise, zh-TW and English. Every zh-TW string is a
 * CANDIDATE (未拍板), Claude's wording, until Kirby has read it. The English is
 * pinned by e2e specs; `src/components/privacy-copy.ts` keeps exporting it as
 * constants for the scan screens.
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

export interface PrivacyCopy {
  /** On a phone. */
  photoStaysOnPhone: string;
  /** On a screen reachable from a computer, where "phone" would be wrong. */
  photoStaysOnDevice: string;
}

export const zhTW: PrivacyCopy = {
  photoStaysOnPhone: "你的照片不會離開手機，只會傳送測量數值。",
  photoStaysOnDevice: "你的照片不會離開這台裝置，只會傳送測量數值。",
};

export const en: PrivacyCopy = {
  photoStaysOnPhone:
    "Your photo never leaves your phone. Only measurements are sent.",
  photoStaysOnDevice:
    "Your photo never leaves this device. Only measurements are sent.",
};

export function privacyCopy(locale: Locale): PrivacyCopy {
  return pickCopy(locale, { zhTW, en });
}
