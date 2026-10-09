import type { CatalogueMouse } from "./types";

/**
 * The catalogue the fit engines see: rows with `listed = false` are removed
 * before anything is scored, so a hidden mouse is neither ranked nor reported
 * as excluded, and both engines (and fit-v1's catalogue-mean priors) are
 * computed over the same list. A row with no `listed` field is listed.
 */
export function listedOnly(
  catalogue: readonly CatalogueMouse[],
): CatalogueMouse[] {
  return catalogue.filter((m) => m.listed !== false);
}
