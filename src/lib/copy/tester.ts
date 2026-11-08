/**
 * Words of the hidden data-tester page `/scan/tester` (contract
 * src/lib/contracts/tester.ts; spec
 * docs/design/touchpoint-2026-11-08/tester-page-spec.md). zh-TW only: the
 * page is for people Kirby invites in Taiwan.
 *
 * EVERY string here is a CANDIDATE (未拍板), written by the builder from the
 * spec, until Kirby has read them on a phone. The consent text is
 * `TESTER_CONSENT_VERSION` ("tester-consent-v1-draft"); changing what it says
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
  },

  consent: {
    title: "參加前請先看這裡",
    points: [
      "我們會記下：你用卷尺量的手長和掌寬、每張照片的拍攝條件（手機型號、桌面、光線、參考物）、掃描的過程（嘗試幾次、失敗原因）和 App 量到的數值。",
      "不會記下你的姓名、Email、IP 或帳號。紀錄上只有你的代號（例如 P07）和日期，不含時間。",
      "這些資料只用在一件事：改善 Palmate 量手的準確度。",
      `如果你同意附上照片，手機會先把照片裁到只剩手和參考物、把卡片塗黑、去掉拍攝資訊（EXIF），再上傳到不公開的儲存空間。照片 ${TESTER_PHOTO_RETENTION_DAYS} 天後自動刪除。`,
      `數值會保留到我們刪除，或你要求刪除為止。要刪除，請寄信到 ${TESTER_CONTACT_EMAIL}，附上你的代號，我們會刪掉這個代號的所有紀錄和照片。`,
    ],
    agree: "我看過並同意以上說明",
    photo: "附上處理過的照片",
    photoHint: "取消勾選的話，只會送出數值。",
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
    phoneModelHelp: "例如 iPhone 15、Pixel 8，最多 40 字。",
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
    referenceReminder: "掃描畫面上請選同一種參考物。",
    start: "開始掃描",
    editTape: "修改卷尺實測",
  },

  scan: {
    giveUp: "這次放棄",
  },

  giveUp: {
    title: "放棄這一張？",
    body: "只會送出這次的嘗試次數和失敗原因，不會送出照片。",
    confirm: "送出放棄紀錄",
    back: "回到掃描",
  },

  result: {
    title: "這張的結果",
    app: "App 量到",
    tape: "卷尺平均",
    diff: "差距",
    handLength: "手長",
    palmWidth: "掌寬",
    mmValue: (v: string) => `${v} mm`,
    sending: "送出中…",
    preparing: "正在處理照片…",
    sent: "已送出",
    gaveUpSent: "已送出放棄紀錄",
    noPhoto: "這張照片沒辦法處理，所以只送出數值。",
    failed: "送出失敗了。",
    failedTooMany: "送出太多次了，請過一小時再試。",
    failedInvalid: "這筆資料有問題，送不出去。請回到上一步檢查後重拍。",
    failedCode: "測試者代碼已失效，請重新輸入。",
    failedUnavailable: "照片儲存暫時不能用。",
    sendWithoutPhoto: "只送出數值",
    retry: "再試一次",
    next: "拍下一張",
    reenterCode: "重新輸入代碼",
  },
} as const;

export type TesterCopy = typeof testerCopy;
