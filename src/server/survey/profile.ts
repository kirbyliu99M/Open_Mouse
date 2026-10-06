import type { GripStyle } from "../../lib/contracts/fit";
import type { HandMeasurements } from "../../lib/contracts/measurement";
import {
  CONTRIBUTION_BIN_MM,
  type SurveySubmission,
} from "../../lib/contracts/survey";
import { predictGrip } from "../fit/grip";
import type { ContributionWrite } from "./repo";

/**
 * Rounds `mm` DOWN to a multiple of `bin`: the whole of what a contribution
 * keeps of a hand measurement (src/lib/contracts/survey.ts). Never above the
 * real value, never more than `bin` below it.
 *
 * `bin` is a whole number of millimetres (`CONTRIBUTION_BIN_MM`, 5; the
 * column's CHECK holds multiples of 5). For such a bin the product is exact and
 * `mm / bin` never rounds up to the next whole number, so nothing needs
 * correcting afterwards; the test checks the float on either side of every
 * multiple of 5 up to 300. A fractional bin is not safe (17 * 0.1 is
 * 1.7000000000000002, above 1.7): do not pass one without guarding the product.
 */
export function binDown(mm: number, bin: number = CONTRIBUTION_BIN_MM): number {
  return Math.floor(mm / bin) * bin;
}

/**
 * The grip a contribution stores: the one in the body, else the scan's stated
 * grip, else the grip the fit engine used for that scan (`predictGrip`, the
 * same function `scoreFit` calls; `scans.grip_style_predicted` is not written
 * yet, so it is not read). Never empty.
 */
export function resolveStoredGrip(
  bodyGrip: GripStyle | undefined,
  scanGripStated: GripStyle | null,
  measurements: Pick<HandMeasurements, "handLengthMm" | "palmLengthMm">,
): GripStyle {
  return (
    bodyGrip ??
    scanGripStated ??
    predictGrip(measurements.handLengthMm, measurements.palmLengthMm)
  );
}

/** Midnight (UTC) at the start of the day `at` falls on. */
export function startOfUtcDay(at: Date): Date {
  return new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
  );
}

export interface ContributionSource {
  body: SurveySubmission;
  /** The signed-in caller, or null. */
  userId: string | null;
  /** The scan as the server read it; never anything the client sent. */
  scan: {
    gripStyleStated: GripStyle | null;
    measurements: HandMeasurements;
  };
  /** Catalogue slug to `mice.id`, covering every slug in `body.ratings`. */
  mouseIdBySlug: ReadonlyMap<string, string>;
  now: Date;
}

/**
 * The write for one accepted submission. The hand profile is computed here
 * from the scan's own measurements; the body has no field for it. The scan id
 * is carried for the scan's mark only.
 */
export function buildContributionWrite(
  source: ContributionSource,
): ContributionWrite {
  const { body, scan, now } = source;
  return {
    scanId: body.scanId,
    userId: source.userId,
    consentVersion: body.consent.version,
    consentedAt: startOfUtcDay(now),
    markedAt: now,
    handLengthBinMm: binDown(scan.measurements.handLengthMm),
    palmWidthBinMm: binDown(scan.measurements.palmWidthMm),
    gripStyle: resolveStoredGrip(
      body.gripStyle,
      scan.gripStyleStated,
      scan.measurements,
    ),
    mainUse: body.mainUse ?? null,
    feedback: body.feedback ?? null,
    ratings: body.ratings.map((rating) => {
      const mouseId = source.mouseIdBySlug.get(rating.slug);
      if (mouseId === undefined) {
        // The service refuses an unknown slug with a 400 before getting here.
        throw new Error("buildContributionWrite: slug not in the catalogue");
      }
      return {
        mouseId,
        satisfaction: rating.satisfaction,
        duration: rating.duration ?? null,
        painPoints: rating.painPoints,
        isCurrent: rating.current,
      };
    }),
    otherMouse:
      body.otherMouse === undefined
        ? null
        : {
            brand: body.otherMouse.brand,
            sizeFeel: body.otherMouse.sizeFeel,
            isCurrent: body.otherMouse.current,
          },
  };
}
