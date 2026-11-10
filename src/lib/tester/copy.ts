/**
 * Words of the hidden data-tester page `/scan/tester` (contract
 * src/lib/contracts/tester.ts; spec
 * docs/design/touchpoint-2026-11-08/tester-page-spec.md). zh-TW only: the
 * page is for people in Taiwan (open to anyone since Kirby 2026-11-10), so it lives here and not in
 * src/lib/copy/ (whose modules must carry zhTW and en tables).
 *
 * EVERY string here is a CANDIDATE (未拍板), written by the builder from the
 * spec, until Kirby has read them on a phone. The consent text is
 * `TESTER_CONSENT_VERSION` ("tester-consent-v2-draft"); changing what it says
 * means a new version in the contract. No medical wording.
 */
import {
  TESTER_CARD_TYPES,
  TESTER_LIGHTING,
  TESTER_PHOTO_RETENTION_DAYS,
  TESTER_REFERENCES,
  TESTER_SURFACES,
} from "../contracts/tester";

/** Where a tester asks for deletion (spec, step 2). */
export const TESTER_CONTACT_EMAIL = "palmate.tw@gmail.com";

export const testerCopy = {
  metaTitle: "資料測試者",
  heading: "資料測試者",
  stepOf: (n: number, total: number) => `第 ${n} 步，共 ${total} 步`,
  back: "上一步",
  leaveWarning: "離開這頁的話，填好的卷尺數值會不見。",

  code: {
    intro: "請輸入 Kirby 給你的測試者代碼。",
    label: "測試者代碼",
    placeholder: "例如 P07-K7Q2M9",
    submit: "下一步",
    checking: "確認中…",
    invalid: "代碼不對，請再確認一次。",
    tooMany: "嘗試太多次了，請過一小時再試。",
    network: "連不上伺服器，請確認網路後再試一次。",
    participant: (p: string) => `你的代號是 ${p}`,
    /** Open mode: the id is made by this browser, so say how to keep it. */
    anonParticipant: (p: string) =>
      `你的代號是 ${p}。這是這支手機的瀏覽器隨機產生的，要求刪除資料時需要用到，請截圖或抄下來。`,
  },

  consent: {
    title: "參加前請先看這裡",
    points: [
      "我們會記下：你用卷尺量的手長和掌寬、每張照片的拍攝條件（手機型號、桌面、光線、參考物）、掃描的過程（嘗試幾次、失敗原因）和 App 量到的數值。",
      "資料庫紀錄上只有你的代號和日期，不含時間（照片檔在儲存空間會有上傳時間，到期時一起刪除）；不會記下你的姓名、Email 或帳號。為了防止有人濫用，伺服器會短暫保存經過雜湊處理的 IP（不是原始 IP），大約一天內自動清除。",
      "這些資料只用在一件事：改善 Palmate 量手的準確度。",
      "請只拍你自己的手。參加需要年滿 18 歲。",
      `參加測試就表示你同意每一張都附上處理過的照片：手機會先把照片裁到手和參考物附近的範圍、去掉拍攝資訊（EXIF），再上傳到不公開的儲存空間；用卡片時會把卡片塗黑，用紙張時請先移開其他卡片和文件。每一張在開始掃描前都可以取消勾選，不附照片（掃描完成會直接送出）。照片 ${TESTER_PHOTO_RETENTION_DAYS} 天後自動刪除。`,
      `為了分析，資料可能會匯出到專案負責人的電腦。電腦上的副本會在每次整理資料時刪除超過 ${TESTER_PHOTO_RETENTION_DAYS} 天的照片；你要求刪除時也會一起刪除。`,
      `數值會保留到我們刪除，或你要求刪除為止。要刪除，請寄信到 ${TESTER_CONTACT_EMAIL}，附上你的代號，我們會刪掉這個代號的所有紀錄和照片（包括電腦上的副本）。`,
    ],
    agree: "我已年滿 18 歲，看過並同意以上說明，包括每一張附上處理過的照片",
    next: "開始",
  },

  tape: {
    title: "卷尺實測",
    intro:
      "同一位受試者量一次就好，之後每張照片都會沿用，隨時可以回來修改。單位是公釐（mm），最多一位小數。",
    hand: "量的是哪一隻手",
    left: "左手",
    right: "右手",
    handLength: "手長",
    handLengthHelp: "從手腕橫紋（最靠近手掌的那一條）量到中指指尖。",
    palmWidth: "掌寬（指根下方）",
    palmWidthHelp: "從食指指根量到小指指根，量在指根下方。",
    palmWidthEdge: "手掌寬（邊到邊，選填）",
    palmWidthEdgeHelp: "手掌最寬的地方，從一邊量到另一邊，量測者 A 量一次。",
    measurerA: "量測者 A（必填）",
    measurerB: "量測者 B（選填）",
    measurerAOnce: "量測者 A，量一次",
    first: "第一次",
    second: "第二次",
    mm: "mm",
    recheck: "兩次相差超過 3 mm，請再量一次（還是可以送出）。",
    invalid: "請填 50 到 300 之間的數字，最多一位小數。",
    required: "這一格必填。",
    pairIncomplete: "量測者 B 請兩次都填，或兩次都留空。",
    handRequired: "請選左手或右手。",
    figureAlt: "",
    next: "下一步",
  },

  conditions: {
    title: "這張照片的條件",
    phoneModel: "手機型號",
    phoneModelHelp: "例如 iPhone 15、Pixel 8，最多 40 字。不要填姓名。",
    phoneModelInvalid:
      "請填手機型號，最多 40 字，不要填 Email、電話號碼或網址。",
    surface: "桌面",
    surfaces: {
      white: "白色素面",
      wood: "木紋",
      dark: "深色",
      patterned: "有花紋",
      other: "其他",
    } satisfies Record<(typeof TESTER_SURFACES)[number], string>,
    lighting: "光線",
    lightings: {
      daylight: "自然光",
      "indoor-warm": "室內燈（偏黃）",
      dim: "偏暗",
    } satisfies Record<(typeof TESTER_LIGHTING)[number], string>,
    reference: "參考物",
    references: {
      a4: "A4 紙",
      letter: "Letter 紙",
      card: "卡片",
    } satisfies Record<(typeof TESTER_REFERENCES)[number], string>,
    cardType: "卡片種類",
    cardTypes: {
      transit: "悠遊卡或一卡通",
      "bank-back-covered": "金融卡（背面朝上，卡號遮住）",
      "id-size-other": "其他和證件一樣大的卡",
    } satisfies Record<(typeof TESTER_CARD_TYPES)[number], string>,
    chooseOne: "請選一個。",
    deliberatelyPoor: "這張是故意拍得不理想的（例如偏暗、歪斜）",
    photo: "這張附上處理過的照片",
    photoOn: `會上傳處理過的照片，${TESTER_PHOTO_RETENTION_DAYS} 天後刪除。`,
    photoOff: "照片留在手機上，其他紀錄照常送出。",
    referenceReminder: "掃描畫面會直接用這個參考物，請放好再開始。",
    handReminder: (hand: string) =>
      `掃描時請確認相機上的手別和卷尺填的一樣（${hand}）。`,
    start: "開始掃描",
    editTape: "修改卷尺實測",
  },

  scan: {
    giveUp: "這次放棄",
    /** In place of "photos stay on the phone" when the photo box is ticked. */
    photoNotice: `這張會附上處理過的照片，${TESTER_PHOTO_RETENTION_DAYS} 天後刪除。`,
    /** In place of the camera's privacy line when the photo box is not ticked. */
    noPhotoNotice:
      "照片留在手機上。會送出你填的卷尺值和拍攝條件、掃描過程（嘗試次數、失敗原因）和 App 的量測結果。",
  },

  giveUp: {
    title: "放棄這一張？",
    body: "會送出：這張的嘗試次數、失敗原因、卷尺數值和拍攝條件。不會送出照片，也不會送出 App 量到的數值。",
    confirm: "送出放棄紀錄",
    back: "回到掃描",
  },

  result: {
    title: "這張的結果",
    gaveUpTitle: "已放棄這一張",
    app: "App 量到",
    tape: "卷尺平均",
    diff: "差距",
    item: "項目",
    handLength: "手長",
    palmWidth: "掌寬",
    mmValue: (v: string) => `${v} mm`,
    sending: "送出中…",
    preparing: "正在處理照片…",
    sent: "已送出",
    gaveUpSent: "已送出放棄紀錄",
    noPhoto: "這張照片沒辦法處理，所以沒有附上照片，其他紀錄照常送出。",
    failed: "送出失敗了。",
    failedTooMany: "送出太多次了，請過一小時再試。",
    failedInvalid: "這筆資料有問題，送不出去。請改一下拍攝條件再拍一次。",
    handMismatch:
      "掃描到的手和卷尺填的不是同一隻，所以這張沒有送出。請點相機畫面上方的手別切換成正確的那隻手，再拍一次。",
    referenceMismatch:
      "掃描用的參考物和你選的不一樣，所以這張沒有送出。請再拍一次。",
    failedCode: "測試者代碼已失效，請重新輸入。",
    /** Open mode: the server no longer takes shots (the page was closed). */
    failedClosed: "測試頁目前沒有開放，這張沒有送出。",
    failedUnavailable: "照片儲存暫時不能用。",
    sendWithoutPhoto: "不附照片送出",
    retry: "再試一次",
    next: "拍下一張",
    retake: "再拍一次",
    reenterCode: "重新輸入代碼",
  },
} as const;

export type TesterCopy = typeof testerCopy;
