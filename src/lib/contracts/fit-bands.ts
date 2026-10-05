/**
 * Fit-band contract — the plain-language grade a fit score is shown with.
 *
 * Only the band IDS live here. Where one band ends and the next begins is
 * engine code in a later PR, and it is a candidate (未拍板) until Kirby
 * confirms it: the coefficients behind `total` are still provisional
 * (`fit-v0-provisional`), so a band says "how this estimate reads", never
 * "how accurate it is". The words a band is shown with are UI copy, also not
 * decided here. No response carries a band yet (`fitEntrySchema` is
 * unchanged): the band is derived from `total` by a pure function, and a field
 * would need a later contract PR. Change this file only in a PR of its own.
 */
import { z } from "zod";

/** Best first. The order is part of the contract: index 0 is the best band. */
export const FIT_BANDS = ["very_good", "good", "fair", "poor"] as const;
export type FitBand = (typeof FIT_BANDS)[number];

export const fitBandSchema = z.enum(FIT_BANDS);
