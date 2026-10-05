/**
 * Similar-hand contract — what `GET /api/scans/{scanId}/similar` returns:
 * how people with a hand of similar size rated the mice in the catalogue.
 *
 * Aggregates only. Nothing here lets a caller work back to one contributor:
 * the response carries counts and means, and the server withholds a mouse, or
 * the whole block, when too few people stand behind it. Those minimums are
 * engine code and candidates (未拍板) until real data exists. Until they are
 * met the answer is `available: false`, never a guess. Every number is made in
 * TypeScript (AGENTS.md hard rule 2). Change this file only in a PR of its own.
 */
import { z } from "zod";
import { GRIP_STYLES } from "./fit";

export const similarMouseSchema = z.strictObject({
  slug: z.string(),
  brand: z.string(),
  model: z.string(),
  /** How many contributors rated this mouse. */
  raters: z.number().int().min(1),
  /** Mean satisfaction on the survey's 1–5 scale. */
  meanSatisfaction: z.number().min(1).max(5),
});

export const similarResponseSchema = z.discriminatedUnion("available", [
  z.strictObject({
    available: z.literal(false),
    reason: z.literal("insufficient_data"),
  }),
  z.strictObject({
    available: z.literal(true),
    /** Contributors whose hand profile is close to this one. */
    neighbours: z.number().int().min(1),
    /** The hand profile the comparison used (binned, the caller's own). */
    basis: z.strictObject({
      handLengthBinMm: z.number().int(),
      palmWidthBinMm: z.number().int(),
      gripStyle: z.enum(GRIP_STYLES),
    }),
    mice: z.array(similarMouseSchema).min(1).max(5),
  }),
]);

export type SimilarMouse = z.infer<typeof similarMouseSchema>;
export type SimilarResponse = z.infer<typeof similarResponseSchema>;
