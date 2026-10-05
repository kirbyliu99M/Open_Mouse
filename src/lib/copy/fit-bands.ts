/**
 * Words for the fit bands: what a band means for USING the mouse, and what each
 * reason code means for how it feels in the hand. zh-TW and English, same keys.
 *
 * Data only. Nothing shows this on a page yet: the Gemini prompt reads `en`
 * (the prompt is English, see `src/server/analysis/input.ts`) and a later
 * results-page badge will read both. Every string here is a CANDIDATE (未拍板)
 * until Kirby has read it.
 *
 * Rules the tests pin for every string:
 * - no digit and no number word (a model that echoes a sentence must not trip
 *   the no-new-numerals rule, AGENTS.md hard rule 2);
 * - no medical or health claim (`findMedicalClaimTerm`, plus a short
 *   zh-TW / English word list);
 * - it describes how a mouse tends to feel ("may", "tends to"), never a health
 *   outcome, and never how accurate the estimate is. The engine is still
 *   provisional (`fit-v0-provisional`): a band says how an estimate reads.
 *   The tests hold every string to a list of accuracy and certainty words
 *   (accurate, precise, reliable, certain, guarantee, exact, 準確, 保證 ...)
 *   and of comparisons with other people (most people, percentile, better
 *   than, average, 多數人, 別人, 百分位 ...), in both languages.
 */
import type { FitBand } from "../contracts/fit-bands";
import type { ReasonCode } from "../contracts/fit";

export interface FitBandCopy {
  /** Per band: a short name and one sentence on what it means for use. */
  bands: Record<FitBand, { label: string; meaning: string }>;
  /** Per reason code: one sentence on what it means for how the mouse feels. */
  impact: Record<ReasonCode, string>;
  /** One caveat that goes with any band: it is an estimate, still being tuned. */
  provisional: string;
}

export const zhTW: FitBandCopy = {
  bands: {
    very_good: {
      label: "非常適合你",
      meaning: "尺寸與握法大致吻合，日常使用應該相當自在。",
    },
    good: {
      label: "適合你",
      meaning: "大致吻合，少數地方可能需要適應。",
    },
    fair: {
      label: "勉強可用",
      meaning: "有幾處不太吻合，長時間使用可能比較吃力。",
    },
    poor: {
      label: "不太適合",
      meaning: "多處不吻合，建議先看看其他款式。",
    },
  },
  impact: {
    length_ideal: "長度剛好，手掌與手指都能自然落在該放的位置。",
    length_short: "偏短：掌心後段可能沒有靠到，手指要多彎一點才握得住。",
    length_long: "偏長：前端按鍵可能不好搆，點擊時手指要伸直或手要往前挪。",
    width_ideal: "握寬與手掌相符，手比較能放鬆。",
    width_narrow: "偏窄：容易握得比較緊才控制得住。",
    width_wide: "偏寬：手指要撐得比較開，長時間使用可能比較吃力。",
    height_low: "偏低：掌心離桌面較近，下方的拱起支撐較少。",
    height_ideal: "高度剛好，掌心有支撐，手腕也不必上抬。",
    height_high: "偏高：手腕可能被墊高，手指要越過頂部去按。",
    hump_matches_grip: "最高點的位置符合你的握法，掌心有地方靠。",
    hump_mismatch_grip: "最高點的位置和你的握法不太對，部分掌心可能沒有支撐。",
    flare_supports_fingers: "前端形狀讓手指有空間，也有支撐。",
    flare_neutral: "前端形狀對你的握法沒有特別加分或扣分。",
    flare_crowds_fingers: "前端形狀可能讓手指有點擠。",
    thumb_rest_supports: "拇指托讓拇指有地方放。",
    thumb_neutral: "拇指位置對你的握法不是問題。",
    thumb_rest_missing: "你的握法會把拇指放在拇指托上，這支沒有。",
    thumb_rest_unneeded: "這支有拇指托，但你的握法用不到。",
    weight_in_range: "重量在你選的範圍內。",
    weight_heavier: "比你選的範圍重，快速移動時可能比較費力。",
    weight_lighter: "比你選的範圍輕。",
    descriptor_unknown: "這支滑鼠這部分的形狀還沒評過，先當作中性計算。",
    no_preference: "你沒有設定重量偏好。",
  },
  provisional: "依你的手部尺寸估算，計算方式仍在調整，僅供參考。",
};

export const en: FitBandCopy = {
  bands: {
    very_good: {
      label: "A very good fit",
      meaning:
        "Size and grip line up closely, so everyday use should feel comfortable.",
    },
    good: {
      label: "A good fit",
      meaning: "Mostly lines up; a few things may take getting used to.",
    },
    fair: {
      label: "A fair fit",
      meaning:
        "Several things do not line up, so long sessions may feel more tiring.",
    },
    poor: {
      label: "A poor fit",
      meaning: "Many things do not line up; look at other mice first.",
    },
  },
  impact: {
    length_ideal:
      "The length lets your palm and fingers rest where they naturally fall.",
    length_short:
      "A shorter mouse leaves the back of your palm unsupported, so your fingers may curl more to hold it.",
    length_long:
      "A longer mouse can put the front buttons just out of easy reach, so you may stretch your fingers or shift your hand to click.",
    width_ideal:
      "The grip width matches your palm, so your hand can stay relaxed.",
    width_narrow:
      "A narrower mouse tends to make you grip harder to keep control.",
    width_wide:
      "A wider mouse spreads your fingers further apart, which can feel tiring over a long session.",
    height_low:
      "A lower mouse puts your palm closer to the desk, with less arch under it.",
    height_ideal: "The height supports your palm without lifting your wrist.",
    height_high:
      "A taller mouse can push your wrist upward and make your fingers reach over the top.",
    hump_matches_grip:
      "The highest point sits where your grip rests your palm.",
    hump_mismatch_grip:
      "The highest point is not where your grip rests your palm, so part of the palm may go unsupported.",
    flare_supports_fingers:
      "The front shape gives your fingers room and support.",
    flare_neutral: "The front shape is neutral for your grip.",
    flare_crowds_fingers: "The front shape may crowd your fingers.",
    thumb_rest_supports: "The thumb rest gives your thumb somewhere to settle.",
    thumb_neutral: "Thumb placement is not a concern for your grip.",
    thumb_rest_missing:
      "Your grip would rest the thumb on a thumb rest, and this mouse has none.",
    thumb_rest_unneeded:
      "This mouse has a thumb rest that your grip does not use.",
    weight_in_range: "The weight is within the range you chose.",
    weight_heavier:
      "It is heavier than the range you chose, so it may take more effort to move quickly.",
    weight_lighter: "It is lighter than the range you chose.",
    descriptor_unknown:
      "This part of this mouse has not been rated yet, so it counts as neutral.",
    no_preference: "You did not set a weight preference.",
  },
  provisional:
    "An estimate from your hand size; the method is still being tuned, so treat it as a guide.",
};
