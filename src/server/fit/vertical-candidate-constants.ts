/**
 * Every tunable number of the vertical-mouse CANDIDATE scorer, in one place.
 *
 * STATUS: 未拍板（candidate）. Nothing here is wired into `scoreFit`, no
 * ranking uses it, `ENGINE_VERSION` is untouched. It exists so Kirby can read
 * the spike report (`scripts/vertical-spike.ts`) and decide whether to go on.
 *
 * Honesty rule for this file: for every number below the comment says what it
 * is. "No basis, only a starting point" means exactly that. There is no
 * vertical-grip data in this project (no ratings, no side photos), so none of
 * these were fitted to anything.
 */

/** What a candidate target is measured from. Only top-down fields exist. */
export type VerticalTargetSource =
  "handLengthMm" | "palmLengthMm" | "palmWidthMm";

export interface VerticalTargetRule {
  /** The hand measurement the target scales from. */
  source: VerticalTargetSource;
  /** target (mm) = hand[source] × factor. */
  factor: number;
}

export interface VerticalCandidateConfig {
  targets: {
    length: VerticalTargetRule;
    height: VerticalTargetRule;
    widthProxy: VerticalTargetRule;
  };
  sigmaMm: { length: number; height: number; widthProxy: number };
  weights: { length: number; height: number; widthProxy: number };
}

/**
 * Mapping A (the candidate's default). Reasoning, per dimension:
 *
 * - length = handLength × 0.60. In a handshake grip the fingers run along the
 *   mouse's length, as in a horizontal grip, so length still scales with hand
 *   length. The horizontal model uses 0.58–0.66 by grip; 0.60 is a round
 *   number just under the palm-grip value. NO BASIS, only a starting point.
 *   Disclosure: I computed what 0.60 implies for the two catalogue mice
 *   (108 mm and 120 mm ideal at hand length 180 and 200 mm) before keeping it,
 *   so the official-guidance check in the report is not independent of it.
 *
 * - height = palmWidth × 0.90. With the hand turned on its side the palm's
 *   width axis (index knuckle to little-finger knuckle) becomes the vertical
 *   extent the mouse has to fill, so height is tied to palm width, not to hand
 *   length. 0.90 is a round number below 1 because the mouse top is cupped,
 *   not spanned. NO BASIS, only a starting point.
 *
 * - widthProxy = palmWidth × 0.88. The true counterpart of mouse width in this
 *   grip is the thickness of the hand, and the contract's top-down fields do
 *   not carry it (and this spike must not assume side-shot fields). Palm width
 *   is a PROXY: it only says "bigger hands tend to be thicker". 0.88 is copied
 *   from the horizontal GRIP_WIDTH_FACTOR as a placeholder, nothing more.
 *   This is why widthProxy has the lowest weight and a name saying so.
 */
export const VERTICAL_CONFIG_A: VerticalCandidateConfig = {
  targets: {
    length: { source: "handLengthMm", factor: 0.6 },
    height: { source: "palmWidthMm", factor: 0.9 },
    widthProxy: { source: "palmWidthMm", factor: 0.88 },
  },
  /**
   * Sigmas (mm). The only two vertical mice differ by 12 mm in length, 7.5 mm
   * in height and 9 mm in width, so sigmas near those spacings keep the scores
   * from saturating at 0 or 100 for every hand. Same idea as the horizontal
   * model's sigmas (6 / 3 / 5) but wider, because the target itself is less
   * certain here. NO BASIS, only a starting point.
   */
  sigmaMm: { length: 8, height: 5, widthProxy: 6 },
  /**
   * Weights: length and height count equally, the proxy counts half as much.
   * Sum to 1 so the total reads like a mean. NO BASIS.
   */
  weights: { length: 0.4, height: 0.4, widthProxy: 0.2 },
};

/**
 * Mapping B (spike comparison only, never a default): the starting point
 * suggested in the task brief, "hand length ↔ mouse height, palm width ↔ mouse
 * width". 0.40 puts height 72 mm at hand length 180 mm. Kept to show how much
 * the ranking depends on which hand dimension the height is tied to.
 * NO BASIS.
 */
export const VERTICAL_CONFIG_B: VerticalCandidateConfig = {
  ...VERTICAL_CONFIG_A,
  targets: {
    length: { source: "handLengthMm", factor: 0.6 },
    height: { source: "handLengthMm", factor: 0.4 },
    widthProxy: { source: "palmWidthMm", factor: 0.88 },
  },
};

/**
 * |delta| at or under this fraction of sigma reads as "close" in the reason
 * code. Same choice as the horizontal model's IDEAL_SIGMA_FRACTION (0.5), a
 * documented convention, not a derived value.
 */
export const VERTICAL_CLOSE_SIGMA_FRACTION = 0.5;

/** Marks every output of this module as not decided. */
export const VERTICAL_CANDIDATE_STATUS = "candidate" as const;
