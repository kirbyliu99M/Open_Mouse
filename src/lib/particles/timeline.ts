import { clamp01 } from "./interpolate";

/**
 * The scroll story's state machine (Home v3, PR B; spec: docs/design/
 * home-v3-2026-10-03/README.md, "Page structure" and "The particle stage").
 * Pure: it turns the section's scroll position into a progress p, and p into
 * what every part of the stage shows. Scrolling itself stays native.
 */

export { clamp01 as clampProgress } from "./interpolate";

/** How far into the story section the reader is, 0 to 1. */
export function sectionProgress(
  /** The section's top edge relative to the viewport (getBoundingClientRect().top). */
  sectionTop: number,
  sectionHeight: number,
  panelHeight: number,
): number {
  // p is 0 while the panel pins (the section's top is at the viewport's top
  // or below it) and 1 when the section's bottom reaches the panel's bottom.
  const travel = sectionHeight - panelHeight;
  if (!(travel > 0)) return 0;
  return clamp01(-sectionTop / travel);
}

export type StoryId = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * The six stories and their progress ranges, from the spec's table ("suggested",
 * to be tuned). Story 1 is p = 0 itself: the hero at rest.
 */
export const STORY_RANGES: readonly {
  readonly story: StoryId;
  readonly from: number;
  readonly to: number;
}[] = [
  { story: 1, from: 0, to: 0 }, // hero: logo and headline
  { story: 2, from: 0, to: 0.15 }, // the logo scatters
  { story: 3, from: 0.15, to: 0.38 }, // the particles gather into a hand
  { story: 4, from: 0.38, to: 0.55 }, // the hand is measured
  { story: 5, from: 0.55, to: 0.72 }, // the hand rearranges
  { story: 6, from: 0.72, to: 1 }, // three mice
];

/** Where things happen inside those ranges. */
export const MARKS = {
  /** The hero text has faded out by here. */
  heroFadeEnd: 0.1,
  /** The particles have formed the hand. */
  handFormed: 0.38,
  /** The hand's lines are drawn, and it starts to loosen. */
  measured: 0.55,
  /** The three mice have settled; they hold still to p = 1. */
  miceSettled: 0.9,
} as const;

/**
 * The five annotations' windows (Home v3.1), in the order the hand is
 * annotated: length, width, knuckles, fingertips, thumb. They sit in
 * p = 0.40 to 0.60, five equal windows that touch and never overlap, so at
 * most one note is visible at a time. A window is a fade in, a hold, and a
 * fade out. 未拍板 (candidate) like the rest of the timing: each number is one
 * value here. The notes never move a particle and never change a section's
 * height: they are a separate layer over the story.
 */
export const NOTE_BOUNDS = [0.4, 0.44, 0.48, 0.52, 0.56, 0.6] as const;
export const NOTE_COUNT = NOTE_BOUNDS.length - 1;
/** How long a note takes to fade in, and again to fade out, in p. The hold between is the window less twice this. */
export const NOTE_FADE = 0.01;

/** The hero's controls are inert below this opacity. */
export const HERO_INERT_BELOW = 0.05;

/** The story a progress belongs to: p = 0 is story 1, a boundary belongs to the story that starts there. */
export function storyAt(progress: number): StoryId {
  const p = clamp01(progress);
  if (p <= 0) return 1;
  for (let i = STORY_RANGES.length - 1; i >= 1; i -= 1) {
    if (p >= STORY_RANGES[i]!.from) return STORY_RANGES[i]!.story;
  }
  return 2;
}

/** 0 at or before `from`, 1 at or after `to`, linear between. */
export function segment(p: number, from: number, to: number): number {
  if (to <= from) return p >= to ? 1 : 0;
  return clamp01((p - from) / (to - from));
}

export interface Phase {
  /** The (clamped) progress this describes. */
  readonly progress: number;
  readonly story: StoryId;
  /** Logo to hand, 0 to 1: the particles leave the logo, drift out, and gather into the hand by p = 0.38. */
  readonly formT: number;
  /** Hand to three mice, 0 to 1: reached by p = 0.90, held to 1. 0 until the hand has been measured. */
  readonly mouseT: number;
  readonly hero: {
    /** 1 at rest, 0 once the hero text has faded out (p = 0.10). */
    readonly opacity: number;
    /** 0 at rest, 1 when moved all the way up. */
    readonly shift: number;
    /** True below opacity 0.05: the buttons and links are inert. The h1 never is. */
    readonly inert: boolean;
  };
  /** The A4 outline's opacity: it fades in as the hand forms and out as the hand loosens. */
  readonly sheet: number;
  /** The mice's captions' opacity: they fade in as the mice settle. */
  readonly captions: number;
  /** The hand's overlay: how many of the 21 landmarks are lit (fractional), */
  readonly landmarks: number;
  /** how much of the skeleton is drawn, */
  readonly skeleton: number;
  /** how far the two measurement lines have extended, */
  readonly lines: number;
  /** and its overall opacity (it fades out as the hand loosens). */
  readonly overlay: number;
  /** The hand's outline fades in with the skeleton, and goes with the overlay. */
  readonly outline: number;
  /** The five annotations' opacities, 0 to 1, in order. At most one is above 0 at any p, and all are 0 outside p = 0.40 to 0.60. */
  readonly notes: readonly number[];
}

export function phaseAt(progress: number): Phase {
  const p = clamp01(progress);
  const heroFade = segment(p, 0, MARKS.heroFadeEnd);
  const opacity = 1 - heroFade;
  return {
    progress: p,
    story: storyAt(p),
    formT: segment(p, 0, MARKS.handFormed),
    mouseT: segment(p, MARKS.measured, MARKS.miceSettled),
    hero: {
      opacity,
      shift: heroFade,
      inert: opacity < HERO_INERT_BELOW,
    },
    sheet: segment(p, 0.2, MARKS.handFormed) * (1 - segment(p, 0.55, 0.62)),
    captions: segment(p, 0.84, 0.92),
    landmarks: segment(p, MARKS.handFormed, 0.47) * 21,
    skeleton: segment(p, 0.42, 0.5),
    lines: segment(p, 0.47, MARKS.measured),
    overlay: 1 - segment(p, MARKS.measured, 0.6),
    outline: segment(p, 0.42, 0.5),
    notes: Array.from({ length: NOTE_COUNT }, (_, i) => {
      const from = NOTE_BOUNDS[i]!;
      const to = NOTE_BOUNDS[i + 1]!;
      return (
        segment(p, from, from + NOTE_FADE) *
        (1 - segment(p, to - NOTE_FADE, to))
      );
    }),
  };
}
