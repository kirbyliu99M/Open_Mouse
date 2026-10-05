/**
 * Similar-hand contract — what `GET /api/scans/{scanId}/similar` returns:
 * how people with a hand of similar size rated the mice in the catalogue.
 *
 * Aggregates only. Nothing here lets a caller work back to one contributor:
 * the response carries counts and means, and the server withholds a mouse, or
 * the whole block, when too few people stand behind it. Kirby (2026-10-06):
 * in the test phase there is no minimum of its own, because there is no volume
 * of data; so the engine sets none beyond the floor the shape itself enforces,
 * `SIMILAR_MIN_PEOPLE`, below which a count or a mean would be one person's
 * answer. That floor is a privacy rule, not a threshold, and stays unless
 * Kirby says otherwise. Until it is met the answer is `available: false`,
 * never a guess. Every number is made in TypeScript (AGENTS.md hard rule 2).
 *
 * Never cached by a shared cache: like the other endpoints that answer from a
 * person's hand, the response carries `Cache-Control: no-store` (see routes.ts).
 * Change this file only in a PR of its own.
 */
import { z } from "zod";
import { GRIP_STYLES } from "./fit";
import { CONTRIBUTION_BIN_MM } from "./survey";

/** No count in a response may be below this: one person is not an aggregate. */
export const SIMILAR_MIN_PEOPLE = 2;

export const MAX_SIMILAR_MICE = 5;

export const similarMouseSchema = z.strictObject({
  slug: z.string(),
  brand: z.string(),
  model: z.string(),
  /** How many contributors rated this mouse. */
  raters: z.number().int().min(SIMILAR_MIN_PEOPLE),
  /** Mean satisfaction on the survey's 1–5 scale. */
  meanSatisfaction: z.number().min(1).max(5),
});

const onBin = (n: number): boolean => n % CONTRIBUTION_BIN_MM === 0;

export const similarResponseSchema = z.discriminatedUnion("available", [
  z.strictObject({
    available: z.literal(false),
    reason: z.literal("insufficient_data"),
  }),
  z
    .strictObject({
      available: z.literal(true),
      /** Contributors whose hand profile is close to this one. */
      neighbours: z.number().int().min(SIMILAR_MIN_PEOPLE),
      /** The hand profile the comparison used: the caller's own, in bins. */
      basis: z.strictObject({
        handLengthBinMm: z.number().int().refine(onBin, {
          message: "must be a multiple of CONTRIBUTION_BIN_MM",
        }),
        palmWidthBinMm: z.number().int().refine(onBin, {
          message: "must be a multiple of CONTRIBUTION_BIN_MM",
        }),
        gripStyle: z.enum(GRIP_STYLES),
      }),
      mice: z.array(similarMouseSchema).min(1).max(MAX_SIMILAR_MICE),
    })
    .superRefine((value, ctx) => {
      if (new Set(value.mice.map((m) => m.slug)).size !== value.mice.length) {
        ctx.addIssue({ code: "custom", message: "a mouse appears once" });
      }
      if (value.mice.some((m) => m.raters > value.neighbours)) {
        ctx.addIssue({
          code: "custom",
          message: "raters cannot exceed neighbours",
        });
      }
    }),
]);

export type SimilarMouse = z.infer<typeof similarMouseSchema>;
export type SimilarResponse = z.infer<typeof similarResponseSchema>;
