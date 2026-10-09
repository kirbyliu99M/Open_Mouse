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
  /**
   * How the optional palm-thickness input is used. Absent = "none": the input
   * is ignored and the result is bit-for-bit the phase-1 result.
   */
  thickness?: ThicknessWiring;
}

// ── palm thickness (phase 2, 未拍板) ───────────────────────────────────────

/**
 * Three-way palm thickness the user would pick. LOCAL type for this spike: it
 * will map onto a contract field (`palmThickness`) in a separate contract PR
 * that Claude owns. Nothing here says how many mm "thick" is: there is no
 * human data in this project for that, and none is claimed.
 */
export type PalmThicknessLevel = "thin" | "medium" | "thick";

export const PALM_THICKNESS_LEVELS: readonly PalmThicknessLevel[] = [
  "thin",
  "medium",
  "thick",
];

/** Ordinal of each level: the only thing wiring A reads. */
export const PALM_THICKNESS_ORDINAL: Record<PalmThicknessLevel, -1 | 0 | 1> = {
  thin: -1,
  medium: 0,
  thick: 1,
};

/**
 * PLACEHOLDER relative thickness scale for wiring B: thin 0.85, medium 1.0,
 * thick 1.15. An ARBITRARY choice, symmetric round numbers, NO BASIS. It is a
 * dimensionless ratio against "medium"; it is not a millimetre claim.
 */
export const PALM_THICKNESS_SCALE_PLACEHOLDER: Record<
  PalmThicknessLevel,
  number
> = { thin: 0.85, medium: 1, thick: 1.15 };

/** The cross-section quantity wiring B compares (see the sections module). */
export type SectionQuantity =
  "minFeretMm" | "minRectShortMm" | "outerGirthMm" | "widthAxisMm";

/**
 * Wiring A: direction prior. Every size target is multiplied by
 * `1 − stepPerOrdinal × ordinal` (thick → smaller targets, thin → larger).
 * Wiring B: the width-proxy slot is replaced by a cross-section quantity of the
 * mouse compared with a thickness-dependent target. See `makeSectionWiring`.
 */
export type ThicknessWiring =
  | { kind: "none" }
  | { kind: "prior"; stepPerOrdinal: number }
  | {
      kind: "section";
      quantity: SectionQuantity;
      /** ny values whose quantity is averaged. */
      stations: readonly number[];
      /** target (mm) = palmWidth × ratio × scale[level] ^ direction. */
      ratioToPalmWidth: number;
      /**
       * −1: a thicker hand → a smaller target section (the direction prior);
       * +1: the opposite (a thicker hand fills a bigger section). The sign is
       * exactly what the project does not know, so both are kept comparable.
       */
      direction: 1 | -1;
      scale: Record<PalmThicknessLevel, number>;
      sigmaMm: number;
    };

/**
 * Wiring A step. The ONLY evidence is one third-party sentence about a
 * different mouse class (Contour Perfit sizing page, ergocanada.com: a hand
 * between two sizes, "relatively thin" → larger size, "thick palm" → smaller
 * size). It supports a direction, not a size. 0.05 per ordinal step is a small
 * nudge on purpose: 5 % of a 108 mm length target is about 5 mm, well under the
 * 12 mm gap between the two catalogue mice and under one length sigma (8 mm).
 * NO BASIS for the number; only the sign has a (weak, off-class) source.
 */
export const THICKNESS_PRIOR_STEP = 0.05;

/**
 * Wiring B reference ratios: section quantity ÷ palm width at "medium"
 * thickness. NO BASIS. DISCLOSURE: I computed the station-mean of each
 * quantity for the two catalogue mice first (min Feret 66.5 / 58.7 mm, rect
 * short side 70.4 / 58.8 mm, girth 243 / 223 mm, axis width 75.7 / 67.9 mm for
 * MX / Lift) and picked round ratios that put a palm width of ~85 mm between
 * the two, as with the phase-1 factors. The ratios are therefore NOT
 * independent of the two mice and carry no evidence of their own.
 */
export const SECTION_RATIO_TO_PALM_WIDTH: Record<SectionQuantity, number> = {
  minFeretMm: 0.75,
  minRectShortMm: 0.75,
  outerGirthMm: 2.75,
  widthAxisMm: 0.85,
};

/**
 * Wiring B sigma (mm). Same value as the width-proxy sigma (6): a placeholder,
 * NO BASIS. For girth (≈ 230 mm) 6 mm is far tighter in relative terms than for
 * min Feret (≈ 60 mm); `makeSectionWiring` therefore scales it with the ratio.
 */
export const SECTION_SIGMA_MM = 6;

/** Candidate grip stations averaged by default (see the sections module). */
export const SECTION_DEFAULT_STATIONS: readonly number[] = [0.4, 0.5, 0.6, 0.7];

export function makeSectionWiring(
  options: {
    quantity?: SectionQuantity;
    stations?: readonly number[];
    direction?: 1 | -1;
    scale?: Record<PalmThicknessLevel, number>;
    ratioToPalmWidth?: number;
    sigmaMm?: number;
  } = {},
): Extract<ThicknessWiring, { kind: "section" }> {
  const quantity = options.quantity ?? "minFeretMm";
  const ratio =
    options.ratioToPalmWidth ?? SECTION_RATIO_TO_PALM_WIDTH[quantity];
  return {
    kind: "section",
    quantity,
    stations: options.stations ?? SECTION_DEFAULT_STATIONS,
    ratioToPalmWidth: ratio,
    direction: options.direction ?? -1,
    scale: options.scale ?? PALM_THICKNESS_SCALE_PLACEHOLDER,
    // Scale the sigma with the quantity's size relative to min Feret's ratio
    // (0.75), so every quantity gets the same RELATIVE width.
    sigmaMm: options.sigmaMm ?? SECTION_SIGMA_MM * (ratio / 0.75),
  };
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
 * Wiring C (control): no thickness input used. Identical to mapping A; the
 * thickness field of the hand is ignored even when given.
 */
export const VERTICAL_WIRING_C_NONE: VerticalCandidateConfig =
  VERTICAL_CONFIG_A;

/** Wiring A: size targets nudged against thickness (direction prior). */
export const VERTICAL_WIRING_A_PRIOR: VerticalCandidateConfig = {
  ...VERTICAL_CONFIG_A,
  thickness: { kind: "prior", stepPerOrdinal: THICKNESS_PRIOR_STEP },
};

/** Wiring B: width-proxy slot ← mean min-Feret of the mouse's grip stations. */
export const VERTICAL_WIRING_B_SECTION: VerticalCandidateConfig = {
  ...VERTICAL_CONFIG_A,
  thickness: makeSectionWiring(),
};

/**
 * Wiring B with the opposite sign (thicker hand → larger target section).
 * A contrast row for the report, never a candidate default.
 */
export const VERTICAL_WIRING_B_REVERSED: VerticalCandidateConfig = {
  ...VERTICAL_CONFIG_A,
  thickness: makeSectionWiring({ direction: 1 }),
};

/**
 * |delta| at or under this fraction of sigma reads as "close" in the reason
 * code. Same choice as the horizontal model's IDEAL_SIGMA_FRACTION (0.5), a
 * documented convention, not a derived value.
 */
export const VERTICAL_CLOSE_SIGMA_FRACTION = 0.5;

/** Marks every output of this module as not decided. */
export const VERTICAL_CANDIDATE_STATUS = "candidate" as const;
