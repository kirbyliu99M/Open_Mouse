/**
 * Cross-section numbers of the two vertical catalogue mice, written in as
 * literals for the vertical-mouse CANDIDATE scorer. 未拍板（candidate）.
 *
 * SOURCE (local files OUTSIDE this repo; they are NOT committed and no code in
 * the repo reads them at run time):
 *   sketch-pipeline/section-metrics/sections.json   schema "SEC-2.0"
 *     sha256 bd18d5d0160154847c96ef6818223187d3dba16e3eea8743e67d56add8d13a7a
 *   sketch-pipeline/section-metrics/summary.csv (girth cross-check)
 *     sha256 e644ae683a45cd0a058747c95320f45772d0ba08888b48e6140db588cdc41594
 *   sketch-pipeline/section-metrics/REPORT.md (method and definitions)
 *     sha256 ea0bed2f3143e1b8b771095d5ef94a6fca18abe2ec63f1ed0a7f311fee1c6f69
 * Produced by tasks SEC-1 (first extraction) and SEC-2 (outer-contour
 * definition tightened, all 34 shells re-run); the numbers below are the SEC-2
 * ones. Copied 2026-10-08, rounded to 3 decimals, from the `sections[]` entries
 * with `ny_from_nose` 0.4 / 0.5 / 0.6 / 0.7 (the four "grip candidate"
 * stations) of `logitech-mx-vertical` and `logitech-lift-vertical`.
 *
 * WHAT THESE NUMBERS ARE NOT (read before trusting any score built on them):
 * - They are measured on 3D shells reconstructed from official AR views by
 *   26-view silhouette and depth carving (`source_status`
 *   "reference-derived-review"). The shells are UNVERIFIED against physical
 *   mice. Nothing here is a real mouse dimension. Only the catalogue length /
 *   width / height in `src/db/seed/logitech.json` come from a spec page; per
 *   REPORT.md the shells were scaled to catalogue sizes upstream, which does
 *   not make any single section match a physical section.
 * - ny is the fraction of the mouse length from the nose (0) to the rear (1).
 *   "Grip station" is a research assumption (the report's own words: no hand
 *   contact or body-measurement basis). The true contact area is not known.
 * - Axis-aligned width / height, minimum Feret and the minimum bounding
 *   rectangle are DIFFERENT geometric quantities of a tilted wedge. They are
 *   not interchangeable and none of them is "palm thickness".
 * - `outerGirthMm` is the mathematical length of the outer contour, not the
 *   length of skin or a tape measure wrapped around the mouse.
 * - Lift Vertical is 108 × 70 × 71 mm (length × width × height), per the
 *   catalogue seed; the older "71 wide" in an earlier brief was a typo.
 */

export const VERTICAL_SECTION_SOURCE = {
  schema: "SEC-2.0",
  copiedOn: "2026-10-08",
  sectionsJsonSha256:
    "bd18d5d0160154847c96ef6818223187d3dba16e3eea8743e67d56add8d13a7a",
  verified: false,
} as const;

/** One cross-section (a plane at fraction `ny` of the length from the nose). */
export interface VerticalSectionStation {
  /** Fraction of the mouse length from the nose; 0.4 … 0.7. */
  ny: number;
  /** Axis-aligned section width (max x − min x), mm. */
  widthMm: number;
  /** Axis-aligned section height (max z − min z at this plane), mm. */
  heightMm: number;
  /** Length of the outer contour (depth-0 loops only), mm. */
  outerGirthMm: number;
  /** Smallest distance between two parallel supporting lines, mm. */
  minFeretMm: number;
  /** Largest caliper diameter (longest vertex-to-vertex distance), mm. */
  maxFeretMm: number;
  /** Long side of the minimum-area bounding rectangle, mm. */
  minRectLongMm: number;
  /** Short side of the minimum-area bounding rectangle, mm. */
  minRectShortMm: number;
}

/** Catalogue model names (as in the seed) that have section data here. */
export type VerticalSectionModel = "MX Vertical" | "Lift Vertical";

/** The four candidate grip stations, in order. Research assumption only. */
export const VERTICAL_SECTION_STATIONS = [0.4, 0.5, 0.6, 0.7] as const;

export const VERTICAL_SECTIONS: Record<
  VerticalSectionModel,
  readonly VerticalSectionStation[]
> = {
  "MX Vertical": [
    {
      ny: 0.4,
      widthMm: 71.082,
      heightMm: 71.303,
      outerGirthMm: 232.703,
      minFeretMm: 61.517,
      maxFeretMm: 83.139,
      minRectLongMm: 71.303,
      minRectShortMm: 71.082,
    },
    {
      ny: 0.5,
      widthMm: 76.403,
      heightMm: 74.963,
      outerGirthMm: 246.396,
      minFeretMm: 66.974,
      maxFeretMm: 85.538,
      minRectLongMm: 83.777,
      minRectShortMm: 67.833,
    },
    {
      ny: 0.6,
      widthMm: 78.822,
      heightMm: 78.289,
      outerGirthMm: 254.782,
      minFeretMm: 69.334,
      maxFeretMm: 87.045,
      minRectLongMm: 86.964,
      minRectShortMm: 69.334,
    },
    {
      ny: 0.7,
      widthMm: 77.751,
      heightMm: 71.687,
      outerGirthMm: 239.398,
      minFeretMm: 68.163,
      maxFeretMm: 80.195,
      minRectLongMm: 73.473,
      minRectShortMm: 73.165,
    },
  ],
  "Lift Vertical": [
    {
      ny: 0.4,
      widthMm: 64.516,
      heightMm: 66.095,
      outerGirthMm: 215.588,
      minFeretMm: 54.89,
      maxFeretMm: 76.681,
      minRectLongMm: 75.92,
      minRectShortMm: 55.01,
    },
    {
      ny: 0.5,
      widthMm: 68.405,
      heightMm: 68.552,
      outerGirthMm: 223.285,
      minFeretMm: 58.796,
      maxFeretMm: 78.092,
      minRectLongMm: 77.523,
      minRectShortMm: 58.843,
    },
    {
      ny: 0.6,
      widthMm: 69.908,
      heightMm: 70.264,
      outerGirthMm: 228.425,
      minFeretMm: 60.766,
      maxFeretMm: 78.957,
      minRectLongMm: 78.522,
      minRectShortMm: 60.883,
    },
    {
      ny: 0.7,
      widthMm: 68.613,
      heightMm: 69.245,
      outerGirthMm: 223.765,
      minFeretMm: 60.348,
      maxFeretMm: 76.86,
      minRectLongMm: 76.351,
      minRectShortMm: 60.525,
    },
  ],
};

/** The section data for a catalogue model name, or undefined if there is none. */
export function sectionsForModel(
  model: string,
): readonly VerticalSectionStation[] | undefined {
  return Object.prototype.hasOwnProperty.call(VERTICAL_SECTIONS, model)
    ? VERTICAL_SECTIONS[model as VerticalSectionModel]
    : undefined;
}
