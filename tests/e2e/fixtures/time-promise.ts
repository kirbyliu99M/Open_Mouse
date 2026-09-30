/**
 * Kirby, 2026-09-30: the product pages say scans are deleted or expire
 * automatically, but never when. The schedule is a design detail (see
 * src/server/scans/retention.ts), not something the copy states.
 *
 * `timePromises(text)` returns the sentences that talk about keeping or
 * deleting something AND name an amount of time or a moment ("24 hours",
 * "two days", "a few hours", "24h", "30 minutes", "a week", "tomorrow",
 * "overnight"...). Sentences that name a time but are not about keeping or
 * deleting ("Takes about a minute") are not promises and are left alone.
 */
const RETENTION_TOPIC =
  /\b(delet\w*|expir\w*|kept|keep\w*|stor\w+|remov\w*|retain\w*|erase\w*|purg\w*|discard\w*|wiped?|saved?|gone)\b/i;

const NUMBER_WORD =
  "a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|twenty[- ]four|thirty|forty[- ]eight|seventy[- ]two|few|couple|several|half|next|another|many|some";
const UNIT =
  "seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?";

const AMOUNT_OF_TIME = new RegExp(
  [
    // "24 hours", "two days", "a few hours", "a couple of weeks", "1.5 h"
    String.raw`\b(\d+(\.\d+)?|${NUMBER_WORD})[- ]?(of )?((\d+|${NUMBER_WORD}) )?(${UNIT})\b`,
    // "24h", "30 min", "7d"
    String.raw`\b\d+\s?(h|hrs?|d|mins?)\b`,
    // moments
    String.raw`\b(tomorrow|tonight|overnight|midnight|daily|nightly|weekly|by morning|next day|end of (the )?day)\b`,
  ].join("|"),
  "i",
);

export function timePromises(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(
      (sentence) =>
        RETENTION_TOPIC.test(sentence) && AMOUNT_OF_TIME.test(sentence),
    );
}
