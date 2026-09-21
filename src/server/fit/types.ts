import type {
  FrontFlare,
  HandCompatibility,
  HumpPlacement,
  Shape,
  SideCurvature,
  Size,
} from "../../lib/contracts/descriptors";
import type { ReasonCode } from "../../lib/contracts/fit";

/**
 * What scoreFit needs from the catalogue for one mouse. A subset of the
 * `mice` DB row — enough to score and to fill `FitEntry.mouse`. Descriptor
 * fields are nullable: an unclassified mouse still scores (§3 null-descriptor
 * rules), just with lower confidence.
 */
export interface CatalogueMouse {
  slug: string;
  brand: string;
  model: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  weightG: number | null;
  size: Size;
  handCompatibility: HandCompatibility | null;
  shape: Shape | null;
  humpPlacement: HumpPlacement | null;
  frontFlare: FrontFlare | null;
  sideCurvature: SideCurvature | null;
  thumbRest: boolean | null;
}

/** One sub-score computation, before it is placed under its key in FitEntry. */
export interface SubscoreResult {
  score: number | null;
  weight: number;
  reason: { code: ReasonCode; params: Record<string, number> };
}
