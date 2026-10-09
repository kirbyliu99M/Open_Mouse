import type {
  FormFactor,
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
 *
 * `id` is optional here because `scoreFit` itself never reads it — only the
 * fit route does, to resolve a scored `FitEntry.mouse.slug` back to the
 * `mice.id` a `fit_results.mouse_id` foreign key needs (issue #27). It stays
 * optional so existing scoring fixtures that predate persistence (golden
 * fixtures, subscore/exclusion/grip unit tests) don't need an `id` they have
 * no use for. The real catalogue loader (`src/server/fit/drizzle-repo.ts`)
 * always populates it.
 */
export interface CatalogueMouse {
  id?: string;
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
  /**
   * fit-v1 only (v0 ignores it). Optional until the catalogue carries a
   * form-factor column (CAT-1); absent is treated as "standard".
   */
  formFactor?: FormFactor;
}

/** One sub-score computation, before it is placed under its key in FitEntry. */
export interface SubscoreResult {
  score: number | null;
  weight: number;
  reason: { code: ReasonCode; params: Record<string, number> };
}
