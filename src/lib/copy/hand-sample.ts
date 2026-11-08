/**
 * The "keep these numbers anonymously" switch shown right above the button
 * that sends a scan (contract: src/lib/contracts/hand-sample.ts), zh-TW and
 * English, same keys. Every string is a CANDIDATE (未拍板) until Kirby has read
 * it; the wording is Claude's brief of 2026-11-08 (note revised the same day
 * after a privacy review), used as given.
 *
 * Facts the note rests on: only the numbers are kept, rounded to whole
 * millimetres (`HAND_SAMPLE_ROUND_MM`), with the month and no finer time; no
 * photo, no account, no column linking back to the scan (the contract); a
 * person's own delete of the scan, its session or the account also removes
 * one value-matching copy per scan (`sampleMatchKey`,
 * src/server/scans/hand-sample.ts), while the automatic expiry and purges
 * leave it; once the scan is gone the copy cannot be found again. Change the
 * note with that code, never apart from it.
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

export interface HandSampleCopy {
  /** The switch's name: what turning it on does. */
  label: string;
  /** The sentence under it: what is kept, what is not, and that it cannot be undone. */
  note: string;
  /** The link after the note, to /privacy. */
  privacyLink: string;
}

export const zhTW: HandSampleCopy = {
  label: "匿名保留這次的數值，幫 Palmate 改善推薦",
  note: "只保留手長、手寬等數字（取整到 1 公釐，只記月份），用來改善量測與推薦，並整理成不含個人的統計。副本不含照片和帳號，也沒有連回這次掃描的欄位。你刪除這次掃描或帳號時，我們會一併刪除數值相符的副本；掃描刪除後，就再也無法找出或刪除它。不想保留就關掉。",
  privacyLink: "隱私權政策",
};

export const en: HandSampleCopy = {
  label: "Keep these numbers anonymously to help improve Palmate",
  note: "We keep only the numbers, such as hand length and width (rounded to 1 mm, month only), to improve measuring and recommendations and to build statistics that identify no one. The copy has no photo, no account and no field linking it to this scan. If you delete this scan or your account, we also delete the matching copy; once the scan is gone, it can no longer be found or deleted. Turn this off if you'd rather not.",
  privacyLink: "Privacy policy",
};

export function handSampleCopy(locale: Locale): HandSampleCopy {
  return pickCopy(locale, { zhTW, en });
}
