import { FAIR_MIN } from "@/lib/fit/bands";

/**
 * Candidate threshold until real hand-to-mouse pairings validate fit scores.
 * Derived from the fit bands, so the notice and the bands cannot disagree: a
 * total under the lowest total of `fair` is `poor`.
 */
export const POOR_FIT_THRESHOLD = FAIR_MIN;
