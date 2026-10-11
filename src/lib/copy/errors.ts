/**
 * Every sentence on the not-found and error screens, zh-TW and English. Every
 * zh-TW string is a CANDIDATE (未拍板), Claude's Taiwan wording, until Kirby has
 * read it. The English is the old wording, moved verbatim, and still pending
 * Kirby's confirmation; `src/components/errors/copy.ts` keeps exporting it as
 * constants for the tests.
 *
 * None of these screens ever shows an error's message, stack or a file path:
 * the only thing an error screen may print about the failure is its digest,
 * labelled `referenceLabel`.
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";
import { SITE_NAME } from "../site";

export interface ErrorsCopy {
  actions: { home: string; scan: string; retry: string };
  notFound: {
    eyebrow: string;
    title: string;
    message: string;
    /** The page name only: the root layout's title template adds the site name. */
    pageTitle: string;
  };
  error: { eyebrow: string; title: string; message: string };
  globalError: {
    eyebrow: string;
    title: string;
    message: string;
    /** The complete title, site name included: no layout template reaches this page. */
    documentTitle: string;
  };
  referenceLabel: string;
  /** Announced (role=status) while the Try again request is running. */
  retrying: string;
}

export const zhTW: ErrorsCopy = {
  actions: { home: "回到首頁", scan: "掃描我的手", retry: "再試一次" },
  notFound: {
    eyebrow: "錯誤 404",
    title: "找不到這個頁面",
    message: "連結可能已經過期，或頁面已經移動。你可以回到首頁，或開始掃描。",
    pageTitle: "找不到頁面",
  },
  error: {
    eyebrow: "發生問題",
    title: "這個操作沒有成功",
    message: "我們無法顯示這個頁面。請再試一次，或回到首頁重新開始。",
  },
  globalError: {
    eyebrow: "發生問題",
    title: `${SITE_NAME} 發生問題`,
    message: "應用程式無法自行恢復。請再試一次，或回到首頁重新開始。",
    documentTitle: `發生問題 · ${SITE_NAME}`,
  },
  referenceLabel: "參考編號",
  retrying: "正在重試…",
};

export const en: ErrorsCopy = {
  actions: { home: "Back to home", scan: "Scan my hand", retry: "Try again" },
  notFound: {
    eyebrow: "Error 404",
    title: "We can’t find that page",
    message:
      "The link may be out of date, or the page may have moved. You can head back home or start a scan.",
    pageTitle: "Page not found",
  },
  error: {
    eyebrow: "Something went wrong",
    title: "That didn’t work",
    message:
      "We couldn’t show this page. Try again, or head back home and start from there.",
  },
  globalError: {
    eyebrow: "Something went wrong",
    title: `${SITE_NAME} hit a problem`,
    message:
      "The app couldn’t recover on its own. Try again, or head back home and start from there.",
    documentTitle: `Something went wrong · ${SITE_NAME}`,
  },
  referenceLabel: "Reference",
  retrying: "Trying again…",
};

export function errorsCopy(locale: Locale): ErrorsCopy {
  return pickCopy(locale, { zhTW, en });
}
