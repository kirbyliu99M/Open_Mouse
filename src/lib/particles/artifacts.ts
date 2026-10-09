import { renderHandSvg, renderLogoSvg } from "./static-svg";
import { DEFAULT_SEED, buildTargets, serializeTargets } from "./targets";

/** Where the generator reads the mouse sketches from (repo-relative). */
export const SKETCH_DIR = "public/images/sketches";

/** What the generator writes (repo-relative). */
export const ARTIFACT_PATHS = {
  targets: "src/lib/particles/targets.generated.json",
  logo: "public/images/palmate-mark.svg",
  hand: "public/images/hand-on-a4.svg",
} as const;

/**
 * Everything scripts/build-particle-targets.ts writes, as repo-relative path
 * -> file text. Pure, so a test can compare it with the committed files and
 * fail when a sketch or the sampling changes without the outputs being rebuilt.
 */
export function buildArtifacts(
  sketches: Readonly<Record<string, string>>,
  seed = DEFAULT_SEED,
): Record<string, string> {
  const targets = buildTargets(sketches, seed);
  return {
    [ARTIFACT_PATHS.targets]: serializeTargets(targets),
    [ARTIFACT_PATHS.logo]: renderLogoSvg(),
    [ARTIFACT_PATHS.hand]: renderHandSvg(targets.hand),
  };
}
