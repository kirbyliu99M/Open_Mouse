/**
 * The privacy notice (`/privacy`) and the terms of use (`/terms`), zh-TW and
 * English. Pre-launch audit 2026-10-28: the footer's "Privacy" led to a
 * two-sentence card, and there were no terms. Written from what the code
 * does (photos stay on the phone, the stores and the retention in
 * src/server/scans/retention.ts and src/server/account/purge.ts).
 *
 * Kirby OK'd the drafts on 2026-10-28; the operator and the contact follow
 * the team's tester letter. Not legal advice.
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export interface LegalCopy {
  privacyTitle: string;
  termsTitle: string;
  updated: string;
  back: string;
  privacyIntro: string;
  privacySections: LegalSection[];
  termsSections: LegalSection[];
  /** The link from one page to the other. */
  seeTerms: string;
  seePrivacy: string;
}

export const zhTW: LegalCopy = {
  privacyTitle: "隱私權政策",
  termsTitle: "使用條款",
  updated: "最後更新：2026 年 10 月 28 日",
  back: "回首頁",
  privacyIntro:
    "Palmate 由 Palmate 團隊經營，我們是國立臺灣大學創創學程「創意思考與策略實務」課程的學生團隊。我們依中華民國《個人資料保護法》告知你以下事項。",
  privacySections: [
    {
      heading: "我們蒐集什麼",
      paragraphs: [
        "手部照片：不蒐集。照片只在你的手機上分析，不會上傳；送到伺服器的只有測量數值，例如手長與手寬。",
        "測量數值與掃描結果：手部尺寸、你選擇的握法，以及據此算出的滑鼠排序。",
        "帳號資料（只有用 Google 登入時）：Google 提供的姓名、Email、大頭貼，以及登入所需的授權資料。",
        "問卷與回饋（自願填寫）：你填的滑鼠使用經驗、評分與意見。問卷內容不會連回你的帳號。",
        "使用統計：PostHog 記錄匿名的頁面使用情形，不使用 cookie、不記錄 IP、不錄製畫面。你同意 cookie 後，才會載入 Google Analytics。",
        "錯誤紀錄：網站出錯時，Sentry 會收到錯誤訊息；Email、IP 與測量數值會先被移除。",
      ],
    },
    {
      heading: "用途",
      paragraphs: [
        "計算並顯示適合你手型的滑鼠、讓登入的你保存與查看結果、改善測量與推薦的準確度，以及維護網站的安全與穩定。",
      ],
    },
    {
      heading: "誰會處理你的資料",
      paragraphs: [
        "我們使用下列服務商，資料可能存放或傳輸到台灣以外的地區，包括美國：Vercel（網站主機）、Neon（資料庫）、Google（帳號登入；Gemini 把測量數值寫成說明文字，只收到數值，不會收到照片或你的姓名）、PostHog（使用統計）、Sentry（錯誤紀錄），以及你同意後的 Google Analytics。",
      ],
    },
    {
      heading: "保存多久",
      paragraphs: [
        "未登入時的掃描：建立後 24 小時內刪除。",
        "登入的帳號：90 天未使用，帳號與它的所有掃描會被刪除。",
        "你可以隨時在「帳號」頁刪除帳號，所有相關資料會一併刪除。",
      ],
    },
    {
      heading: "你的權利",
      paragraphs: [
        "依個資法第 3 條，你可以查詢、閱覽、要求複本、補充或更正、要求停止蒐集處理利用，以及要求刪除你的個人資料。請寄信到 palmate.tw@gmail.com；刪除帳號也可以直接在「帳號」頁完成。",
        "不登入也能完整使用掃描與推薦，只是結果不會被保存。",
      ],
    },
    {
      heading: "本政策的變更",
      paragraphs: ["內容有重大變更時，我們會更新本頁的日期並在網站上公告。"],
    },
  ],
  termsSections: [
    {
      heading: "服務性質",
      paragraphs: [
        "Palmate 依你的手部測量數值，估算並排序可能適合你的滑鼠。所有測量與推薦都是估算，僅供參考，不是醫療、健康或人體工學上的建議或保證。",
      ],
    },
    {
      heading: "不保證",
      paragraphs: [
        "我們盡力讓資料正確，但不保證滑鼠規格、連結或推薦結果完全正確或適合你。購買前請以官方資訊為準。",
      ],
    },
    {
      heading: "品牌與商標",
      paragraphs: [
        "網站上的品牌名稱、型號與商標屬於各自的權利人。Palmate 與這些品牌沒有合作或從屬關係，提及它們只為說明產品。",
      ],
    },
    {
      heading: "資料與圖片",
      paragraphs: [
        "本網站的滑鼠資料彙整、整理與呈現方式受著作權等相關法律保護。未經同意，請勿以程式大量擷取、複製或再散布本網站的資料或圖片。",
      ],
    },
    {
      heading: "合理使用",
      paragraphs: ["請勿干擾網站運作、繞過流量限制，或以自動化方式大量存取。"],
    },
    {
      heading: "責任限制",
      paragraphs: [
        "在法律允許的範圍內，Palmate 對因使用或無法使用本服務所生的損失不負賠償責任。",
      ],
    },
    {
      heading: "準據法與聯絡",
      paragraphs: ["本條款以中華民國法律為準據法。聯絡：palmate.tw@gmail.com"],
    },
  ],
  seeTerms: "使用條款",
  seePrivacy: "隱私權政策",
};

export const en: LegalCopy = {
  privacyTitle: "Privacy",
  termsTitle: "Terms of use",
  updated: "Last updated: 28 October 2026",
  back: "Home",
  privacyIntro:
    "Palmate is run by the Palmate team, a student team from a course at National Taiwan University. This notice follows Taiwan's Personal Data Protection Act.",
  privacySections: [
    {
      heading: "What we collect",
      paragraphs: [
        "Hand photos: none. The photo is analysed on your phone and never uploaded; only the measurements (such as hand length and width) reach our server.",
        "Measurements and results: your hand sizes, the grip you chose, and the mice ranked from them.",
        "Account (only if you sign in with Google): the name, email and picture Google provides, and what sign-in needs.",
        "Survey and feedback (optional): what you tell us about your mice. Survey answers are not linked back to your account.",
        "Usage statistics: PostHog records anonymous page use, with no cookies, no IP address and no screen recording. Google Analytics loads only after you accept cookies.",
        "Error reports: when something breaks, Sentry gets the error, with emails, IP addresses and measurements removed first.",
      ],
    },
    {
      heading: "Why",
      paragraphs: [
        "To rank the mice for your hand, to keep your results when you sign in, to make the measurements and rankings more accurate, and to keep the site safe and running.",
      ],
    },
    {
      heading: "Who processes it",
      paragraphs: [
        "These providers may store or move data outside Taiwan, including the United States: Vercel (hosting), Neon (database), Google (sign-in; Gemini turns the measurements into text and receives only the numbers, never the photo or your name), PostHog (statistics), Sentry (errors), and Google Analytics once you agree.",
      ],
    },
    {
      heading: "How long",
      paragraphs: [
        "Scans without an account: deleted within 24 hours.",
        "Accounts: deleted, with all their scans, after 90 days without use.",
        "You can delete your account on the Account page at any time; everything that belongs to it goes with it.",
      ],
    },
    {
      heading: "Your rights",
      paragraphs: [
        "You can ask to see, copy, correct or delete your personal data, or ask us to stop using it: write to palmate.tw@gmail.com. Deleting your account can also be done on the Account page.",
        "Scanning and the rankings work without an account; the results are just not kept.",
      ],
    },
    {
      heading: "Changes",
      paragraphs: [
        "If this notice changes in a way that matters, we update the date here and say so on the site.",
      ],
    },
  ],
  termsSections: [
    {
      heading: "What Palmate is",
      paragraphs: [
        "Palmate estimates and ranks mice that may fit your hand from its measurements. Every measurement and ranking is an estimate, for reference only, and not medical, health or ergonomic advice or a guarantee.",
      ],
    },
    {
      heading: "No warranty",
      paragraphs: [
        "We try to keep the data right, but we can't promise that specifications, links or rankings are complete, correct or right for you. Check the maker's information before you buy.",
      ],
    },
    {
      heading: "Brands and trademarks",
      paragraphs: [
        "Brand names, models and trademarks belong to their owners. Palmate is not affiliated with any of them and names them only to describe the products.",
      ],
    },
    {
      heading: "Data and images",
      paragraphs: [
        "The way this site compiles, organises and presents its mouse data is protected by copyright and related laws. Please don't scrape, copy or republish the site's data or images in bulk without permission.",
      ],
    },
    {
      heading: "Fair use",
      paragraphs: [
        "Don't disrupt the site, get around its rate limits, or access it automatically in bulk.",
      ],
    },
    {
      heading: "Liability",
      paragraphs: [
        "As far as the law allows, Palmate is not liable for losses from using, or not being able to use, the service.",
      ],
    },
    {
      heading: "Law and contact",
      paragraphs: [
        "These terms are governed by the laws of Taiwan (R.O.C.). Contact: palmate.tw@gmail.com",
      ],
    },
  ],
  seeTerms: "Terms of use",
  seePrivacy: "Privacy",
};

export function legalCopy(locale: Locale): LegalCopy {
  return pickCopy(locale, { zhTW, en });
}
