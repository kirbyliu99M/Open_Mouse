/**
 * Home contract — what `GET /api/home/top-mice` returns so the home page can
 * show the visitor's own best matches in its last scene.
 *
 * Names only. The response carries no score, no rank number and no
 * measurement: the home page labels the mice and nothing else (Kirby,
 * 2026-10-05). The array is best match first, but that order is not shown.
 * Only mice that have a particle outline are returned, so the array may skip
 * a better match that has none and may hold fewer than `HOME_TOP_MICE_COUNT`.
 * 404 when the caller has no live scan: no session cookie, an expired
 * anonymous session, or a deleted scan (then the page shows its examples).
 * Change this file only in a PR of its own.
 */
import { z } from "zod";

export const HOME_TOP_MICE_COUNT = 3;

export const homeTopMiceResponseSchema = z.strictObject({
  mice: z
    .array(
      z.strictObject({
        slug: z.string().min(1),
        brand: z.string().min(1),
        model: z.string().min(1),
      }),
    )
    .min(1)
    .max(HOME_TOP_MICE_COUNT),
});

export type HomeTopMiceResponse = z.infer<typeof homeTopMiceResponseSchema>;
