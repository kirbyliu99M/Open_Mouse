/**
 * Per-person statistics for protocol agreed-v2. Pure numbers in, numbers out.
 *
 * The one rule of this file: a person is the unit, a photo is not. Where a
 * statistic compares people (a bias, an SD, a distribution), the photos of
 * each person are averaged first and the statistic is taken over those
 * person-level means. The only statistics taken over photos are the ones
 * labelled "photo-level", and the within-person SDs that exist to measure how
 * far one person's own photos spread.
 *
 * Wording: these numbers are "agreement with the marker-sheet reference" and
 * "retake repeatability". No ruler exists under agreed-v2, so nothing here is
 * an accuracy.
 *
 * Definitions (frozen prereg version 2, 2026-10-02, section 2):
 *  - G02 repeatability  pooled within-person SD of hand length, marker path:
 *                       sqrt(sum((n_i - 1) * SD_i^2) / sum(n_i - 1)) over the
 *                       people with at least two G02 photos. Report only:
 *                       1.0 mm is a reference value, not a pass/fail
 *                       threshold (version 1 made it a criterion; Kirby
 *                       dropped that on 2026-10-02).
 *  - path agreement     paper-edge hand length minus marker hand length, per
 *                       G02 photo; averaged within each person; then the bias
 *                       and SD across people. Report only.
 *  - curl ratio         a G04 photo's wrist-to-middle-fingertip length
 *                       projected on the marker plane, divided by the same
 *                       person's mean G02 hand length. Report only.
 *  - product-gate rate  accepted divided by all, per pose. Report only.
 *  - coverage           hand-length distribution in 10 mm bins; counts by
 *                       phone, sheet and mouse hand. Report only.
 */
import {
  mean,
  repeatabilityRow,
  sampleSd,
  summariseRepeatability,
} from "./stats";

/**
 * The reference value for the pooled SD of G02 hand length, mm. From the
 * frozen prereg (version 2, section 2); it is shown next to the number and
 * never turned into a verdict. It was derived from the PLAN's +/-1.5 mm over
 * 5 photos, not from the literature.
 */
export const G02_REPEATABILITY_REFERENCE_MM = 1.0 as const;

/** Bin width of the coverage histogram, mm. */
export const HAND_LENGTH_BIN_MM = 10 as const;

// ── Distribution ────────────────────────────────────────────────────────────

/** Quantile of an ascending list by linear interpolation (the usual "type 7"); `null` for an empty list. */
export function quantileOfSorted(
  sorted: readonly number[],
  p: number,
): number | null {
  if (sorted.length === 0) return null;
  if (p < 0 || p > 1) throw new RangeError("p must be between 0 and 1");
  const position = (sorted.length - 1) * p;
  const below = Math.floor(position);
  const above = Math.ceil(position);
  const fraction = position - below;
  return sorted[below]! + (sorted[above]! - sorted[below]!) * fraction;
}

export interface Distribution {
  readonly n: number;
  readonly mean: number;
  /** Sample SD (n - 1); `null` for one value. */
  readonly sd: number | null;
  readonly min: number;
  readonly q1: number;
  readonly median: number;
  readonly q3: number;
  readonly max: number;
}

export function distributionOf(values: readonly number[]): Distribution | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: values.length,
    mean: mean(values),
    sd: sampleSd(values),
    min: sorted[0]!,
    q1: quantileOfSorted(sorted, 0.25)!,
    median: quantileOfSorted(sorted, 0.5)!,
    q3: quantileOfSorted(sorted, 0.75)!,
    max: sorted[sorted.length - 1]!,
  };
}

/** Within-group SD pooled over groups of at least two values: sqrt(sum((n-1) SD^2) / sum(n-1)). */
function pooledSdOf(groups: readonly (readonly number[])[]): {
  readonly people: number;
  readonly photos: number;
  readonly degreesOfFreedom: number;
  readonly pooledSd: number | null;
  readonly meanSd: number | null;
} {
  const rows = groups
    .map((values) => repeatabilityRow(values))
    .filter((r): r is NonNullable<typeof r> => r !== null);
  const summary = summariseRepeatability(rows);
  return {
    people: rows.length,
    photos: rows.reduce((sum, r) => sum + r.n, 0),
    degreesOfFreedom: rows.reduce((sum, r) => sum + (r.n - 1), 0),
    pooledSd: summary ? summary.pooledSd : null,
    meanSd: summary ? summary.meanSd : null,
  };
}

// ── G02 repeatability ───────────────────────────────────────────────────────

export interface PersonValues {
  readonly participant: string;
  readonly values: readonly number[];
}

export interface PersonRepeat {
  readonly participant: string;
  readonly photos: number;
  readonly meanMm: number;
  /** Sample SD of the person's photos; `null` with a single photo. */
  readonly sdMm: number | null;
  /** max - min; `null` with a single photo. */
  readonly rangeMm: number | null;
}

export interface G02Repeatability {
  /** People with at least one usable G02 photo. */
  readonly peopleWithPhotos: number;
  /** Their photos, all of them. */
  readonly photos: number;
  /** People with two or more photos: the people the pooled SD is made of. */
  readonly people: number;
  /** The photos of those people. */
  readonly photosBehindSd: number;
  /** sum(n - 1) over those people. */
  readonly degreesOfFreedom: number;
  readonly pooledSdMm: number | null;
  /** Mean of the people's own SDs (not the pooled SD; shown next to it). */
  readonly meanSdMm: number | null;
  readonly worstRangeMm: number | null;
  /** The prereg's reference value for the pooled SD, mm. Report only: no verdict is drawn from it. */
  readonly referenceMm: typeof G02_REPEATABILITY_REFERENCE_MM;
  readonly rows: readonly PersonRepeat[];
}

/** Retake repeatability of hand length over people, each with the values of their G02 photos. */
export function g02Repeatability(
  people: readonly PersonValues[],
): G02Repeatability {
  const withPhotos = people.filter((p) => p.values.length > 0);
  const pooled = pooledSdOf(withPhotos.map((p) => p.values));
  const rows: PersonRepeat[] = withPhotos
    .map((p) => {
      const r = repeatabilityRow(p.values);
      return {
        participant: p.participant,
        photos: p.values.length,
        meanMm: mean(p.values),
        sdMm: r ? r.sd : null,
        rangeMm: r ? r.range : null,
      };
    })
    .sort((a, b) => a.participant.localeCompare(b.participant));
  const worst = rows.reduce<number | null>(
    (w, r) => (r.rangeMm === null ? w : Math.max(w ?? 0, r.rangeMm)),
    null,
  );
  return {
    peopleWithPhotos: withPhotos.length,
    photos: withPhotos.reduce((sum, p) => sum + p.values.length, 0),
    people: pooled.people,
    photosBehindSd: pooled.photos,
    degreesOfFreedom: pooled.degreesOfFreedom,
    pooledSdMm: pooled.pooledSd,
    meanSdMm: pooled.meanSd,
    worstRangeMm: worst,
    referenceMm: G02_REPEATABILITY_REFERENCE_MM,
    rows,
  };
}

// ── Path agreement ──────────────────────────────────────────────────────────

export interface PersonDifferences {
  readonly participant: string;
  /** paper-edge minus marker hand length, one per G02 photo measured on both paths, mm. */
  readonly differences: readonly number[];
}

export interface Agreement {
  /** People (person-level) or photos (photo-level). */
  readonly n: number;
  /** Mean difference, mm. */
  readonly biasMm: number;
  /** Sample SD of the differences (n - 1); `null` for one. */
  readonly sdMm: number | null;
}

export interface PathAgreement {
  /** Over people: each person's photos averaged first. */
  readonly personLevel: Agreement | null;
  /** Over photos, as if independent: for the record, never the headline. */
  readonly photoLevel: Agreement | null;
  readonly rows: readonly {
    readonly participant: string;
    readonly photos: number;
    readonly meanDifferenceMm: number;
  }[];
}

export function pathAgreement(
  people: readonly PersonDifferences[],
): PathAgreement {
  const withPhotos = people.filter((p) => p.differences.length > 0);
  const rows = withPhotos
    .map((p) => ({
      participant: p.participant,
      photos: p.differences.length,
      meanDifferenceMm: mean(p.differences),
    }))
    .sort((a, b) => a.participant.localeCompare(b.participant));
  const personMeans = rows.map((r) => r.meanDifferenceMm);
  const photoValues = withPhotos.flatMap((p) => [...p.differences]);
  const summary = (values: readonly number[]): Agreement | null =>
    values.length === 0
      ? null
      : { n: values.length, biasMm: mean(values), sdMm: sampleSd(values) };
  return {
    personLevel: summary(personMeans),
    photoLevel: summary(photoValues),
    rows,
  };
}

// ── Curl ratio ──────────────────────────────────────────────────────────────

export interface CurlPerson {
  readonly participant: string;
  /** Marker-plane hand length of each usable G02 photo, mm. */
  readonly g02LengthsMm: readonly number[];
  /** Marker-plane wrist-to-middle-fingertip length of each usable G04 photo, mm. */
  readonly g04ProjectedMm: readonly number[];
}

export interface CurlRow {
  readonly participant: string;
  readonly g02Photos: number;
  readonly g04Photos: number;
  readonly g02MeanMm: number;
  /** Mean of the person's G04 ratios. */
  readonly meanRatio: number;
  /** Sample SD of the person's G04 ratios (their retake variation); `null` with one G04 photo. */
  readonly sdRatio: number | null;
}

export interface CurlRatios {
  /** People with both a G02 mean and at least one G04 photo. */
  readonly people: number;
  readonly photos: number;
  /** Distribution over people of each person's mean ratio. */
  readonly distribution: Distribution | null;
  /** Retake variation: the people with two or more G04 photos. */
  readonly withinPerson: {
    readonly people: number;
    readonly photos: number;
    readonly pooledSd: number | null;
    readonly meanSd: number | null;
  };
  /** People left out because they lack one of the two poses. */
  readonly skipped: { readonly noG02: number; readonly noG04: number };
  readonly rows: readonly CurlRow[];
}

/**
 * The curl ratio, per person and overall. A person's denominator is the mean
 * of their own G02 hand lengths, so scale cancels (both come from the same
 * sheet); the numerator is each G04 photo's projected wrist-to-fingertip
 * length.
 */
export function curlRatios(people: readonly CurlPerson[]): CurlRatios {
  const rows: CurlRow[] = [];
  const ratiosByPerson: number[][] = [];
  let noG02 = 0;
  let noG04 = 0;
  for (const p of people) {
    if (p.g02LengthsMm.length === 0 && p.g04ProjectedMm.length === 0) continue;
    if (p.g02LengthsMm.length === 0) {
      noG02++;
      continue;
    }
    if (p.g04ProjectedMm.length === 0) {
      noG04++;
      continue;
    }
    const g02Mean = mean(p.g02LengthsMm);
    const ratios = p.g04ProjectedMm.map((v) => v / g02Mean);
    ratiosByPerson.push(ratios);
    rows.push({
      participant: p.participant,
      g02Photos: p.g02LengthsMm.length,
      g04Photos: ratios.length,
      g02MeanMm: g02Mean,
      meanRatio: mean(ratios),
      sdRatio: sampleSd(ratios),
    });
  }
  const order = rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.participant.localeCompare(b.r.participant));
  const sortedRows = order.map((o) => o.r);
  const sortedRatios = order.map((o) => ratiosByPerson[o.i]!);
  const within = pooledSdOf(sortedRatios);
  return {
    people: sortedRows.length,
    photos: sortedRatios.reduce((sum, r) => sum + r.length, 0),
    distribution: distributionOf(sortedRows.map((r) => r.meanRatio)),
    withinPerson: {
      people: within.people,
      photos: within.photos,
      pooledSd: within.pooledSd,
      meanSd: within.meanSd,
    },
    skipped: { noG02, noG04 },
    rows: sortedRows,
  };
}

// ── Product-gate acceptance, per pose ───────────────────────────────────────

export interface PoseObservation {
  readonly gesture: string;
  /** The product's own gates would take the photo. */
  readonly accepted: boolean;
  /** MediaPipe found a hand. */
  readonly handDetected: boolean;
  /** MediaPipe's hand label against the hand the participant record gives; `null` when either is unknown. */
  readonly handLabel: "agrees" | "differs" | null;
}

export interface PoseRate {
  readonly gesture: string;
  /** All photos of the pose, whatever happened to them. */
  readonly photos: number;
  readonly accepted: number;
  /** accepted / photos; `null` for no photo. */
  readonly acceptedRate: number | null;
  readonly handDetected: number;
  readonly detectionRate: number | null;
  /** Photos where both the label and the recorded hand are known. */
  readonly handLabelChecked: number;
  readonly handLabelAgrees: number;
  readonly handLabelAgreementRate: number | null;
}

const rate = (part: number, whole: number): number | null =>
  whole === 0 ? null : part / whole;

/** One row per requested pose, in the order given (a pose with no photo has zeros and `null` rates). */
export function poseRates(
  observations: readonly PoseObservation[],
  poses: readonly string[],
): PoseRate[] {
  return poses.map((gesture) => {
    const here = observations.filter((o) => o.gesture === gesture);
    const accepted = here.filter((o) => o.accepted).length;
    const detected = here.filter((o) => o.handDetected).length;
    const checked = here.filter((o) => o.handLabel !== null).length;
    const agrees = here.filter((o) => o.handLabel === "agrees").length;
    return {
      gesture,
      photos: here.length,
      accepted,
      acceptedRate: rate(accepted, here.length),
      handDetected: detected,
      detectionRate: rate(detected, here.length),
      handLabelChecked: checked,
      handLabelAgrees: agrees,
      handLabelAgreementRate: rate(agrees, checked),
    };
  });
}

// ── Coverage ────────────────────────────────────────────────────────────────

export interface HandLengthBin {
  /** Inclusive lower edge, mm. */
  readonly fromMm: number;
  /** Exclusive upper edge, mm. */
  readonly toMm: number;
  readonly people: number;
}

/**
 * Counts of values in bins of `binMm`, from the bin of the smallest value to
 * the bin of the largest, with empty bins in between so the shape is visible.
 * A value on an edge belongs to the bin that starts there (190 is in 190-200).
 */
export function histogram(
  values: readonly number[],
  binMm: number = HAND_LENGTH_BIN_MM,
): HandLengthBin[] {
  if (values.length === 0) return [];
  const bins = new Map<number, number>();
  for (const v of values) {
    const start = Math.floor(v / binMm) * binMm;
    bins.set(start, (bins.get(start) ?? 0) + 1);
  }
  const first = Math.min(...bins.keys());
  const last = Math.max(...bins.keys());
  const out: HandLengthBin[] = [];
  for (let from = first; from <= last; from += binMm) {
    out.push({ fromMm: from, toMm: from + binMm, people: bins.get(from) ?? 0 });
  }
  return out;
}

export interface CountRow {
  readonly value: string;
  readonly people: number;
  readonly photos: number;
}

/**
 * Counts of people and of photos by a label (a phone, a sheet, a hand). Each
 * item is one person with the label and that person's photo count under it;
 * a person appearing under several labels is counted under each, so the
 * caller decides what a person's label is.
 */
export function countByLabel(
  items: readonly { readonly label: string; readonly photos: number }[],
): CountRow[] {
  const rows = new Map<string, { people: number; photos: number }>();
  for (const item of items) {
    const row = rows.get(item.label) ?? { people: 0, photos: 0 };
    row.people += 1;
    row.photos += item.photos;
    rows.set(item.label, row);
  }
  return [...rows.entries()]
    .map(([value, r]) => ({ value, people: r.people, photos: r.photos }))
    .sort((a, b) => a.value.localeCompare(b.value));
}
