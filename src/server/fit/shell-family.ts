/**
 * The model-name part of the same-shell key (SHELL-1, `shell-groups.ts`).
 *
 * Equal brand, size and shape descriptors do not prove two mice share a shell:
 * the catalogue has no shell column, and different mice can have the same
 * numbers (SteelSeries Aerox 3 and Rival 3 are both 120.6 x 67.0 x 38.0).
 * Two rows may share a card only when their names say they are one model
 * sold in several versions. The family is the lower-cased model name with the
 * words that only name a version removed; two rows with different families
 * never share a card, so a doubtful pair stays apart (two cards) instead of
 * being claimed as one shell.
 *
 * Removed: a connection (wired, wireless, HyperSpeed, Lightspeed), a polling
 * rate (1K, 4K, 8K, 35K, 65K, 4K/8K), a trim or finish (Pro, Core, SE, Lite,
 * Ultra, RGB, CF, MG, Magnesium, Aurora, Purple, Champion, Special, Edition,
 * Carbon), and a leading collaboration tag ("x Fnatic "). Kept, so they keep
 * models apart: every number, version, generation and size word (V2, Gen 2,
 * Mini, Medium, Max, X, II), and every other word.
 *
 * Candidate / 未拍板 (Kirby, 2026-10-14: 卡片不要亂併). Pure and tested
 * (`tests/unit/shell-family.test.ts`); to add a version word, add it to
 * `VERSION_WORDS` and a test row.
 */
const VERSION_WORDS: ReadonlySet<string> = new Set([
  "wired",
  "wireless",
  "hyperspeed",
  "lightspeed",
  "pro",
  "core",
  "se",
  "lite",
  "ultra",
  "rgb",
  "cf",
  "mg",
  "magnesium",
  "aurora",
  "purple",
  "champion",
  "special",
  "edition",
  "carbon",
]);

/** 1k, 4K, 8k, 35K, 65K, and the pair 4K/8K. */
const POLLING_RATE = /^\d+k(\/\d+k)?$/;

/** A leading "x <partner> " collaboration tag, as in "x Fnatic MAYA 8K". */
const COLLAB_TAG = /^x\s+\S+\s+/;

export function shellFamily(model: string): string {
  return model
    .toLowerCase()
    .replace(COLLAB_TAG, "")
    .replace(/[()]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w !== "" && !VERSION_WORDS.has(w) && !POLLING_RATE.test(w))
    .join(" ");
}
