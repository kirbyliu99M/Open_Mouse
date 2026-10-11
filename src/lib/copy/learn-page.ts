/**
 * Words of the /learn information page ("How to choose a mouse that fits"),
 * zh-TW and English, same keys. Every string is a CANDIDATE (未拍板) until
 * Kirby has read it. English and zh-TW follow
 * codex-briefs/pages-copy-draft-2026-10-11.md (Learn table); the strings
 * that are NOT in that draft are marked "new" below and are Claude's wording:
 * the last card's title, the zh-TW chart labels for the engine's "height and hump", "front
 * flare" and "thumb rest" (the other three, the zh-TW grip names and the two
 * mouse-shape labels are the results page's own words, imported from its table,
 * not new strings), and the chart note.
 * The palm thickness card (new, candidate): the zh option words and their
 * one-line descriptions come from Kirby's palm thickness page design v9 (they
 * already exist there); the zh title and body and all the English are
 * Claude's, the English a translation. Not decided (未拍板).
 * The card "Weight and connection" is gone (Kirby 2026-10-11: it contradicted
 * the weight bar in the chart), so the page has five cards.
 *
 * LEARN-5 (candidate, from the sketch package's labels.json): the two new
 * shape names `shape.hump` and `shape.flare` (the results page has no word for
 * them), and the seven text marks on three of the four drawings,
 * `shape.marks` (the Symmetrical drawing carries no text, Kirby 2026-10-11). The
 * package's own status: zh-TW wording OK'd by Kirby 2026-10-11 in a draft
 * table; the English wording is Claude's, exact English strings unconfirmed.
 * The zh names for hump and flare are placeholders there.
 * Kirby 2026-10-11: zh rearPeak is 最高點偏後 (the 此款 is dropped).
 *
 * The page has no digits and no medical claim (a unit test checks both).
 */
import type { Locale } from "../contracts/locale";
import { pickCopy } from "../i18n/copy";
import { en as resultsEn, zhTW as resultsZh } from "./results-page";

export interface LearnPageCopy {
  title: string;
  lead: string;
  hand: { title: string; body: string };
  grip: {
    title: string;
    body: string;
    /** Palm, claw and fingertip: a name and one sentence each. */
    palm: { name: string; text: string };
    claw: { name: string; text: string };
    fingertip: { name: string; text: string };
  };
  /**
   * New (candidate): the palm thickness card, between the grip and the size.
   * Three static boxes, thick, medium and thin: a name and one line each.
   */
  thickness: {
    title: string;
    body: string;
    options: {
      thick: { name: string; line: string };
      medium: { name: string; line: string };
      thin: { name: string; line: string };
    };
  };
  size: { title: string; body: string };
  shape: {
    title: string;
    body: string;
    /** The results page's own shape words, under the first two drawings. */
    symmetrical: string;
    ergonomic: string;
    /** New (LEARN-5, candidate): the names under the other two drawings. */
    hump: string;
    flare: string;
    /**
     * New (LEARN-5, candidate): the text drawn on the four sketches. A `"\n"`
     * in a string is a line break the page keeps.
     */
    marks: {
      thumbRest: string;
      straightSide: string;
      centredPeak: string;
      rearPeak: string;
      widerFront: string;
      narrowerWaist: string;
      schematic: string;
    };
  };
  score: {
    /** New: the draft calls the last card "See your result"; the design v2 and the brief say "How we score". */
    title: string;
    body: string;
    /** New: the six chart labels, in the engine's sub-score order. */
    bars: {
      length: string;
      gripWidth: string;
      heightHump: string;
      frontFlare: string;
      thumb: string;
      weight: string;
    };
    /** New: the note under the chart. */
    barsNote: string;
  };
  /** The two text links (the chevron is drawn by the page). */
  scanLink: string;
  howItWorksLink: string;
  /** The primary button. */
  scanButton: string;
}

export const zhTW: LearnPageCopy = {
  title: "怎麼挑一支合手的滑鼠",
  lead: "挑滑鼠時最重要的幾件事，照我們比對的順序說明。",
  hand: {
    title: "認識你的手",
    body: "手長與掌寬決定哪些尺寸用起來自然。用一張空白 A4 掃描你的手，就能取得兩個數值。",
  },
  grip: {
    title: "認識握法",
    body: "手放在滑鼠上的方式，會影響哪些形狀適合你。",
    palm: { name: resultsZh.handGrip.palm, text: "整個手掌貼在滑鼠上。" },
    claw: {
      name: resultsZh.handGrip.claw,
      text: "手掌碰到滑鼠後方，手指拱起。",
    },
    fingertip: {
      name: resultsZh.handGrip.fingertip,
      text: "只有指尖碰到滑鼠。",
    },
  },
  thickness: {
    title: "手掌厚度",
    body: "手掌的厚薄會影響適合的滑鼠高度。掃描後可以選填厚、中或薄，略過就不調整。",
    options: {
      thick: { name: "厚", line: "掌肉豐厚，大拇指根部明顯隆起" },
      medium: { name: "中", line: "掌心有自然的弧度，介於兩者之間" },
      thin: { name: "薄", line: "掌心偏平，手背的筋骨線條較明顯" },
    },
  },
  size: {
    title: "配合尺寸",
    body: "長度與寬度最重要。我們把兩者與你的手比對。",
  },
  shape: {
    title: "看形狀",
    symmetrical: resultsZh.filter.shape.symmetrical,
    ergonomic: resultsZh.filter.shape.ergonomic,
    hump: "拱背",
    flare: "前端外張",
    marks: {
      thumbRest: "拇指托\n外凸",
      straightSide: "另一側\n較直",
      centredPeak: "對稱型最高點",
      rearPeak: "最高點偏後",
      widerFront: "前端\n較寬",
      narrowerWaist: "腰部\n較窄",
      schematic: "示意圖：外張經誇大",
    },
    body: "有些外殼左右對稱，有些為單手造型。拱背位置、前端寬度與側邊弧度會改變滑鼠的貼合方式。",
  },
  score: {
    title: "我們怎麼評分",
    body: "Palmate 把每支滑鼠與你的手比對評分，並說明原因。",
    bars: {
      length: resultsZh.subscoreShort.length,
      gripWidth: resultsZh.subscoreShort.gripWidth,
      heightHump: "高度與拱背",
      frontFlare: "前端寬度",
      thumb: "拇指托",
      weight: resultsZh.subscoreShort.weight,
    },
    barsNote: "條越長影響越大",
  },
  scanLink: "掃描我的手",
  howItWorksLink: "運作方式",
  scanButton: "掃描我的手",
};

export const en: LearnPageCopy = {
  title: "How to choose a mouse that fits",
  lead: "A short guide to what matters when you pick a mouse, in the order we look at it.",
  hand: {
    title: "Know your hand",
    body: "Hand length and palm width decide which sizes feel natural. Scan your hand on a blank sheet of A4 to get both.",
  },
  grip: {
    title: "Know your grip",
    body: "How your hand rests on the mouse changes which shapes suit it.",
    palm: { name: "Palm", text: "Your whole palm rests on the mouse." },
    claw: {
      name: "Claw",
      text: "Your palm touches the back and your fingers arch.",
    },
    fingertip: {
      name: "Fingertip",
      text: "Only your fingertips touch the mouse.",
    },
  },
  thickness: {
    title: "Palm thickness",
    body: "Thick, medium or thin changes how tall a mouse should be. You can pick one after the scan; skip it and we do not adjust.",
    options: {
      thick: {
        name: "Thick",
        line: "Full palm, the base of the thumb clearly raised",
      },
      medium: {
        name: "Medium",
        line: "A natural curve in the palm, between the other two",
      },
      thin: {
        name: "Thin",
        line: "A flatter palm, tendons on the back of the hand show more",
      },
    },
  },
  size: {
    title: "Match the size",
    body: "Length and width matter most. We compare both with your hand.",
  },
  shape: {
    title: "Look at the shape",
    symmetrical: resultsEn.filter.shape.symmetrical,
    ergonomic: resultsEn.filter.shape.ergonomic,
    hump: "Hump",
    flare: "Flare",
    marks: {
      thumbRest: "Thumb\nrest",
      straightSide: "Straight\nside",
      centredPeak: "Centered peak",
      rearPeak: "Rear peak",
      widerFront: "Wider\nfront",
      narrowerWaist: "Narrower\nwaist",
      schematic: "Schematic: exaggerated flare",
    },
    body: "Some shells are symmetrical; others are shaped for one hand. Hump position, front width and side curve change how a mouse sits.",
  },
  score: {
    title: "How we score",
    body: "Palmate scores each mouse against your hand and tells you why.",
    bars: {
      length: resultsEn.subscoreShort.length,
      gripWidth: resultsEn.subscoreShort.gripWidth,
      heightHump: "Height and hump",
      frontFlare: "Front flare",
      thumb: "Thumb rest",
      weight: resultsEn.subscoreShort.weight,
    },
    barsNote: "Longer bar = counts more",
  },
  scanLink: "Scan my hand",
  howItWorksLink: "How it works",
  scanButton: "Scan my hand",
};

export function learnPageCopy(locale: Locale): LearnPageCopy {
  return pickCopy(locale, { zhTW, en });
}
