import type { FitEntry } from "../../lib/contracts/fit";
import type { CatalogueMouse } from "./types";

/**
 * Same-shell grouping of ranked fit results (SHELL-1). The spec is the
 * comment on `variants` in `src/lib/contracts/fit.ts`; this follows it.
 *
 * Pure and engine-agnostic: it reads only each entry's rank and total and the
 * catalogue row the entry was scored from, so v0 and v1 behave the same.
 *
 * Same shell means strict equality (`===`) of `brand`, the three dimensions
 * and the seven shape descriptors; a null matches only a null. Weight,
 * connectivity and everything else may differ. A group's shown entry is its
 * member with the best total (a tie goes to the earlier rank); the others
 * become its `variants`, in their rank order before grouping. Shown entries
 * keep their order and are renumbered 1..n. A single-member group gets no
 * `variants` key at all. Nothing else on an entry changes.
 *
 * Throws when a ranked entry has no catalogue row: both come from one load,
 * so a miss is a bug, not a case to paper over.
 */
export function groupShells(
  ranked: readonly FitEntry[],
  catalogue: readonly CatalogueMouse[],
): FitEntry[] {
  const bySlug = new Map(catalogue.map((m) => [m.slug, m] as const));
  const keyOf = (entry: FitEntry): string => {
    const row = bySlug.get(entry.mouse.slug);
    if (!row) {
      throw new Error(
        `No catalogue row found for ranked mouse slug "${entry.mouse.slug}".`,
      );
    }
    // JSON.stringify keeps null, undefined (as null via ?? ) and booleans
    // apart; numbers and strings are compared exactly, never rounded.
    return JSON.stringify([
      row.brand,
      row.lengthMm,
      row.widthMm,
      row.heightMm,
      row.shape ?? null,
      row.handCompatibility ?? null,
      row.humpPlacement ?? null,
      row.frontFlare ?? null,
      row.sideCurvature ?? null,
      row.thumbRest ?? null,
      row.ringFingerRest ?? null,
    ]);
  };

  const inRankOrder = [...ranked].sort((a, b) => a.rank - b.rank);
  const groups = new Map<string, FitEntry[]>();
  for (const entry of inRankOrder) {
    const key = keyOf(entry);
    const members = groups.get(key);
    if (members) members.push(entry);
    else groups.set(key, [entry]);
  }

  const shown: { entry: FitEntry; variants: FitEntry[] }[] = [];
  for (const members of groups.values()) {
    // `members` is in rank order, so a strict `>` keeps the earlier on a tie.
    let best = members[0]!;
    for (const m of members) if (m.total > best.total) best = m;
    shown.push({ entry: best, variants: members.filter((m) => m !== best) });
  }
  shown.sort((a, b) => a.entry.rank - b.entry.rank);

  return shown.map(({ entry, variants }, i) => {
    const { variants: _stale, ...rest } = entry;
    void _stale;
    return {
      ...rest,
      rank: i + 1,
      ...(variants.length > 0
        ? {
            variants: variants.map((v) => ({
              slug: v.mouse.slug,
              model: v.mouse.model,
              weightG: v.mouse.weightG,
            })),
          }
        : {}),
    };
  });
}
