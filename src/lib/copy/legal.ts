/**
 * The privacy notice (`/privacy`) and the terms of use (`/terms`), zh-TW and
 * English. Pre-launch audit 2026-10-28: the footer's "Privacy" led to a
 * two-sentence card, and there were no terms. Kirby OK'd those drafts on
 * 2026-10-28; the operator and the contact follow the team's tester letter.
 * Not legal advice.
 *
 * Touchpoint (2026-11-08): the privacy sections are policy v2.1
 * (docs/design/touchpoint-2026-11-08/privacy-policy-v2-draft.md, sections
 * 一–十二), every string a CANDIDATE (未拍板) until Kirby has read it. This
 * page renders a heading and plain paragraphs, so the draft's lists are one
 * paragraph per item. Its 〔待 Kirby〕 blanks are resolved conservatively,
 * never with an unchecked fact:
 *   - the controller keeps the current name, Palmate 團隊 (TODO below);
 *   - accounts: kept until deleted or 90 days unused (Kirby 2026-11-10:
 *     production runs RETENTION_PURGE_MODE=delete; the value is a secret, so
 *     this rests on his word);
 *   - retention days and regions say "per the provider's settings", except
 *     PostHog's United States (src/server/analytics/proxy.ts);
 *   - Gemini receives the numbers, the grip and the picks only.
 * The terms are unchanged.
 *
 * RELEASE ORDER: ships in the SAME deploy as NEXT_PUBLIC_ERROR_PHOTO_ENABLED=1
 * (#241); never deploy this policy with the flag off. The policy describes the
 * opt-in photo upload and points to the 「刪除我傳送的照片」 form, which
 * src/app/privacy/page.tsx renders only under that flag
 * (tests/unit/legal-pages.test.ts documents the coupling).
 *
 * Item 三.8 / 3.8 and the matching section-六 paragraph describe the data
 * tester page `/scan/tester` (#243, contract src/lib/contracts/tester.ts,
 * consent text src/lib/tester/copy.ts). Open to anyone since Kirby
 * 2026-11-10 (`TESTER_OPEN=1`; invite codes still work). They apply only to
 * people who agree on that page, so they stay true while it is off; keep
 * them in step with the page's consent text (candidate).
 * TODO(Kirby): 三.8 says the tester page sends no GA page views; the code
 * mutes them, but GA "Enhanced measurement" (scroll, outbound clicks) can
 * only be turned off in the GA admin (src/client/analytics/ga4.ts). Turn it
 * off, or this sentence needs softening. One local export folder only:
 * scripts/tester-delete.ts cleans just that folder.
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
  // TODO(Kirby): 上線日 — policy v2.1 changes the content; set the date it goes live.
  updated: "最後更新：2026 年 10 月 28 日",
  back: "回首頁",
  // TODO(Kirby): 蒐集者名稱 — the draft asks for the responsible person or a
  // registered group name; until then the current wording 「Palmate 團隊」 stays.
  privacyIntro:
    "本服務 Palmate 的個人資料蒐集者為 Palmate 團隊（以下稱「我們」），聯絡信箱 palmate.tw@gmail.com。我們是修習國立臺灣大學創創學程「創意思考與策略實務」課程的學生；本服務由我們自行經營，不是臺灣大學的服務。依《個人資料保護法》（以下稱個資法）第 8 條，以下說明我們蒐集哪些資料、為什麼蒐集、怎麼使用、保存多久，以及你有哪些權利。",
  privacySections: [
    {
      heading: "一、重點摘要",
      paragraphs: [
        "照片預設不離開你的裝置。掃描時，照片只在你的瀏覽器裡分析。只有你在掃描失敗時按下「傳送這張照片，幫我們修正」，或按「數字看起來不對？」回報，並勾選同意，照片才會上傳。測試者在測試頁面同意參加時，也同意附上照片；每一張都可以在開始掃描前取消（見第三節第 8 項）。",
        "測量數值預設會保留一份不連到帳號的副本。送出掃描前，畫面上有「保留一份不記名的數值副本」開關，預設開啟，可以關掉。",
        "我們不販售個人資料。除了第四節列出、代我們處理資料的服務商，我們不把單筆資料提供給品牌或其他第三方。",
      ],
    },
    {
      heading: "二、蒐集目的、資料類別與利用方式",
      paragraphs: [
        "蒐集目的（法定特定目的）：〇九〇 消費者、客戶管理與服務；一三五 資（通）訊服務；一三六 資（通）訊與資料庫管理；一三七 資通安全與管理；一五七 調查、統計與研究分析。",
        "資料類別：C001 辨識個人者（登入帳號、自願上傳的照片）；C012 身體描述（手部尺寸）；C036 生活格調（問卷中的滑鼠使用經驗）。",
        "利用方式：以電腦自動計算推薦與統計；以加密連線傳輸、以電子方式儲存；上傳的照片由專案負責人人工檢視；對外只發布不含姓名或帳號的彙總統計。",
      ],
    },
    {
      heading: "三、我們蒐集的資料與保存期間",
      paragraphs: [
        "1. 掃描結果。內容：手長、手寬等手部尺寸、左右手、你自己選的握法與手掌厚度（薄／中／厚），以及推薦結果。用途：計算並顯示適合你的滑鼠。保存：未登入時，建立後 24 小時內刪除；登入時保存在你的帳號，直到你刪除帳號，或帳號 90 天未使用時連同帳號一起刪除。",
        "2. 不記名的數值副本（預設開啟，可以關掉）。內容：手長、手掌長、手寬與各指長度（取整到 1 公釐）、左右手、你自己選的握法與手掌厚度（沒選就不記）、校正方式、量測版本、送出的月份（以世界標準時間計）；不含照片、帳號、IP 或裝置資訊，也沒有任何連回該次掃描的欄位。用途：改善量測與推薦的準確度；整理成手型分布等統計，供內部研究與對外發布（見第五節）。保存：本服務營運期間，服務終止時刪除；刪除方式見第六節。",
        "3. 自願上傳的照片（預設不上傳）。內容：手背與紙張或卡片附近範圍的裁切照片（用卡片量測時，偵測到的卡片會先在你的裝置上塗黑；拍攝位置等檔案資訊會移除），以及隨照片附上的資料：這次量到的手長與手寬（取整到 1 公釐）、你回報的正確數字（如果有填）、觸發原因（掃描失敗或數字不對）與失敗代碼、左右手、紙張或卡片種類、量測版本、裝置類別（手機／平板／電腦）、拍照或從相簿選取、照片尺寸、上傳日期。用途：找出量測錯誤的原因並修正。保存：上傳後約 6 個月（180 天）自動刪除；你也可以隨時用刪除碼提早刪除。",
        "4. 帳號資料（只有用 Google 登入時）。內容：Google 提供的姓名、Email、大頭貼、登入所需的授權資料，以及最後使用時間。用途：讓你保存與查看結果。保存：直到你刪除帳號，或帳號 90 天未使用時自動刪除。",
        "5. 問卷與結果評分（自願填寫）。問卷內容：滑鼠使用經驗、滿意度、困擾點、主要用途、握法、目錄外滑鼠的品牌與尺寸感受、留言；手部尺寸以 5 公釐分組。結果評分內容：星等與留言，並附上伺服器從掃描讀出的快照：手型分類、握法、校正方式、手掌厚度、推薦前三名與適配等級、引擎版本、網頁語言。用途：改善推薦；問卷統計會在結果頁顯示給手型相近的其他使用者（見第五節）。登入時送出的問卷與評分會連到你的帳號，問卷可以在「帳號」頁查看與修改。保存：登入時送出的資料跟著帳號刪除；未登入時送出的資料在本服務營運期間保留，服務終止時刪除。",
        "6. 連線資料。內容：你的 IP 位址只以雜湊值暫存，用於流量限制與防止濫用；主機服務商（Vercel）也會留存一般的請求紀錄。用途：維護網站安全。保存：流量限制的雜湊值約 24 小時；主機紀錄依該服務商的設定。",
        "7. 使用統計與錯誤紀錄。PostHog 記錄頁面瀏覽、按鈕與掃描流程事件，以及照片品質的粗略分級（不含測量值），也會收到瀏覽器種類、作業系統、螢幕大小、語言與時區等裝置資訊；不使用 cookie，只在分頁開著時暫存一個隨機識別碼，不會把你的 IP 傳給 PostHog，也不錄製畫面。Google Analytics 在你按下 cookie「同意」後才載入；依 Google 的運作方式，會收到你的 IP 位址與瀏覽器資訊。Sentry 在網站出錯時收到錯誤訊息與瀏覽器種類，並記錄約八成頁面載入與請求的效能追蹤（取樣率 0.8）；Email、IP、帳號與帶單位的測量數值會先移除。保存：依各服務商的設定。",
        "8. 資料測試者的紀錄（只適用於在測試頁面上同意參加的人）。我們請自願的測試者在測試頁面上填寫自己用卷尺量的數值並進行掃描，用來檢查量測準確度；任何人都可以參加，但要在測試頁面上看過說明並同意（需年滿 18 歲）才會記錄，一般掃描不會產生這些紀錄。內容：測試者代號（開放參加時，是你的瀏覽器隨機產生、存在該瀏覽器裡的編號，例如 WK7Q2M9XA，請自己截圖或抄下來；只限受邀參加時，是我們給的代號，例如 P07，不含代碼的其他部分）、一個隨機的紀錄編號、同意說明的版本、日期（紀錄不含時間；照片檔在儲存空間會有上傳時間，照片刪除時一起刪除）、卷尺量的手長與掌寬（每位量測者量兩次，可以有第二位量測者，以及選填的手掌邊到邊寬度）、左右手、自己填的手機型號、桌面、光線、參考物與卡片種類、是否故意拍得不理想、拍照或從相簿選取、嘗試次數、失敗代碼、是否放棄，以及 App 量到的數值、量測版本與校正方式；另有一張處理方式和第 3 項相同的裁切照片與照片尺寸（測試者同意參加時一併同意附上照片，每一張都可以在開始掃描前取消）。紀錄裡沒有姓名、Email、帳號或 IP（流量限制見第 6 項），除了自己填的手機型號，也沒有其他裝置資訊；網站共通的主機紀錄與錯誤紀錄（第 6、7 項）仍然適用。測試頁面不送 PostHog 事件，也不送 Google Analytics 的頁面瀏覽事件，不產生第 2 項的數值副本。用途：只用於改善量測準確度。保存：照片上傳後約 180 天自動刪除；數值保留到我們刪除，或測試者要求刪除為止。為了分析，資料可能會匯出到專案負責人的電腦；電腦上的副本會在每次整理資料時刪除超過 180 天的照片，測試者要求刪除時也會一起刪除。",
      ],
    },
    {
      heading: "四、資料存放在哪裡、誰會處理",
      paragraphs: [
        "我們使用以下服務商代為處理資料。依個資法第 4 條，它們是受我們委託處理資料的對象。資料會存放或傳輸到台灣以外的地區，存放區域依各服務商的設定。",
        "Vercel：網站主機、照片儲存空間。",
        "Neon：資料庫。",
        // Gemini API key is on a paid plan (Kirby 2026-11-10).
        "Google：帳號登入、Google Analytics，以及 Gemini（只收到測量數值、握法和推薦結果，用來寫成說明文字；不會收到照片、姓名或帳號）。",
        // PostHog's region is the only one the repo shows
        // (src/server/analytics/proxy.ts → us.i.posthog.com).
        "PostHog：使用統計；美國。",
        "Sentry：錯誤紀錄。",
        // Only Kirby has Vercel project access (Kirby 2026-11-10).
        "能看到上傳照片的，只有擁有網站主機管理權限的專案負責人一人。",
      ],
    },
    {
      heading: "五、對外分享與統計",
      paragraphs: [
        "我們不販售個人資料。除了第四節的服務商，我們不把單筆資料提供給品牌或其他第三方。",
        "網站上：結果頁的「手掌大小相近的人這樣評價」，至少要有 5 人的問卷資料才會顯示。人數很少時，知道其他填答者答案的人仍可能推算出某一個人的回答，請留意。",
        "網站以外（例如研究報告、與品牌交流）：只使用彙總統計，任何人數少於 10 人的分組都不公開。",
        "新用途：想把資料用在這裡沒寫到的目的時，我們會先更新本政策並另外取得你的同意；之前蒐集的資料不會直接拿去用。",
      ],
    },
    {
      heading: "六、你的權利與行使方式",
      paragraphs: [
        "依個資法第 3 條，你可以對我們保有的個人資料行使以下權利：請求查詢或閱覽、製給複製本、補充或更正、停止蒐集處理利用，以及刪除。",
        "登入的帳號：在「帳號」頁可以查看你的掃描、個人資料與問卷答案，並下載你的掃描紀錄（JSON）；其他資料的複製本請來信索取。你也可以在那裡一次刪除帳號，以及帳號下的所有資料（掃描、問卷、結果評分）。",
        "不記名的數值副本：副本不含帳號或掃描編號，我們也不會主動拿它和你的掃描比對。你刪除某次掃描或整個帳號時，我們會一併刪除數值相符的副本。在你的掃描還保存的期間，你也可以來信要求查詢或刪除對應的副本。掃描刪除之後（未登入的掃描在 24 小時內會自動刪除），就沒有任何資料能把副本對回你，我們也無法再找出或刪除它。不想留下副本，請在送出前關掉開關。",
        "自願上傳的照片：照片不會存進你的帳號，刪除帳號也不會刪到它。請用上傳後畫面上顯示的刪除碼，在本頁下方的「刪除我傳送的照片」刪除。遺失刪除碼時，請來信告訴我們上傳日期，以及當時回報的數字或失敗畫面，我們會比對後刪除；如果比對不出是哪一張，會回信說明，照片也會在 180 天後自動刪除。",
        "未登入時送出的問卷與評分：這些資料不含帳號，也不會連回你的掃描。請不要在留言裡寫姓名、聯絡方式等個人資料；如果寫了，請來信告訴我們送出日期與大致內容，我們會盡力找出並刪除。",
        "資料測試者的紀錄：請寄信到 palmate.tw@gmail.com，附上你的測試者代號（例如 P07 或 WK7Q2M9XA，測試頁面的同意說明上會顯示），我們會刪除這個代號的所有紀錄與照片，包括專案負責人電腦上的副本。我們沒有隨機代號和你本人的對應（紀錄上沒有姓名或聯絡方式），也無法替你查回代號；如果代號遺失（例如清除了瀏覽資料或換了瀏覽器），我們無法確認哪些紀錄是你的，可能無法刪除。你可以附上參加的日期和卷尺數值，我們會盡力比對，但不保證找得到。",
        "其他請求：請寄信到 palmate.tw@gmail.com。查詢、閱覽或要求複製本，我們會在 15 天內回覆是否同意；補充、更正、停止蒐集處理利用或刪除，會在 30 天內回覆。必要時可以延長一次，延長期間不超過原期限，我們會寫信說明原因。",
        "不提供資料的影響：手部測量數值是計算推薦所必需的，不送出就無法得到推薦。登入、不記名副本、上傳照片、問卷、評分與 Google Analytics 都可以自由選擇，不提供也能完整使用掃描與推薦；只是沒有登入時，結果只保存 24 小時。",
      ],
    },
    {
      heading: "七、不記名副本預設保留的依據",
      paragraphs: [
        "送出掃描前，開關旁有簡短說明；按旁邊的「詳細說明」，可以看到副本的內容、用途、保存期間與刪除方式，以及本政策的連結。",
        "依個資法第 7 條第 3 項，你看到說明後沒有關掉開關就送出，視為同意保留。",
        "每一版說明的全文都保存在我們的程式版本紀錄中，可以查證你當時看到的內容。",
      ],
    },
    {
      heading: "八、我們如何保護資料",
      paragraphs: [
        "照片預設只在你的裝置上處理。上傳的照片存放在不公開的儲存空間，檔名是隨機的。",
        "刪除碼只以無法還原的雜湊值保存。",
        // Checked 2026-11-10: http:// answers 308 to https://.
        "網站與服務商之間的連線都經過加密（HTTPS）。",
        "錯誤紀錄與使用統計不含 Email 與帳號；錯誤紀錄裡帶單位的測量數值會先移除，使用統計不記錄測量值，瀏覽器種類則會保留。",
        "發生資料被竊取、竄改、毀損、滅失或洩漏時，我們會即時寄 Email 通知有登入帳號的人；無法個別聯絡的人（例如未登入的使用者），在網站上公告。通知內容包括發生了什麼事、影響哪些資料，以及我們已採取的措施。",
      ],
    },
    {
      heading: "九、未成年人",
      paragraphs: [
        "本服務不要求年齡資料。未滿 18 歲的使用者，請和家長或監護人一起閱讀本政策後再使用；上傳照片前，請先取得家長或監護人的同意。",
      ],
    },
    {
      heading: "十、Cookie 與瀏覽器儲存",
      paragraphs: [
        "網站使用運作必要的 cookie：未登入時的掃描工作階段（scan_session）、登入狀態，以及你選的網頁語言（om_locale）。",
        "網站也會在你的瀏覽器裡存一些設定與紀錄，只留在這台裝置上：你對 cookie 的選擇、是否關掉了不記名副本的開關（palmate.handSample.optOut）、你選的紙張或卡片、是否看過第一次使用的提示與導覽、最近幾次掃描的紀錄（只在本機，供除錯面板使用）、最近的結果清單與結果頁的小提醒，以及是否已填過問卷或評分；在開放參加的測試頁面，還有瀏覽器隨機產生的測試者代號（一打開測試頁面就會產生，同意前不會送出）；只限受邀參加時，則是你輸入的測試者代碼（只存在這個分頁，關掉就清除）；使用統計 PostHog 只在分頁開著時暫存一個隨機識別碼。",
        "以上 cookie 與瀏覽器儲存都不會用來在不同網站之間追蹤你。",
        "Google Analytics 的 cookie 只在你按下「同意」後才使用；不同意也能完整使用網站。",
        "設定可以隨時在頁尾的「Cookie 設定」更改。",
      ],
    },
    {
      heading: "十一、本政策的變更",
      paragraphs: [
        "內容有重大變更時，我們會更新本頁日期並在網站上公告。新的蒐集方式只適用於公告之後蒐集的資料。",
      ],
    },
    {
      heading: "十二、聯絡我們",
      paragraphs: ["palmate.tw@gmail.com"],
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
  // TODO(Kirby): the date policy v2.1 goes live.
  updated: "Last updated: 28 October 2026",
  back: "Home",
  // TODO(Kirby): controller name (see the zh-TW table).
  privacyIntro:
    "The personal data collected by Palmate is controlled by the Palmate team (“we”), contact palmate.tw@gmail.com. We are students taking the course “Creative Thinking and Strategic Practice” in National Taiwan University's D-School program; we run this service ourselves, and it is not a service of National Taiwan University. As Article 8 of Taiwan's Personal Data Protection Act (the PDPA) requires, this notice explains what we collect, why, how we use it, how long we keep it, and your rights.",
  privacySections: [
    {
      heading: "1. Summary",
      paragraphs: [
        "By default your photo does not leave your device. When you scan, the photo is analysed only in your browser. It is uploaded only if you press “Send this photo to help us fix it” after a failed scan, or report with “Numbers look wrong?”, and tick the consent box. Testers agree to attach photos when they agree to take part on the test page, and can untick any shot's photo before that scan starts (see section 3.8).",
        "By default we keep a copy of the measurements that is not linked to any account. Before you send a scan, the screen shows a switch, “Keep an unnamed copy of these numbers”, which is on by default and which you can turn off.",
        "We do not sell personal data. Apart from the providers listed in section 4, which process data on our behalf, we do not give individual records to brands or any other third party.",
      ],
    },
    {
      heading: "2. Purposes, categories and how the data is used",
      paragraphs: [
        "Purposes (the statutory specific purposes): 090 consumer and customer management and service; 135 information and communication services; 136 information, communication and database management; 137 information security and management; 157 surveys, statistics and research analysis.",
        "Categories: C001 identifiers (a sign-in account, a photo you chose to upload); C012 physical description (hand sizes); C036 lifestyle (your experience with mice, from the questionnaire).",
        "How it is used: rankings and statistics are computed automatically; data travels over encrypted connections and is stored electronically; uploaded photos are looked at by the project lead; outside the team we publish only aggregate statistics with no name or account.",
      ],
    },
    {
      heading: "3. What we collect and how long we keep it",
      paragraphs: [
        "3.1 Scan results. What: hand sizes such as hand length and width, which hand, the grip and palm thickness (thin, medium or thick) you chose yourself, and the rankings. Why: to work out and show the mice that suit you. Kept: without an account, deleted within 24 hours of the scan; with an account, kept in it until you delete the account, or deleted with the account after 90 days without use.",
        "3.2 The unnamed copy of the measurements (on by default; you can turn it off). What: hand length, palm length, palm width and finger lengths (rounded to 1 mm), which hand, the grip and palm thickness you chose yourself (left out if you chose none), the calibration method, the measuring version, and the month it was sent (in UTC). No photo, account, IP address or device information, and no field that leads back to the scan. Why: to make the measurements and rankings more accurate, and for statistics such as the spread of hand shapes, for our own research and for publication (see section 5). Kept: for as long as the service runs, and deleted when it closes; how to have it deleted is in section 6.",
        "3.3 Photos you chose to upload (not uploaded by default). What: a cropped photo of the back of the hand and the area around the paper or card (in card mode the detected card is blacked out on your device first, and file details such as where it was taken are removed), with what comes with it: the hand length and width measured this time (rounded to 1 mm), the right numbers you reported (if you entered them), why it was sent (a failed scan or wrong numbers) and the failure code, which hand, the paper or card type, the measuring version, the kind of device (phone, tablet or computer), whether it was taken with the camera or picked from the gallery, the photo's size, and the upload date. Why: to find and fix the causes of measuring errors. Kept: deleted automatically about 6 months (180 days) after upload; you can also delete it earlier at any time with its deletion code.",
        "3.4 Account (only if you sign in with Google). What: the name, email and picture Google provides, what sign-in needs, and when you last used the account. Why: so you can keep and see your results. Kept: until you delete your account, or automatically after 90 days without use.",
        "3.5 Questionnaire and result ratings (optional). Questionnaire: your experience with mice, satisfaction, what bothers you, main use, grip, the brand and size feel of mice not in our catalogue, and your comment; hand sizes are kept only in 5 mm groups. Result ratings: the stars and your comment, with a snapshot the server reads from the scan: hand-type class, grip, calibration method, palm thickness, the top three picks and their fit level, the engine version, and the page language. Why: to improve the rankings; questionnaire statistics are shown on the results page to other people with similar hands (see section 5). Answers and ratings sent while signed in are linked to your account, where you can see and change your questionnaire answers. Kept: what you send while signed in is deleted with your account; what you send without an account is kept for as long as the service runs, and deleted when it closes.",
        "3.6 Connection data. What: your IP address, kept only as a hash and only for a short time, for rate limiting and to prevent abuse; our hosting provider (Vercel) also keeps ordinary request logs. Why: to keep the site safe. Kept: the rate-limit hash for about 24 hours; the hosting logs per the provider's settings.",
        "3.7 Usage statistics and error reports. PostHog records page views, button and scan-step events, and a rough grade of photo quality (no measurements); it also receives device details such as the browser, operating system, screen size, language and time zone. It uses no cookies and keeps a random identifier only while the tab is open; your IP address is not passed to PostHog, and nothing on screen is recorded. Google Analytics loads only after you press “Accept” on the cookie banner; the way Google works, it receives your IP address and browser details. Sentry receives the error message and the browser type when something breaks, and performance traces for about 80% of page loads and requests (sample rate 0.8); emails, IP addresses, account details and measurements with units are removed first. Kept: per each provider's settings.",
        "3.8 Data testers' records (only for people who agree on the test page). We ask volunteer testers to type in their own tape-measure values and scan on a test page, to check how accurate the measurements are; anyone may take part, but nothing is recorded until they read the explanation on that page and agree (they must be 18 or over), and ordinary scans create no such records. What: the tester ID (when the page is open to anyone, a random ID your browser makes and keeps, for example WK7Q2M9XA — please screenshot or note it down; when it is limited to invited testers, the ID we gave them, for example P07, without the rest of the code), a random record number, the consent version, the date (the record holds no time; a photo file carries its upload time in storage, deleted with the photo), the hand length and palm width measured with a tape (two readings per measurer, an optional second measurer, and an optional edge-to-edge palm width), which hand, the phone model as typed, the surface, lighting, reference and card type, whether the shot was deliberately poor, camera or gallery, the number of attempts, failure codes, whether the tester gave up, and what the app measured with its measuring version and calibration method; also a cropped photo prepared the same way as in 3.3, and its size (testers agree to attach photos when they agree to take part, and can untick any shot's photo before that scan starts). The records hold no name, email, account or IP address (rate limiting is in 3.6), and no device information apart from the phone model typed in; the site-wide hosting logs and error reports (3.6, 3.7) still apply. The test page sends no PostHog events and no Google Analytics page views, and makes no unnamed copy (3.2). Why: only to improve how accurately we measure. Kept: photos are deleted automatically about 180 days after upload; the numbers until we delete them or the tester asks us to. For analysis the data may be exported to the project lead's computer; that copy loses photos older than 180 days each time the data is sorted, and is deleted too when the tester asks.",
      ],
    },
    {
      heading: "4. Where the data is kept and who processes it",
      paragraphs: [
        "These providers process data on our behalf; under Article 4 of the PDPA they act for us. Data is stored or moved outside Taiwan, in the regions each provider's settings use.",
        "Vercel: website hosting and photo storage.",
        "Neon: database.",
        "Google: sign-in, Google Analytics, and Gemini (which receives only the measurements, the grip and the rankings, to write the explanation; never the photo, your name or your account).",
        "PostHog: usage statistics; United States.",
        "Sentry: error reports.",
        "Only one person, the project lead, has admin access to the website's hosting and can see uploaded photos.",
      ],
    },
    {
      heading: "5. Sharing and statistics",
      paragraphs: [
        "We do not sell personal data. Apart from the providers in section 4, we do not give individual records to brands or any other third party.",
        "On the site: “How people with a similar hand size rated these” on the results page appears only when at least 5 people's questionnaire answers are behind it. With so few people, someone who knows the other answers could still work out one person's answer; please keep that in mind.",
        "Outside the site (for example research reports or talks with brands): only aggregate statistics, and no group of fewer than 10 people is published.",
        "New uses: before using data for a purpose not written here, we will update this notice and ask for your consent separately; data collected before then is not simply reused.",
      ],
    },
    {
      heading: "6. Your rights and how to use them",
      paragraphs: [
        "Under Article 3 of the PDPA you can, for the personal data we hold about you, ask to look it up or see it, get a copy, add to or correct it, have us stop collecting, processing or using it, and have it deleted.",
        "Signed-in account: on the Account page you can see your scans, your profile and your questionnaire answers, and download your scans (JSON); for a copy of anything else, write to us. You can also delete your account there, with everything under it (scans, questionnaire, result ratings), in one step.",
        "The unnamed copy: it holds no account or scan number, and we do not match it against your scans on our own. When you delete a scan or your whole account, we also delete the copy whose values match. While your scan is still kept, you can also write to us to look up or delete its copy. Once the scan is deleted (scans without an account are deleted automatically within 24 hours), nothing links the copy back to you, and we can no longer find or delete it. If you don't want a copy, turn the switch off before you send.",
        "Photos you chose to upload: a photo is not stored in your account, and deleting the account does not delete it. Delete it with the deletion code shown after the upload, under “Delete a photo I sent” further down this page. If you lost the code, write to us with the upload date and the numbers you reported or the failure screen; we will find and delete it. If we can't tell which photo it is, we will write back to explain; the photo is also deleted automatically after 180 days.",
        "Questionnaire answers and ratings sent without an account: they hold no account and do not lead back to your scans. Please don't write your name, contact details or other personal data in a comment; if you did, write to us with the date and roughly what it said, and we will do our best to find and delete it.",
        "Data testers' records: write to palmate.tw@gmail.com with your tester ID (for example P07 or WK7Q2M9XA, shown in the test page's explanation), and we will delete every record and photo under that ID, including the copy on the project lead's computer. We have no link between a random ID and you (the records hold no name or contact details) and cannot look it up for you; if you lose it (for example after clearing browsing data or switching browsers), we cannot tell which records are yours and may not be able to delete them. You can send the dates you took part and your tape values, and we will try to match them, but cannot promise to find them.",
        "Other requests: write to palmate.tw@gmail.com. To look up, see or get a copy of your data, we reply within 15 days whether we agree; to add, correct, stop collection, processing or use, or delete, we reply within 30 days. If needed we may extend this once, by no more than the original period, and will write to tell you why.",
        "If you don't provide data: the hand measurements are needed to compute a ranking, so without them there is none. Signing in, the unnamed copy, uploading a photo, the questionnaire, ratings and Google Analytics are all optional, and scanning and the rankings work fully without them; without an account the results are just kept for 24 hours only.",
      ],
    },
    {
      heading: "7. Why the unnamed copy is kept by default",
      paragraphs: [
        "Before you send a scan, a short note sits next to the switch; its “Details” button shows what the copy holds, what it is for, how long it is kept and how it is deleted, with a link to this notice.",
        "Under Article 7(3) of the PDPA, sending the scan after seeing that text without turning the switch off counts as consent to keep the copy.",
        "The full text of every version of that note is kept in our code version history, so what you saw can be checked.",
      ],
    },
    {
      heading: "8. How we protect data",
      paragraphs: [
        "By default photos are processed only on your device. Uploaded photos are kept in private storage under random file names.",
        "Deletion codes are kept only as a hash that cannot be turned back into the code.",
        "Connections between the site and its providers are encrypted (HTTPS).",
        "Error reports and usage statistics contain no emails or accounts; measurements with units are removed from error reports, usage statistics record no measurements, and the browser type is kept.",
        "If data is stolen, altered, damaged, lost or leaked, we will email everyone with a signed-in account promptly, and post a notice on the site for people we cannot reach individually (such as people without an account). The notice says what happened, which data is affected, and what we have done.",
      ],
    },
    {
      heading: "9. Minors",
      paragraphs: [
        "We don't ask for your age. If you are under 18, please read this notice with a parent or guardian before using the service, and get their consent before you upload a photo.",
      ],
    },
    {
      heading: "10. Cookies and browser storage",
      paragraphs: [
        "The site uses cookies it needs to work: the scan session when you are not signed in (scan_session), your sign-in, and the page language you chose (om_locale).",
        "The site also keeps a few settings and records in your browser, on this device only: your cookie choice, whether you turned off the unnamed-copy switch (palmate.handSample.optOut), the paper or card you chose, whether you have seen the first-run tip and the tour, a log of your recent scan attempts (on this device only, for the debug panel), your recent results and small notes for the results page, and whether you have already answered the questionnaire or rated a result; on the test page when it is open to anyone, the random tester ID your browser makes (created when the page opens, sent only after you agree), or, when it is limited to invited testers, the tester code you typed (kept in that tab only, cleared when you close it); PostHog keeps a random identifier only while the tab is open.",
        "None of these cookies or stored items is used to track you across sites.",
        "Google Analytics cookies are used only after you press “Accept”; the site works fully if you don't.",
        "You can change your choice at any time with “Cookie settings” in the footer.",
      ],
    },
    {
      heading: "11. Changes to this notice",
      paragraphs: [
        "If this notice changes in a way that matters, we update the date on this page and say so on the site. A new way of collecting data applies only to data collected after that notice.",
      ],
    },
    {
      heading: "12. Contact",
      paragraphs: ["palmate.tw@gmail.com"],
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
