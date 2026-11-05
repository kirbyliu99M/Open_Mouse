/**
 * The scan page's spotlight tour (v3.4, Toutour method; Pencil section 14c,
 * exports in scan-tutorial-2026-11-04/v3/). Used by
 * `src/client/camera/tour/ScanTour.tsx`.
 *
 * zh-TW: the paper steps are the wording Kirby OK'd on 2026-11-05 ("這個版本
 * 可以"). The card steps, the A4/Letter wording of the three-way choice and
 * the paper-only welcome row are CANDIDATES (未拍板). Every English string is
 * a CANDIDATE (Claude's translation; English copy is an open item of the
 * design, ⑦ in the memory note).
 *
 * No medical claim anywhere: the tour only says where things go on screen.
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

export interface ScanTourCopy {
  welcomeTitle: string;
  /** `steps` is the number of steps this tour will show (computed). */
  welcomeLead: (steps: string) => string;
  welcomeRowPlaceWithCard: string;
  welcomeRowPlacePaperOnly: string;
  welcomeRowCue: string;
  welcomeRowAuto: string;
  welcomeFirst: string;
  welcomeReturning: string;
  welcomeFinePrint: string;
  /** "1／4"; both numbers come from the step list. */
  counter: (n: string, total: string) => string;
  /** The prefix of the counter in card mode: "卡片 · 1／4". */
  counterCardPrefix: string;
  skip: string;
  back: string;
  next: string;
  start: string;
  /** Step 1 without card mode: an A4/Letter choice inside the card. */
  paperSizeTitle: string;
  paperSizeBody: string;
  paperSizeNoPaper: string;
  /** Step 1 with card mode: a three-way choice inside the card. */
  referenceTitle: string;
  referenceGroupLabel: string;
  referenceA4: string;
  referenceLetter: string;
  referenceCard: string;
  referenceBodyPaper: string;
  referenceBodyCard: string;
  placePaperTitle: string;
  placePaperBody: string;
  placePaperWristLabel: string;
  placeCardTitle: string;
  placeCardBody: string;
  placeCardCentreLabel: string;
  placeCardHandLabel: string;
  /** The same label when the hand chip says left (mirrored). */
  placeCardHandLabelLeft: string;
  cueTitle: string;
  /** `perfect` is the cue line shown when everything lines up. */
  cueBody: (perfect: string) => string;
  cuePerfectPaper: string;
  cuePerfectCard: string;
  shutterTitle: string;
  shutterBodyPaper: string;
  shutterBodyCard: string;
  shutterHelpAgain: string;
  /** The accessible name of the dialog. */
  dialogLabel: string;
}

export const zhTW: ScanTourCopy = {
  welcomeTitle: "第一次掃描嗎？",
  welcomeLead: (steps) => `開始前，用 ${steps} 步直接在掃描畫面上指給你看。`,
  welcomeRowPlaceWithCard: "怎麼擺：手和紙，或手和卡片",
  welcomeRowPlacePaperOnly: "怎麼擺：手和紙",
  welcomeRowCue: "畫面上的提示在哪裡、怎麼看",
  welcomeRowAuto: "對好之後會自動拍照",
  welcomeFirst: "第一次，教我怎麼拍",
  welcomeReturning: "不是第一次，直接掃描",
  welcomeFinePrint:
    "之後可以按右上角「?」再看一次。你的照片不會離開手機，只會傳送測量數值。",
  counter: (n, total) => `${n}／${total}`,
  counterCardPrefix: "卡片 · ",
  skip: "略過教學",
  back: "上一步",
  next: "下一步",
  start: "開始掃描",
  paperSizeTitle: "先確認紙張大小",
  paperSizeBody: "預設是 A4。用 Letter 紙的話，在這裡切換。",
  paperSizeNoPaper: "沒有紙？最下面可以改用尺量手長。",
  referenceTitle: "你用什麼對照？",
  referenceGroupLabel: "對照物",
  referenceA4: "A4",
  referenceLetter: "Letter",
  referenceCard: "卡片",
  referenceBodyPaper: "用一張空白的影印紙，放在深色桌面上。",
  referenceBodyCard:
    // Review G8 (candidate): the same rule as the live card line.
    "用悠遊卡、一卡通這類標準大小的淺色或亮面卡片，背面朝上放；證件、信用卡有個資不要用，名片大小不對。",
  placePaperTitle: "紙放在框裡，手放在紙上",
  placePaperBody:
    "空白紙放平在深色桌面。手背朝上、手指伸直併攏，整隻手都在紙內。",
  placePaperWristLabel: "手腕貼齊這條邊",
  placeCardTitle: "手和卡片這樣放",
  placeCardBody:
    // Kirby 2026-11-05: the card posture matches A4 (fingers straight and together).
    "手背朝上貼平桌面，手指伸直併攏；中指大約對準中線，前臂從畫面下方伸出去。卡片直放在小指旁的虛線框裡，平放在桌上，不要拿著。",
  placeCardCentreLabel: "卡片中心對齊指根",
  placeCardHandLabel: "示範右手｜量左手時卡片放左邊",
  placeCardHandLabelLeft: "示範左手｜量右手時卡片放右邊",
  cueTitle: "照這行字調整",
  cueBody: (perfect) =>
    `它會告訴你手或手機往哪移；出現「${perfect}」就是對好了。`,
  cuePerfectPaper: "很好，請拿穩",
  cuePerfectCard: "就是這樣，保持不動",
  shutterTitle: "對好就會自動拍照",
  shutterBodyPaper: "四個角都打勾、外圈跑滿，就會自動拍；也可以自己按。",
  shutterBodyCard: "手和卡片都對好後會自動拍；也可以自己按。",
  shutterHelpAgain: "之後忘了，按右上角「?」再看一次。",
  dialogLabel: "掃描教學",
};

export const en: ScanTourCopy = {
  welcomeTitle: "First time scanning?",
  welcomeLead: (steps) =>
    `Before you start, ${steps} quick steps point things out right on the scan screen.`,
  welcomeRowPlaceWithCard: "Where things go: hand and paper, or hand and card",
  welcomeRowPlacePaperOnly: "Where things go: hand and paper",
  welcomeRowCue: "Where the on-screen hint is and how to read it",
  welcomeRowAuto: "The photo is taken by itself once everything lines up",
  welcomeFirst: "First time, show me",
  welcomeReturning: "Not my first time, start scanning",
  welcomeFinePrint:
    "Tap “?” at the top right to see this again. Your photo never leaves your phone; only the measurements are sent.",
  counter: (n, total) => `${n} / ${total}`,
  counterCardPrefix: "Card · ",
  skip: "Skip tour",
  back: "Back",
  next: "Next",
  start: "Start scanning",
  paperSizeTitle: "Check the paper size",
  paperSizeBody: "It's A4 by default. Using Letter paper? Switch it here.",
  paperSizeNoPaper: "No paper? At the bottom you can measure with a ruler.",
  referenceTitle: "What are you measuring against?",
  referenceGroupLabel: "Reference",
  referenceA4: "A4",
  referenceLetter: "Letter",
  referenceCard: "Card",
  referenceBodyPaper: "Use a blank sheet of printer paper on a dark table.",
  referenceBodyCard:
    "Use a light or glossy standard-size card such as a transit card, back side up. Don't use an ID or a credit card (personal details); business cards are the wrong size.",
  placePaperTitle: "Paper in the frame, hand on the paper",
  placePaperBody:
    "Lay blank paper flat on a dark table. Back of the hand up, fingers straight and together, the whole hand on the paper.",
  placePaperWristLabel: "Wrist along this edge",
  placeCardTitle: "Place your hand and the card like this",
  placeCardBody:
    "Back of the hand flat on the table, fingers straight and together; middle finger roughly on the centre line, forearm out past the bottom of the screen. Card upright in the dashed box beside your little finger, flat on the table, not held.",
  placeCardCentreLabel: "Card centre level with the finger roots",
  placeCardHandLabel: "Right hand shown | for the left hand, card on the left",
  placeCardHandLabelLeft:
    "Left hand shown | for the right hand, card on the right",
  cueTitle: "Follow this line",
  cueBody: (perfect) =>
    `It tells you which way to move your hand or phone; “${perfect}” means you're lined up.`,
  cuePerfectPaper: "Perfect — hold still",
  cuePerfectCard: "That's it, hold still",
  shutterTitle: "Lined up, the photo takes itself",
  shutterBodyPaper:
    "Once all four corners are ticked and the ring fills, it shoots by itself; you can also tap.",
  shutterBodyCard:
    "Once your hand and the card line up, it shoots by itself; you can also tap.",
  shutterHelpAgain: "Forgot something later? Tap “?” at the top right.",
  dialogLabel: "Scan tour",
};

export function scanTourCopy(locale: Locale): ScanTourCopy {
  return pickCopy(locale, { zhTW, en });
}
