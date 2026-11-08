/**
 * The "keep an unnamed copy" switch shown right above the button that sends a
 * scan (contract: src/lib/contracts/hand-sample.ts), zh-TW and English, same
 * keys. Every string is a CANDIDATE (未拍板) until Kirby has read it; the
 * wording is Claude's brief of 2026-11-08 (layered after review round 1 of
 * #240), used as given.
 *
 * Two layers: the label, one short sentence and 「詳細說明」 are always on
 * screen; `details` opens under them. The facts they rest on: only the
 * numbers listed are kept, lengths rounded to whole millimetres
 * (`HAND_SAMPLE_ROUND_MM`), with the month and no finer time; no photo, no
 * account, no column linking back to the scan (the contract); the person's
 * own delete of the scan, its session or the account also removes one
 * value-matching copy per scan (src/server/scans/hand-sample-delete.ts), while
 * the automatic 24-hour expiry and the purges leave it; once the scan is gone
 * the copy cannot be found again. Change this copy with that code, never apart
 * from it.
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

export interface HandSampleCopy {
  /** The switch's name: what turning it on does. */
  label: string;
  /** The one sentence always shown under it. */
  short: string;
  /** The button that opens `details`. */
  detailsToggle: string;
  /** What is kept, what is not, what deletes it; under the button when open. */
  details: string;
  /** The link after the details, to the privacy policy. */
  privacyLink: string;
  /** Said by a screen reader after the link: it opens a new tab. */
  opensNewTab: string;
}

export const zhTW: HandSampleCopy = {
  label: "保留一份不記名的數值副本",
  short: "用來改善量測與推薦。不含照片和帳號；你刪除這次掃描時會一併刪除。",
  detailsToggle: "詳細說明",
  details:
    "保留的內容：手長、手掌長、手寬與各指長度（取整到 1 公釐）、左右手、你選的握法與手掌厚度、量測方式與版本，以及送出的月份。不含照片、帳號，也沒有連回這次掃描的欄位。用途是改善量測與推薦，並整理成不含個人的統計。副本保存到本服務終止為止。你刪除這次掃描或帳號時，我們會一併刪除數值相符的副本；掃描刪除後（未登入的掃描會在 24 小時內自動刪除），就再也無法找出或刪除它。不想保留就關掉。",
  privacyLink: "隱私權政策",
  opensNewTab: "（另開新分頁）",
};

export const en: HandSampleCopy = {
  label: "Keep an unnamed copy of these numbers",
  short:
    "Used to improve measuring and recommendations. No photo, no account; deleted with this scan if you delete it.",
  detailsToggle: "Details",
  details:
    "What we keep: hand length, palm length, palm width and finger lengths (rounded to 1 mm), which hand, the grip and palm thickness you chose, the measuring method and version, and the month it was sent. No photo, no account, and no field linking it to this scan. It is used to improve measuring and recommendations and to build statistics that identify no one. The copy is kept until the service ends. If you delete this scan or your account, we also delete the matching copy; once the scan is gone (scans without an account are deleted automatically within 24 hours), it can no longer be found or deleted. Turn this off if you'd rather not.",
  privacyLink: "Privacy policy",
  opensNewTab: "(opens in a new tab)",
};

export function handSampleCopy(locale: Locale): HandSampleCopy {
  return pickCopy(locale, { zhTW, en });
}
