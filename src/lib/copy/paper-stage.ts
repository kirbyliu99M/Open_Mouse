/**
 * Scan S2 (V3.2, 2026-10-21): the words for WHERE the paper detector stopped
 * (`src/client/paper/detectionStage.ts`), zh-TW and English, same keys.
 *
 * A stage is a step of the algorithm, not a proven cause, so every line says
 * what MAY be wrong ("可能", "may") and one thing to try. `live` is the short
 * cue line over the camera preview (about 14 full-width characters, like
 * `camera-cues.ts`); `retake` is the sentence on the retake screen after a
 * photo, and is also the English `message` the photo pipeline builds, so the
 * attempt log and the screen read the same English words.
 *
 * `exception` and `unknown` say nothing more specific than the plain
 * "couldn't find the paper" lines: there is no step to name. Their live lines
 * are not shown today (the preview keeps its own "point the camera" cues for
 * them, `src/client/camera/cues.ts`), but are here so every stage has words.
 *
 * Every string, in both languages, is a CANDIDATE (未拍板), Claude's wording,
 * until Kirby has read it. No health or medical claim.
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

export interface PaperStageLines {
  /** The live cue line. */
  live: string;
  /** The retake sentence after a photo. */
  retake: string;
}

export interface PaperStageCopy {
  noBrightRegion: PaperStageLines;
  regionSplit: PaperStageLines;
  aspectMismatch: PaperStageLines;
  tooSmall: PaperStageLines;
  exception: PaperStageLines;
  unknown: PaperStageLines;
}

export const zhTW: PaperStageCopy = {
  noBrightRegion: {
    live: "可能太暗，紙看起來不夠白",
    retake:
      "找不到紙張。可能是燈光太暗，紙看起來不夠白。請開燈或移到較亮的地方，然後重拍。",
  },
  regionSplit: {
    live: "紙好像被切成兩塊，手可能擋住中間",
    retake:
      "找不到完整的紙張。紙好像被切成兩塊，可能是手或手臂擋住了中間。請讓手只放在紙上、不要橫跨紙面，然後重拍。",
  },
  aspectMismatch: {
    live: "可能沒拍到整張紙",
    retake:
      "找到的形狀不像整張紙。可能沒拍到整張紙，或選的紙張大小不對。請讓整張紙入鏡，並確認選的是 A4 或 Letter，然後重拍。",
  },
  tooSmall: {
    live: "紙在畫面裡可能太小，靠近一點",
    retake:
      "紙在畫面裡可能太小。請把手機靠近一點，讓紙佔滿大部分畫面，然後重拍。",
  },
  exception: {
    live: "請把相機對準紙張",
    retake: "找紙張時出了點問題，請再試一次。",
  },
  unknown: {
    live: "請把相機對準紙張",
    retake:
      "照片裡找不到紙張。請把空白 A4（或 Letter）紙平放在單色、對比明顯的桌面上，然後重拍。",
  },
};

export const en: PaperStageCopy = {
  noBrightRegion: {
    live: "May be too dark: the paper doesn't look white",
    retake:
      "We couldn't find the paper. The light may be too dim, so the sheet doesn't look white enough. Turn on a light or move somewhere brighter, then retake.",
  },
  regionSplit: {
    live: "The paper may be cut in two: is a hand across it?",
    retake:
      "We couldn't find the whole sheet. It may be cut in two: your hand or arm may be crossing the middle. Keep your hand on the paper without reaching across it, then retake.",
  },
  aspectMismatch: {
    live: "The whole sheet may not be in view",
    retake:
      "The shape we found doesn't look like a whole sheet. The whole sheet may not be in the photo, or the paper size may be wrong. Get the whole sheet in view and check A4 or Letter, then retake.",
  },
  tooSmall: {
    live: "The paper may be too small: move closer",
    retake:
      "The paper may be too small in the photo. Move the phone closer so the sheet fills most of the picture, then retake.",
  },
  exception: {
    live: "Point the camera at the paper",
    retake: "Something went wrong while looking for the paper. Try again.",
  },
  unknown: {
    live: "Point the camera at the paper",
    retake:
      "We couldn't find a sheet of paper in this photo — place a blank A4 (or Letter) sheet flat on a plain, contrasting surface and retake.",
  },
};

export function paperStageCopy(locale: Locale): PaperStageCopy {
  return pickCopy(locale, { zhTW, en });
}
