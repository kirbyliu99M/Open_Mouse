/**
 * `truth.json`: the ruler values for one participant, one set per hand.
 *
 * Written by `npm run learn:sort` as an empty template and filled in by a
 * person from the participant card. The two hands are measured apart because
 * hands differ, and a photo of the left hand must be compared with the left
 * hand's ruler values.
 *
 * The measuring protocol is a CANDIDATE until the W7 pre-agreement settles it
 * (docs/learning/README.md, "Ruler protocol"). `protocol` names the version a
 * file was measured under, so values taken under a different protocol are
 * never mixed by accident.
 */
import { z } from "zod";
import { handMeasurementsSchema } from "../contracts/measurement";

export const TRUTH_FORMAT = "open-mouse-learning-truth/2" as const;

/** The protocol the README describes today. Bump it when that text changes in substance. */
export const TRUTH_PROTOCOL = "candidate-v1" as const;

// The limits come from `handMeasurementsSchema` itself (imported, never
// copied), so a ruler value is held to the same range as the landmark
// measurement it is compared with, and a typo (185 written as 1850) is caught
// here rather than in an analysis a week later.
const handTruthSchema = z.strictObject({
  handLengthMm: handMeasurementsSchema.shape.handLengthMm.nullable(),
  palmWidthMm: handMeasurementsSchema.shape.palmWidthMm.nullable(),
});

export const truthSchema = z.strictObject({
  format: z.literal(TRUTH_FORMAT),
  participant: z.string().regex(/^P\d{3}$/),
  protocol: z.string().min(1),
  right: handTruthSchema,
  left: handTruthSchema,
  note: z.string(),
});

export type Truth = z.infer<typeof truthSchema>;

/** A template with every value still to be measured (`null`). */
export function emptyTruth(participant: string): Truth {
  return {
    format: TRUTH_FORMAT,
    participant,
    protocol: TRUTH_PROTOCOL,
    right: { handLengthMm: null, palmWidthMm: null },
    left: { handLengthMm: null, palmWidthMm: null },
    note: "Copy the ruler values written on slate.jpg, right hand and left hand separately, in mm. Protocol is a candidate: see docs/learning/README.md.",
  };
}
