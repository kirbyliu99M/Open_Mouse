/**
 * The similar-hand block on the results page (candidate, Kirby 2026-10-12): how
 * people with a hand of similar size rated the mice. This file holds what is
 * not React: the formatting of the numbers and the one fetch. The contract is
 * `similarResponseSchema` (src/lib/contracts/recommend.ts); the route is
 * `similarPath(scanId)` (routes.ts), `no-store`.
 *
 * What the page does with each answer:
 *   - `available: true`  -> the list ("ready").
 *   - `available: false` -> one line saying there is not enough data yet.
 *   - anything else (a network error, a 404, a 429, a 5xx, a body the schema
 *     refuses) -> nothing at all ("hidden"): the block is an extra, so a
 *     failure of it must never show up on the page.
 * A count under `SIMILAR_MIN_PEOPLE` never reaches the screen: the schema
 * refuses it, and a refused body is "hidden".
 */
import {
  similarResponseSchema,
  type SimilarMouse,
} from "@/lib/contracts/recommend";
import { similarPath } from "@/lib/contracts/routes";

export type SimilarState =
  | { status: "loading" }
  | { status: "hidden" }
  | { status: "unavailable" }
  | {
      status: "ready";
      neighbours: number;
      mice: readonly SimilarMouse[];
    };

/** The one-decimal mean over five, half-width slash: `4.4/5`. Made here, never in copy. */
export function formatSatisfaction(mean: number): string {
  // Round to a tenth first: `toFixed` alone rounds 4.35 down (binary 4.3499...).
  const tenth = Math.round(mean * 10) / 10;
  return `${tenth.toFixed(1)}/5`;
}

type FetchImpl = (
  input: string,
  init?: { signal?: AbortSignal; cache?: "no-store" },
) => Promise<{
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
}>;

/**
 * Ask for the block of one scan. Never throws: every failure is `hidden`.
 * `fetchImpl` is for tests.
 */
export async function fetchSimilar(
  scanId: string,
  signal?: AbortSignal,
  fetchImpl: FetchImpl = (input, init) => fetch(input, init),
): Promise<Exclude<SimilarState, { status: "loading" }>> {
  try {
    const res = await fetchImpl(similarPath(scanId), {
      signal,
      cache: "no-store",
    });
    if (!res.ok) return { status: "hidden" };
    const parsed = similarResponseSchema.safeParse(await res.json());
    if (!parsed.success) return { status: "hidden" };
    if (!parsed.data.available) return { status: "unavailable" };
    return {
      status: "ready",
      neighbours: parsed.data.neighbours,
      mice: parsed.data.mice,
    };
  } catch {
    return { status: "hidden" };
  }
}
