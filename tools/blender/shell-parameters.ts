import type {
  FrontFlare,
  HandCompatibility,
  HumpPlacement,
  Shape,
  SideCurvature,
} from "../../src/lib/contracts/descriptors";

export interface ShellSpec {
  id: string;
  model: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  shape: Shape;
  handCompatibility: HandCompatibility;
  humpPlacement: HumpPlacement;
  frontFlare: FrontFlare;
  sideCurvature: SideCurvature;
  thumbRest: boolean;
  ringFingerRest: boolean;
}

const PEAK: Record<HumpPlacement, number> = {
  center: 0.52,
  back_minimal: 0.59,
  back_moderate: 0.66,
  back_aggressive: 0.74,
};
const FLARE: Record<FrontFlare, number> = {
  inward_aggressive: -0.18,
  inward_moderate: -0.12,
  inward_slight: -0.06,
  flat: 0,
  outward_slight: 0.04,
  outward_moderate: 0.08,
  outward_aggressive: 0.14,
};
const CONCAVITY: Record<SideCurvature, number> = {
  inward_aggressive: 0.13,
  inward: 0.065,
  flat: 0,
  outward: -0.045,
  outward_aggressive: -0.09,
};

/** Deterministic authoring defaults, not fitted or validated product geometry. */
export function shellParameters(spec: Readonly<ShellSpec>) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(spec.id))
    throw new Error("Invalid asset id");
  for (const dimension of [spec.lengthMm, spec.widthMm, spec.heightMm]) {
    if (!Number.isFinite(dimension) || dimension <= 0)
      throw new Error("Dimensions must be finite and positive");
  }
  if (spec.heightMm / spec.lengthMm > 0.55)
    throw new Error("Vertical mice need a separate generator");
  if ((spec.thumbRest || spec.ringFingerRest) && spec.shape !== "ergonomic")
    throw new Error("Rests require an ergonomic shell");
  if (spec.shape !== "symmetrical" && spec.handCompatibility === "ambidextrous")
    throw new Error("Asymmetric shells require handedness");
  const peakU = PEAK[spec.humpPlacement];
  const flare = FLARE[spec.frontFlare];
  const concavity = CONCAVITY[spec.sideCurvature];
  if ([peakU, flare, concavity].some((value) => value === undefined))
    throw new Error("Unknown descriptor");
  if (
    !["symmetrical", "ergonomic", "hybrid"].includes(spec.shape) ||
    !["left", "right", "ambidextrous"].includes(spec.handCompatibility)
  )
    throw new Error("Unknown shape or handedness");
  return {
    id: spec.id,
    model: spec.model,
    length: spec.lengthMm / 1000,
    width: spec.widthMm / 1000,
    height: spec.heightMm / 1000,
    peakU,
    flare,
    concavity,
    tilt:
      spec.shape === "ergonomic" ? 0.115 : spec.shape === "hybrid" ? 0.035 : 0,
    handedness: spec.handCompatibility === "left" ? -1 : 1,
    thumbShelf: spec.thumbRest ? 0.13 : 0,
    ringShelf: spec.ringFingerRest ? 0.07 : 0,
    frontHeight: spec.shape === "ergonomic" ? 0.34 : 0.36,
    rearHeight: 0.1,
    frontCap: 0.115,
    rearCap: 0.25,
  };
}

export type ShellParameters = ReturnType<typeof shellParameters>;
