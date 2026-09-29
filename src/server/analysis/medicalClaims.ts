/**
 * Candidate list (未拍板) of medical or health claims to reject in model prose.
 * Strings match complete English words or Chinese substrings; labelled patterns
 * cover inflections and phrases that need surrounding context.
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
