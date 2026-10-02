/**
 * Grip-threshold calibration, report only. Pure.
 *
 * The product predicts a grip from r = palmLength / handLength
 * (`predictGrip` in src/server/fit/grip.ts; thresholds `GRIP_PREDICTION` in
 * src/server/fit/coefficients.ts): palm at r >= 0.58, claw at r >= 0.54,
 * otherwise fingertip. Here each participant's r (their mean over G02 photos,
 * on the same landmarks the product uses: palm = wrist to middle MCP, hand =
 * wrist to middle fingertip) is set against the grip they said they use. The
 * report gives:
 *  - the confusion matrix of self-reported against predicted grip with the
 *    CURRENT thresholds, and its agreement rate;
 *  - the pair of thresholds that maximises agreement on the evaluated people,
 *    with the counts behind it.
 *
 * It never changes `GRIP_PREDICTION`. Moving it is a separate decision, and
 * a pair chosen on the very people it is scored on is optimistic by
 * construction: the report says so and nothing here decides anything.
 */
import { GRIP_STYLES, type GripStyle } from "../contracts/fit";
import { GRIP_PREDICTION } from "../../server/fit/coefficients";

export type GripClass = GripStyle;
export const GRIP_CLASSES: readonly GripClass[] = GRIP_STYLES;

export interface GripThresholds {
  /** r at or above this: palm. */
  readonly palmAtOrAbove: number;
  /** r at or above this (and below `palmAtOrAbove`): claw; below it: fingertip. */
  readonly clawAtOrAbove: number;
}

/** The thresholds the product uses today, read from its own constant (never copied). */
export const CURRENT_GRIP_THRESHOLDS: GripThresholds = {
  palmAtOrAbove: GRIP_PREDICTION.palmAtOrAbove,
  clawAtOrAbove: GRIP_PREDICTION.clawAtOrAbove,
};

/** The grip a ratio r predicts under a pair of thresholds: the product's rule with the numbers made a parameter. */
export function gripFromRatio(
  r: number,
  thresholds: GripThresholds = CURRENT_GRIP_THRESHOLDS,
): GripClass {
  if (r >= thresholds.palmAtOrAbove) return "palm";
  if (r >= thresholds.clawAtOrAbove) return "claw";
  return "fingertip";
}

export interface GripSample {
  readonly participant: string;
  /** What the participant said: palm, claw or fingertip (never "unsure"; those are left out before this). */
  readonly self: GripClass;
  /** palmLength / handLength, the person's mean over their G02 photos. */
  readonly ratio: number;
}

/** matrix[self][predicted] = number of people. */
export type ConfusionMatrix = Readonly<
  Record<GripClass, Readonly<Record<GripClass, number>>>
>;

export interface GripAgreement {
  readonly thresholds: GripThresholds;
  readonly people: number;
  /** People whose predicted grip equals the one they reported. */
  readonly agree: number;
  /** agree / people; `null` for nobody. */
  readonly rate: number | null;
  readonly matrix: ConfusionMatrix;
}

function emptyMatrix(): Record<GripClass, Record<GripClass, number>> {
  const row = () => ({ palm: 0, claw: 0, fingertip: 0 });
  return { palm: row(), claw: row(), fingertip: row() };
}

/** Self-reported against predicted grip for a pair of thresholds. */
export function gripAgreement(
  samples: readonly GripSample[],
  thresholds: GripThresholds = CURRENT_GRIP_THRESHOLDS,
): GripAgreement {
  const matrix = emptyMatrix();
  let agree = 0;
  for (const s of samples) {
    const predicted = gripFromRatio(s.ratio, thresholds);
    matrix[s.self][predicted] += 1;
    if (predicted === s.self) agree += 1;
  }
  return {
    thresholds,
    people: samples.length,
    agree,
    rate: samples.length === 0 ? null : agree / samples.length,
    matrix,
  };
}

export interface BestGripThresholds {
  /** The pair that agrees most; among equals, the one nearest the current pair. */
  readonly agreement: GripAgreement;
  /** How many pairs (of the distinct cut positions) reach that same agreement: a large number means the data do not pin the thresholds down. */
  readonly tiedPairs: number;
}

/** How far outside the observed r the end cuts sit, so that "everyone above" and "everyone below" are pairs too. */
const END_MARGIN = 0.0005;

/**
 * The pair of thresholds (palm >= claw) that maximises agreement on these
 * people. Agreement only changes where a threshold passes an observed r, so
 * the search is over the cuts between distinct sorted r values, plus the two
 * ends; a threshold is the midpoint between the two r values it separates
 * (0.0005 beyond the observed range at an end). Ties are broken toward the
 * current thresholds (smallest total distance), then toward the lower pair.
 */
export function bestGripThresholds(
  samples: readonly GripSample[],
  current: GripThresholds = CURRENT_GRIP_THRESHOLDS,
): BestGripThresholds | null {
  const n = samples.length;
  if (n === 0) return null;
  const sorted = [...samples].sort(
    (a, b) => a.ratio - b.ratio || a.participant.localeCompare(b.participant),
  );

  // Prefix counts of each self-reported grip over the sorted people.
  const prefix = (grip: GripClass): number[] => {
    const out = [0];
    for (const s of sorted)
      out.push(out[out.length - 1]! + (s.self === grip ? 1 : 0));
    return out;
  };
  const fingertip = prefix("fingertip");
  const claw = prefix("claw");
  const palm = prefix("palm");

  // A cut at k puts the first k people below it. It may not split equal r values.
  const cuts: { k: number; value: number }[] = [];
  for (let k = 0; k <= n; k++) {
    if (k > 0 && k < n && sorted[k - 1]!.ratio === sorted[k]!.ratio) continue;
    const value =
      k === 0
        ? sorted[0]!.ratio - END_MARGIN
        : k === n
          ? sorted[n - 1]!.ratio + END_MARGIN
          : (sorted[k - 1]!.ratio + sorted[k]!.ratio) / 2;
    cuts.push({ k, value });
  }

  let best = -1;
  let tied = 0;
  interface Pick {
    readonly low: number;
    readonly high: number;
    readonly distance: number;
  }
  let pick: Pick | null = null;
  for (let a = 0; a < cuts.length; a++) {
    for (let b = a; b < cuts.length; b++) {
      const low = cuts[a]!; // below it: fingertip
      const high = cuts[b]!; // from it up: palm
      const agree =
        fingertip[low.k]! +
        (claw[high.k]! - claw[low.k]!) +
        (palm[n]! - palm[high.k]!);
      const distance =
        Math.abs(high.value - current.palmAtOrAbove) +
        Math.abs(low.value - current.clawAtOrAbove);
      if (agree > best) {
        best = agree;
        tied = 1;
        pick = { low: low.value, high: high.value, distance };
      } else if (agree === best) {
        tied += 1;
        const p: Pick = pick!;
        if (
          distance < p.distance ||
          (distance === p.distance &&
            (high.value < p.high ||
              (high.value === p.high && low.value < p.low)))
        ) {
          pick = { low: low.value, high: high.value, distance };
        }
      }
    }
  }
  const chosen = pick!;
  return {
    agreement: gripAgreement(samples, {
      palmAtOrAbove: chosen.high,
      clawAtOrAbove: chosen.low,
    }),
    tiedPairs: tied,
  };
}

export interface GripCalibration {
  /** The thresholds the product uses today, and how the people's reports fare against them. */
  readonly current: GripAgreement;
  readonly best: BestGripThresholds;
}

/** Both views at once; `null` for nobody. */
export function calibrateGrip(
  samples: readonly GripSample[],
  current: GripThresholds = CURRENT_GRIP_THRESHOLDS,
): GripCalibration | null {
  const best = bestGripThresholds(samples, current);
  if (best === null) return null;
  return { current: gripAgreement(samples, current), best };
}
