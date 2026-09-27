/** candidate list (未拍板) — review with the owner. */
export const MEDICAL_CLAIM_TERMS = [
  "carpal tunnel",
  "CTS",
  "RSI",
  "repetitive strain",
  "tendinitis",
  "tendonitis",
  "injury",
  "injuries",
  "pain",
  "painless",
  "relieve",
  "relief",
  "prevent",
  "prevention",
  "therapeutic",
  "medical",
  "diagnos",
  "treat",
  "cure",
  "healthy",
  "healthier",
  "safer",
  "ergonomic",
  "wrist-friendly",
  "strain",
  "腕隧道",
  "腕管",
  "肌腱炎",
  "疼痛",
  "酸痛",
  "預防",
  "治療",
  "醫療",
  "診斷",
  "護腕",
  "人體工學",
] as const;

const INFLECTED_STEMS: ReadonlySet<string> = new Set([
  "relieve",
  "prevent",
  "diagnos",
  "treat",
  "cure",
]);

const patterns = MEDICAL_CLAIM_TERMS.map((term) => {
  if (/[^\x00-\x7f]/.test(term)) return new RegExp(term, "iu");
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `\\b${escaped}${INFLECTED_STEMS.has(term) ? "[a-z]*" : ""}\\b`,
    "i",
  );
});

/** English terms match complete words; Chinese terms match within prose. */
export function findMedicalClaimTerm(text: string): string | null {
  const index = patterns.findIndex((pattern) => pattern.test(text));
  return index < 0 ? null : MEDICAL_CLAIM_TERMS[index]!;
}
