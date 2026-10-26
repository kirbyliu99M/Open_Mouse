/**
 * The camera's live words: the one cue line, the hint under the viewfinder and
 * the three status chips (`src/client/camera/cues.ts`), zh-TW and English,
 * same keys. English is moved verbatim from the code; unit tests and e2e
 * specs pin it.
 *
 * Every zh-TW string is a CANDIDATE (未拍板), Claude's Taiwan wording, until
 * Kirby has read it. Cue lines sit over the live picture on a 320 px wide
 * screen, so they are kept to one short line (about 14 full-width
 * characters). The printed-sheet flow (`/scan`) says 校正表 where the easy
 * scan says 紙張.
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

export interface CameraCuesCopy {
  /** The cue line per cue code, for a blank sheet of paper (the easy scan). */
  paper: {
    placePaper: string;
    noCorners: string;
    someCorners: string;
    tilted: string;
    edgeCovered: string;
    edgeCoveredTop: string;
    edgeCoveredBottom: string;
    edgeCoveredLeft: string;
    edgeCoveredRight: string;
    paperCurled: string;
    tooFar: string;
    tooClose: string;
    dark: string;
    bright: string;
    holdStill: string;
    outOfFocus: string;
    perfect: string;
  };
  /** The same lines for the printed calibration sheet (`/scan`). */
  sheet: {
    placePaper: string;
    noCorners: string;
    someCorners: string;
    tilted: string;
    edgeCovered: string;
    edgeCoveredTop: string;
    edgeCoveredBottom: string;
    edgeCoveredLeft: string;
    edgeCoveredRight: string;
    paperCurled: string;
    tooFar: string;
    tooClose: string;
    dark: string;
    bright: string;
    holdStill: string;
    outOfFocus: string;
    perfect: string;
  };
  /** The easy scan's "perfect" line. */
  gotIt: string;
  /** The cue while out of focus, where a tap can set the focus. */
  tapToFocus: string;
  /** The hint under the viewfinder while the ring fills. */
  holdStillTakingPhoto: string;
  /** No cue yet, on the paper / on the printed sheet. */
  pointAtPaper: string;
  pointAtSheet: string;
  /** Typed hand length: no paper to find, so one fixed cue and announcement. */
  handFlat: string;
  /** Status chips. `n` of the 4 corners found. */
  paperChip: (n: number) => string;
  sheetChip: (n: number) => string;
  steadyChip: string;
  lightChip: string;
}

export const zhTW: CameraCuesCopy = {
  paper: {
    placePaper: "請把空白紙放在較深色的桌面上",
    noCorners: "請把相機對準紙張",
    someCorners: "請再退後一點，讓紙張四角都入鏡",
    tilted: "請讓手機與紙張平行",
    edgeCovered: "紙邊被擋住，請把手往內移",
    edgeCoveredTop: "紙的上緣被擋住，請把手往內移",
    edgeCoveredBottom: "紙的下緣被擋住，請把手往內移",
    edgeCoveredLeft: "紙的左緣被擋住，請把手往內移",
    edgeCoveredRight: "紙的右緣被擋住，請把手往內移",
    paperCurled: "請把紙壓平",
    tooFar: "請再靠近一點",
    tooClose: "請再退後一點",
    dark: "光線不足，請補光",
    bright: "太亮了，請避開反光",
    holdStill: "請拿穩",
    outOfFocus: "等待畫面對焦清晰",
    perfect: "很好，請拿穩",
  },
  sheet: {
    placePaper: "請把校正表放在較深色的桌面上",
    noCorners: "請把相機對準校正表",
    someCorners: "請再退後一點，讓校正表四角都入鏡",
    tilted: "請讓手機與校正表平行",
    edgeCovered: "校正表邊被擋住，請把手往內移",
    edgeCoveredTop: "校正表的上緣被擋住，請把手往內移",
    edgeCoveredBottom: "校正表的下緣被擋住，請把手往內移",
    edgeCoveredLeft: "校正表的左緣被擋住，請把手往內移",
    edgeCoveredRight: "校正表的右緣被擋住，請把手往內移",
    paperCurled: "請把校正表壓平",
    tooFar: "請再靠近一點",
    tooClose: "請再退後一點",
    dark: "光線不足，請補光",
    bright: "太亮了，請避開反光",
    holdStill: "請拿穩",
    outOfFocus: "等待畫面對焦清晰",
    perfect: "很好，請拿穩",
  },
  gotIt: "已對準，請拿穩",
  tapToFocus: "點一下紙張來對焦",
  holdStillTakingPhoto: "請拿穩，即將拍照",
  pointAtPaper: "請把相機對準紙張",
  pointAtSheet: "請把相機對準校正表",
  handFlat: "手攤平、手指併攏，手機在正上方",
  paperChip: (n) => `紙張 ${n}/4`,
  sheetChip: (n) => `校正表 ${n}/4`,
  steadyChip: "穩定",
  lightChip: "光線",
};

export const en: CameraCuesCopy = {
  paper: {
    placePaper: "Place a blank sheet of paper on a darker surface",
    noCorners: "Point the camera at the paper",
    someCorners: "Move back so all four paper corners are in view",
    tilted: "Hold the phone flat above the paper",
    edgeCovered: "An edge is covered. Move your hand in.",
    edgeCoveredTop: "The top edge is covered. Move your hand in.",
    edgeCoveredBottom: "The bottom edge is covered. Move your hand in.",
    edgeCoveredLeft: "The left edge is covered. Move your hand in.",
    edgeCoveredRight: "The right edge is covered. Move your hand in.",
    paperCurled: "Smooth the paper down.",
    tooFar: "Move closer",
    tooClose: "Move back a little",
    dark: "More light, please",
    bright: "Too bright — avoid glare",
    holdStill: "Hold still",
    outOfFocus: "Waiting for a sharp picture",
    perfect: "Perfect — hold still",
  },
  sheet: {
    placePaper: "Place a blank sheet of sheet on a darker surface",
    noCorners: "Point the camera at the sheet",
    someCorners: "Move back so all four sheet corners are in view",
    tilted: "Hold the phone flat above the sheet",
    edgeCovered: "An edge is covered. Move your hand in.",
    edgeCoveredTop: "The top edge is covered. Move your hand in.",
    edgeCoveredBottom: "The bottom edge is covered. Move your hand in.",
    edgeCoveredLeft: "The left edge is covered. Move your hand in.",
    edgeCoveredRight: "The right edge is covered. Move your hand in.",
    paperCurled: "Smooth the sheet down.",
    tooFar: "Move closer",
    tooClose: "Move back a little",
    dark: "More light, please",
    bright: "Too bright — avoid glare",
    holdStill: "Hold still",
    outOfFocus: "Waiting for a sharp picture",
    perfect: "Perfect — hold still",
  },
  gotIt: "Got it — hold still",
  tapToFocus: "Tap the paper to focus",
  holdStillTakingPhoto: "Hold still — taking the photo",
  pointAtPaper: "Point the camera at the paper",
  pointAtSheet: "Point the camera at the sheet",
  handFlat: "Hand flat, fingers together, phone straight above",
  paperChip: (n) => `Paper ${n}/4`,
  sheetChip: (n) => `Sheet ${n}/4`,
  steadyChip: "Steady",
  lightChip: "Light",
};

export function cameraCuesCopy(locale: Locale): CameraCuesCopy {
  return pickCopy(locale, { zhTW, en });
}
