import "server-only";
import { getDb } from "../../db/client";
import { mice } from "../../db/schema";
import type { FitRepo } from "./repo";
import type { CatalogueMouse } from "./types";

/** The real `FitRepo`, over the Neon HTTP driver. */
export function createDrizzleFitRepo(db = getDb()): FitRepo {
  return {
    async loadCatalogue(): Promise<CatalogueMouse[]> {
      return db
        .select({
          id: mice.id,
          slug: mice.slug,
          brand: mice.brand,
          model: mice.model,
          lengthMm: mice.lengthMm,
          widthMm: mice.widthMm,
          heightMm: mice.heightMm,
          weightG: mice.weightG,
          size: mice.size,
          handCompatibility: mice.handCompatibility,
          shape: mice.shape,
          humpPlacement: mice.humpPlacement,
          frontFlare: mice.frontFlare,
          sideCurvature: mice.sideCurvature,
          thumbRest: mice.thumbRest,
          ringFingerRest: mice.ringFingerRest,
          connectivity: mice.connectivity,
          formFactor: mice.formFactor,
          listed: mice.listed,
        })
        .from(mice);
    },
  };
}
