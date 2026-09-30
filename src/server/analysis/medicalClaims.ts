/** Nouns for the shape of a surface: a gentle 弧度 is a shape fact. */
const SHAPE_NOUNS =
  "(?:弧度|曲線|曲线|線條|线条|坡度|斜度|起伏|弧面|曲面|弧形|造型|輪廓|轮廓)";

/** Body parts, for the claims about what a mouse does to them. */
const BODY_PARTS =
  "(?:手腕|腕部|手部|手掌|手指|手臂|前臂|關節|关节|肌肉|肌腱|肩頸|肩颈|肩膀|頸部|颈部|背部|身體|身体|掌心)";

/**
 * Candidate list (未拍板) of medical or health claims to reject in model prose.
 * Strings match complete English words or Chinese substrings; labelled patterns
 * cover inflections and phrases that need surrounding context.
 *
 * The Chinese half covers Traditional and Simplified spellings (each term is
 * listed in both where they differ) and follows the same scope as the English
 * half: named conditions, symptoms, injury, treatment and efficacy, prevention
 * and relief claims, and "healthy / ergonomic / friendly to the wrist" claims.
 * Comfort wording ("less fatigue", "comfortable", 舒適, 不容易疲勞) is
 * deliberately not on the list, exactly as in English. Body parts alone never
 * match: "避免手指打滑" (avoids finger slipping) and "降低高度" (lower height)
 * are shape facts; only a body part together with a health noun does.
 * `tests/unit/medical-claims-zh.test.ts` holds the flagged and accepted cases.
 */
export const MEDICAL_CLAIM_TERMS: readonly (
  string | { readonly label: string; readonly pattern: RegExp }
)[] = [
  "carpal tunnel",
  "CTS",
  "RSI",
  "repetitive strain",
  "tendinitis",
  "tendonitis",
  { label: "injury", pattern: /\binjur[a-z]*\b/i },
  { label: "pain", pattern: /\bpain(?!t)[a-z]*\b/i },
  { label: "relieve", pattern: /\brelieve[a-z]*\b/i },
  "relief",
  {
    label: "prevent injury or pain",
    pattern:
      /\bprevent(?:s|ing|ion)?\b(?:\s+\w+){0,4}\s+(?:injur[a-z]*|strain[a-z]*|pain(?!t)[a-z]*|RSI|CTS|carpal|tendin[a-z]*|tendon[a-z]*|damage|disorder|condition)\b/i,
  },
  "prevention",
  "therapeutic",
  "medical",
  { label: "diagnosis", pattern: /\bdiagnos[a-z]*\b/i },
  {
    label: "treatment or treat health condition",
    pattern:
      /\b(?:treatment|(?:treats|to treat)\s+(?:injur[a-z]*|strain[a-z]*|pain(?!t)[a-z]*|RSI|CTS|carpal|tendin[a-z]*|tendon[a-z]*|damage|disorder|condition))\b/i,
  },
  { label: "cure", pattern: /\bcure[a-z]*\b/i },
  "healthy",
  "healthier",
  {
    label: "safer for wrist or body",
    pattern:
      /\bsafer for (?:your )?(?:wrist|wrists|hand|hands|body|joints|forearm)\b/i,
  },
  { label: "ergonomic", pattern: /\bergonomic[a-z]*\b/i },
  "wrist-friendly",
  { label: "strain", pattern: /\bstrain[a-z]*\b/i },
  "wrist health",
  { label: "wrist saving", pattern: /\bwrist[ -]saving\b/i },
  {
    label: "reduce wrist or hand stress",
    pattern:
      /\breduc\w*\s+(?:wrist|hand|forearm|finger)\s+(?:stress|strain|tension|pressure)\b/i,
  },
  "腕隧道",
  "腕管",
  "肌腱炎",
  "疼痛",
  "酸痛",
  {
    label: "預防/预防 injury or wrist condition",
    pattern: /(?:預防|预防)(?:受傷|傷害|疾病|手腕|腕|疼痛|受伤|伤害)/u,
  },
  "治療",
  "治疗",
  "醫療",
  "医疗",
  "診斷",
  "诊断",
  // Keep 護腕 even though the prompt is English: model output can be Chinese.
  "護腕",
  "护腕",
  "人體工學",
  "人体工学",
  "減輕手腕負擔",
  "减轻手腕负担",
  "受傷",
  "受伤",
  "緩解",
  "缓解",

  // Named conditions and colloquial names for them.
  "滑鼠手",
  "鼠标手",
  "媽媽手",
  "妈妈手",
  "腱鞘炎",
  "網球肘",
  "网球肘",
  "板機指",
  "扳机指",
  "關節炎",
  "关节炎",
  "職業病",
  "职业病",
  {
    label: "重複性/重复性 strain injury",
    pattern: /重[複复]性(?:勞損|劳损|傷害|伤害|拉傷|拉伤)/u,
  },
  "症候群",
  "綜合症",
  "綜合徵",
  "综合征",
  "综合症",
  "疾病",
  "病症",
  "病痛",
  "症狀",
  "症状",

  // Symptoms: pain, soreness, numbness, inflammation, swelling. Any 痛 or
  // 疼 counts (手痛, 刺痛, 疼痛); 疼愛/疼惜 (to cherish) is not a symptom.
  "痠痛",
  { label: "痠 (soreness)", pattern: /痠/u },
  { label: "痛 (pain)", pattern: /痛/u },
  { label: "疼 (pain)", pattern: /疼(?![愛爱惜])/u },
  {
    label: "手酸 (soreness)",
    pattern: /[手腕臂指肩頸颈背腰][酸痠]/u,
  },
  {
    label: "麻 (numbness)",
    pattern: /[手腕指發发]麻|麻木|麻[痺痹]/u,
  },
  "發炎",
  "发炎",
  "炎症",
  { label: "腫脹/肿胀 (swelling)", pattern: /[腫肿][脹胀痛]/u },

  // Injury.
  "傷害",
  "伤害",
  "損傷",
  "损伤",
  "勞損",
  "劳损",
  "拉傷",
  "拉伤",
  "扭傷",
  "扭伤",

  // Treatment, efficacy, doctors and clinical language.
  "療效",
  "疗效",
  "療法",
  "疗法",
  "療程",
  "疗程",
  "治癒",
  "治愈",
  "痊癒",
  "痊愈",
  "康復",
  "康复",
  "復健",
  "复健",
  "醫學",
  "医学",
  "醫生",
  "医生",
  "醫師",
  "医师",
  "就醫",
  "就医",
  "臨床",
  "临床",
  "藥物",
  "药物",

  // Prevention and relief. A bare 預防 stays acceptable ("預防滑動" prevents
  // sliding); it only counts next to a health noun. Same for 避免/防止.
  {
    label: "預防/防止/避免 injury or condition",
    pattern:
      /(?:預防|预防|防止|避免|防範|防范|防護|防护).{0,3}(?:受傷|受伤|傷害|伤害|損傷|损伤|勞損|劳损|拉傷|拉伤|扭傷|扭伤|疾病|病|症|痛|痠|發炎|发炎|腕隧道|腕管|肌腱|關節炎|关节炎|滑鼠手|鼠标手)/u,
  },
  // 舒緩 / 舒缓 alone is also a shape word (弧度舒緩, 曲線舒緩: a gentle curve),
  // so it only counts in front of a health noun.
  {
    label: "舒緩/舒缓 pressure, pain or discomfort",
    pattern:
      /舒[緩缓](?:壓力|压力|疼痛|痠痛|酸痛|不適|不适|疲勞|疲劳|症狀|症状|緊繃|紧绷)/u,
  },
  // 舒緩 / 舒缓 is refused unless it describes a shape: 弧度舒緩, 曲線舒緩的
  // 背部 (a shape noun in front) or 舒緩的曲面 (a shape noun after 的). Any
  // other object (舒緩手腕, 有助舒緩, 舒緩負擔, 舒緩你的手) is a relief claim.
  {
    label: "舒緩/舒缓 outside a shape description",
    pattern: new RegExp(`(?<!${SHAPE_NOUNS})舒[緩缓](?!的${SHAPE_NOUNS})`, "u"),
  },
  // The same words in their variant spellings, always a relief claim.
  "紓緩",
  "纾缓",
  "紓解",
  "纾解",
  "抒解",
  "舒解",
  {
    label: "減輕/降低 wrist or hand stress",
    pattern:
      /(?:減輕|减轻|降低|減少|减少|減緩|减缓|舒緩|舒缓|改善|消除)(?:對|对)?(?:手腕|腕部|手部|手指|手臂|前臂|關節|关节|肌肉|肌腱|身體|身体)(?:的)?(?:負擔|负担|壓力|压力|緊繃|紧绷|張力|张力|不適|不适)/u,
  },
  {
    label: "保護/保护 wrist or body",
    pattern:
      /(?:保護|保护|呵護|呵护|守護|守护)(?:好|你的|您的)?(?:手腕|腕部|手部|關節|关节|肌腱|身體|身体)/u,
  },

  // A body part with a lower load: 手腕負擔較小, 對手腕壓力較低.
  {
    label: "身體部位 + 負擔/壓力 + 較小 (lower load on a body part)",
    pattern: new RegExp(
      `${BODY_PARTS}(?:的)?(?:負擔|负担|壓力|压力|張力|张力|勞累|劳累)(?:較|较|比較|比较|更|變|变|會|会)?(?:小|低|少|輕|轻|減少|减少|降低|減輕|减轻|下降)`,
      "u",
    ),
  },
  // Good for a body part: 有助於手腕, 有益身體, 有利於關節. The hands and
  // fingers are left alone when the sentence goes on about gripping.
  {
    label: "有助於/有益/有利於 + 身體部位 (good for the body)",
    pattern: new RegExp(
      `(?:有助[於于]?|有益[於于]?|有利[於于]?)(?:你的|您的|使用者的)?(?:手腕|腕部|手臂|前臂|關節|关节|肌肉|肌腱|肩頸|肩颈|肩膀|頸部|颈部|背部|身體|身体|健康)`,
      "u",
    ),
  },
  {
    label: "有助於/有益/有利於 + 手 (good for the hand, not for gripping)",
    pattern:
      /(?:有助[於于]?|有益[於于]?|有利[於于]?)(?:你的|您的|使用者的)?(?:手指|手掌|手部|掌心)(?!抓握|握持|貼合|貼附|发力|發力|施力|放置|擺放|摆放|定位|按壓|按压|點擊|点击|操作|移動|移动|滑動|滑动)/u,
  },
  {
    label: "放鬆/放松 + 身體部位 (relax a body part)",
    pattern: new RegExp(`(?:放鬆|放松|舒展)(?:你的|您的)?${BODY_PARTS}`, "u"),
  },
  {
    label: "預防/避免 + 不適/問題 (prevent discomfort or problems)",
    pattern: new RegExp(
      `(?:預防|预防|防止|避免|防範|防范|防護|防护)(?:${BODY_PARTS})?(?:的)?(?:不適|不适|問題|问题)`,
      "u",
    ),
  },
  // Patients and evidence: 罹患, 患者, 科學證實, 研究顯示, 專家建議.
  "罹患",
  "患有",
  "患者",
  "科學證實",
  "科学证实",
  "研究顯示",
  "研究显示",
  "專家建議",
  "专家建议",

  // Healthy, friendly and ergonomic claims.
  "健康",
  "保健",
  "養生",
  "养生",
  {
    label: "手腕友善/友好 (wrist-friendly)",
    pattern: /(?:手腕|腕部|腕)(?:友善|友好)/u,
  },
  {
    label: "對手腕友善/更安全 (friendly or safer for wrist or body)",
    pattern:
      /(?:對|对)(?:手腕|手部|手指|身體|身体|關節|关节)(?:更|較|较|比較|比较)?(?:友善|友好|安全|有益|有利|溫和|温和)/u,
  },
  "人體工程學",
  "人体工程学",
  "人因工程",
  "人因工學",
  "人機工程",
  "人机工程",
  "人機工學",
  "人机工学",
];

/** Returns the first matched term's readable label, or null. */
export function findMedicalClaimTerm(text: string): string | null {
  for (const term of MEDICAL_CLAIM_TERMS) {
    const label = typeof term === "string" ? term : term.label;
    const pattern =
      typeof term === "string"
        ? /[^\x00-\x7f]/.test(term)
          ? new RegExp(term, "u")
          : new RegExp(
              `\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
              "i",
            )
        : term.pattern;
    if (pattern.test(text)) return label;
  }
  return null;
}
