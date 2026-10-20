import type {
  FitFeel,
  FitPreferences,
  FitReference,
  GripStyle,
} from "../../lib/contracts/fit";
import type { PainPoint } from "../../lib/contracts/survey";
import {
  adoptedReferenceCount,
  adoptedReferences,
} from "./calibration-v3-candidate";
import type { EngineId } from "./coefficients";
import type { CatalogueMouse } from "./types";

/**
 * Calibration from the survey (Kirby, 2026-10-20; every number and rule here is
 * a candidate, 未拍板). A signed-in person who rated catalogue mice in the
 * survey gets those ratings turned into the same `FitReference`s a request
 * could carry, so the v3 engine calibrates their own result with its existing
 * rules. There is no input screen for it.
 *
 * Privacy: the references live for one request. Nothing here writes them to a
 * table, a log or analytics, and nothing logs a slug or a satisfaction.
 */

/**
 * The fewest voices that switch the calibration on. With one mouse the
 * population simulation showed the offset often made an accurate result worse,
 * so a single rating does nothing. Counted on what the engine would really use
 * (`adoptedReferenceCount`), not on how many ratings the person gave.
 * Candidate, 未拍板.
 */
export const MIN_AUTO_CALIBRATION_REFERENCES = 2;

/** `fitCalibrationSchema.referencesUsed` and `fitPreferencesSchema.references` both stop at 8. */
const MAX_AUTO_CALIBRATION_REFERENCES = 8;

/** A rating of at least this many stars says the mouse fit; below it we cannot tell too big from too small. */
const FIT_SATISFACTION_MIN = 4;

/**
 * What the survey keeps about one rating of a catalogue mouse, as far as
 * calibration reads it: the mouse's slug, the stars, what bothered the person,
 * and the grip stored with the contribution the rating belongs to.
 */
export interface SurveyRatingForCalibration {
  slug: string;
  satisfaction: number;
  painPoints: readonly PainPoint[];
  gripStyle: GripStyle | null;
}

/**
 * The DB seam for the survey's side of calibration. A signed-in person's
 * ratings of catalogue mice, newest contribution first (a mouse the person
 * rated again appears once, with the latest answer).
 */
export interface SurveyReferenceSource {
  loadRatings(userId: string): Promise<SurveyRatingForCalibration[]>;
}

/**
 * Survey ratings to references. Pure.
 *
 * - satisfaction 4 or 5: the mouse fit. Each of length, width and height is
 *   "just right" (0), except a dimension the person named in `painPoints`,
 *   which becomes null (it bothered them, in an unknown direction, so it says
 *   nothing). `weight`, `thumb`, `buttons` and `other` do not touch the three
 *   dimensions.
 * - satisfaction 3 or less: not used, since it is not known whether the mouse
 *   felt too large or too small.
 * - `grips` is the stored grip when there is one, else empty (the engine then
 *   judges it in the grip it uses for this hand).
 * - `specialUse` is false: the survey has no such question.
 *
 * A slug rated twice keeps its first entry (the caller passes newest first).
 */
export function surveyRatingsToReferences(
  ratings: readonly SurveyRatingForCalibration[],
): FitReference[] {
  const seen = new Set<string>();
  const out: FitReference[] = [];
  for (const rating of ratings) {
    if (seen.has(rating.slug)) continue;
    seen.add(rating.slug);
    if (rating.satisfaction < FIT_SATISFACTION_MIN) continue;
    const feel = (dimension: PainPoint): FitFeel =>
      rating.painPoints.includes(dimension) ? null : 0;
    out.push({
      slug: rating.slug,
      grips: rating.gripStyle ? [rating.gripStyle] : [],
      feel: {
        length: feel("length"),
        width: feel("width"),
        height: feel("height"),
      },
      specialUse: false,
    });
  }
  return out;
}

/**
 * The references to calibrate with, or an empty list when the survey does not
 * give enough: those the engine would really use (listed, not special-use,
 * length/width model applies, answered at least one dimension), at most 8, and
 * only when they make `MIN_AUTO_CALIBRATION_REFERENCES` voices after the
 * same-shell models are counted once. Pure.
 */
export function autoCalibrationReferences(
  ratings: readonly SurveyRatingForCalibration[],
  catalogue: readonly CatalogueMouse[],
): FitReference[] {
  const adopted = adoptedReferences(
    surveyRatingsToReferences(ratings),
    catalogue,
  ).slice(0, MAX_AUTO_CALIBRATION_REFERENCES);
  return adoptedReferenceCount(adopted, catalogue) >=
    MIN_AUTO_CALIBRATION_REFERENCES
    ? adopted
    : [];
}

/**
 * What `loadOwnedFit` asks: the references that go into this request's
 * preferences, or `undefined` for "leave the preferences as they are".
 *
 * The survey is read only when all of these hold, and not otherwise (no query
 * at all): the engine in use is v3 (no other engine reads references), the
 * caller is signed in, the request carries no `references` of its own (an
 * explicit list, even an empty one, is the request's choice and wins), and a
 * source is wired.
 */
export async function surveyReferencesFor(args: {
  engine: EngineId;
  userId: string | null;
  prefs: FitPreferences;
  catalogue: readonly CatalogueMouse[];
  source: SurveyReferenceSource | undefined;
}): Promise<FitReference[] | undefined> {
  const { engine, userId, prefs, catalogue, source } = args;
  if (engine !== "v3" || userId === null || source === undefined) {
    return undefined;
  }
  if (prefs.references !== undefined) return undefined;
  const references = autoCalibrationReferences(
    await source.loadRatings(userId),
    catalogue,
  );
  return references.length > 0 ? references : undefined;
}
