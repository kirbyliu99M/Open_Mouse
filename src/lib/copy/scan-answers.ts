/**
 * Words of the two question pages that follow the measured sheet of the easy
 * scan: how the person holds a mouse (1／2) and how thick their palm is (2／2).
 * Every zh-TW string is a CANDIDATE (未拍板): the strings of both pages are
 * the ones in Kirby's approved Pencil frames (2026-10-12, grip v3 and
 * thickness v9); the English is Claude's, short, and the measured sheet's
 * "Continue" button is new here (the frames do not show that sheet).
 *
 * The three thickness lines (厚／中／薄) are shared in wording with the Learn
 * page (PR #193, another session). They are kept apart on purpose: each page
 * owns its copy module, and the zh-TW text must stay identical in both. If a
 * shared source is wanted, move `thickness` into one module and import it from
 * both pages in a PR of its own.
 *
 * Neither question is mandatory. A skip sends no field (see
 * `src/client/scan/answers.ts`).
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";

/** One option row: its name and the line under it. */
export interface ChoiceCopy {
  name: string;
  hint: string;
}

export interface ScanAnswersCopy {
  /** The measured sheet's button: it opens the questions, it sends nothing. */
  sheetContinue: string;
  back: string;
  skip: string;
  /** "1／2" and "2／2". */
  stepGrip: string;
  stepThickness: string;
  /** What a screen reader hears for the step counter. */
  stepGripLabel: string;
  stepThicknessLabel: string;
  /** The grip page. */
  gripTitle: string;
  gripSubtitle: string;
  gripGroupLabel: string;
  gripConfirm: string;
  grip: { palm: ChoiceCopy; claw: ChoiceCopy; fingertip: ChoiceCopy };
  /** The thickness page. */
  thicknessTitle: string;
  thicknessSubtitle: string;
  thicknessGroupLabel: string;
  thicknessSubmit: string;
  thickness: { thick: ChoiceCopy; medium: ChoiceCopy; thin: ChoiceCopy };
  /** While the scan is sent (the button shows `sending`). */
  sending: string;
}

export const zhTW: ScanAnswersCopy = {
  sheetContinue: "繼續",
  back: "返回",
  skip: "跳過",
  stepGrip: "1／2",
  stepThickness: "2／2",
  stepGripLabel: "第 1 步，共 2 步",
  stepThicknessLabel: "第 2 步，共 2 步",
  gripTitle: "握滑鼠的方式",
  gripSubtitle: "點選最像你平常的握法。",
  gripGroupLabel: "握法",
  gripConfirm: "確認",
  grip: {
    palm: { name: "趴握", hint: "整個手掌貼在滑鼠上" },
    claw: { name: "抓握", hint: "手掌後段貼著，手指拱起" },
    fingertip: { name: "指握", hint: "只有指尖碰滑鼠，掌心懸空" },
  },
  thicknessTitle: "手掌厚度",
  thicknessSubtitle: "點選最接近你的一項。",
  thicknessGroupLabel: "手掌厚度",
  thicknessSubmit: "看結果",
  thickness: {
    thick: { name: "厚", hint: "掌肉豐厚，大拇指根部明顯隆起" },
    medium: { name: "中", hint: "掌心有自然的弧度，介於兩者之間" },
    thin: { name: "薄", hint: "掌心偏平，手背的筋骨線條較明顯" },
  },
  sending: "傳送中…",
};

export const en: ScanAnswersCopy = {
  sheetContinue: "Continue",
  back: "Back",
  skip: "Skip",
  stepGrip: "1 of 2",
  stepThickness: "2 of 2",
  stepGripLabel: "Step 1 of 2",
  stepThicknessLabel: "Step 2 of 2",
  gripTitle: "How you hold a mouse",
  gripSubtitle: "Tap the one closest to your usual grip.",
  gripGroupLabel: "Grip style",
  gripConfirm: "Confirm",
  grip: {
    palm: { name: "Palm", hint: "Your whole palm rests on the mouse" },
    claw: {
      name: "Claw",
      hint: "The back of your palm touches, fingers arched",
    },
    fingertip: {
      name: "Fingertip",
      hint: "Only your fingertips touch, palm lifted",
    },
  },
  thicknessTitle: "Palm thickness",
  thicknessSubtitle: "Tap the one closest to yours.",
  thicknessGroupLabel: "Palm thickness",
  thicknessSubmit: "See results",
  thickness: {
    thick: {
      name: "Thick",
      hint: "A full palm; the base of the thumb clearly bulges",
    },
    medium: {
      name: "Medium",
      hint: "A natural curve in the palm, between the two",
    },
    thin: {
      name: "Thin",
      hint: "A flatter palm; the tendons on the back of the hand show more",
    },
  },
  sending: "Sending…",
};

export function scanAnswersCopy(locale: Locale): ScanAnswersCopy {
  return pickCopy(locale, { zhTW, en });
}
