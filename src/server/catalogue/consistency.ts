import type { HandCompatibility, Shape } from "../../lib/contracts/descriptors";

export interface DescriptorSet {
  shape: Shape | null;
  handCompatibility: HandCompatibility | null;
  thumbRest: boolean | null;
  ringFingerRest: boolean | null;
}

export interface ConsistencyViolation {
  rule: string;
  message: string;
}

/**
 * Rubric §2. A violation means reclassify — never override. The same rules
 * exist as CHECK constraints on `mice`; this is the version that can explain
 * itself. Unknown (null) values never violate: absence is not a contradiction.
 */
export function checkConsistency(d: DescriptorSet): ConsistencyViolation[] {
  const out: ConsistencyViolation[] = [];
  if (
    d.handCompatibility === "ambidextrous" &&
    d.shape !== null &&
    d.shape !== "symmetrical"
  ) {
    out.push({
      rule: "ambidextrous_is_symmetrical",
      message: `An ambidextrous mouse must be symmetrical, got ${d.shape}.`,
    });
  }
  if (d.thumbRest === true && d.shape !== null && d.shape !== "ergonomic") {
    out.push({
      rule: "thumb_rest_is_ergonomic",
      message: `A thumb rest implies an ergonomic shell, got ${d.shape} — likely side curvature misread as a rest.`,
    });
  }
  if (
    d.ringFingerRest === true &&
    d.shape !== null &&
    d.shape !== "ergonomic"
  ) {
    out.push({
      rule: "ring_rest_is_ergonomic",
      message: `A ring-finger rest implies an ergonomic shell, got ${d.shape}.`,
    });
  }
  return out;
}
