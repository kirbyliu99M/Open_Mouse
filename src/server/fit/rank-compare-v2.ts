/**
 * Ranking comparison helpers for the v1 vs v2 report (pure).
 */

/**
 * Kendall tau between two rankings of the same items, each a list of ids
 * best first. Items missing from either list are ignored. 1 = same order,
 * -1 = reversed; NaN when fewer than two common items.
 */
export function kendallTau(a: readonly string[], b: readonly string[]): number {
  const posB = new Map(b.map((id, i) => [id, i] as const));
  const common = a.filter((id) => posB.has(id));
  const n = common.length;
  if (n < 2) return NaN;
  const pb = common.map((id) => posB.get(id) as number);
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Positions in `a` are strictly increasing along `common`.
      const d = pb[j] - pb[i];
      if (d > 0) concordant += 1;
      else if (d < 0) discordant += 1;
    }
  }
  // Rankings carry no ties, so tau-a and tau-b coincide.
  return (concordant - discordant) / ((n * (n - 1)) / 2);
}

/** |A intersect B| for the first k ids of each list. */
export function topKOverlap(
  a: readonly string[],
  b: readonly string[],
  k: number,
): number {
  const sb = new Set(b.slice(0, k));
  return a.slice(0, k).filter((id) => sb.has(id)).length;
}
