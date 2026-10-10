import { clamp01 } from "./interpolate";
import { MARKS } from "./timeline";

/**
 * Starting the particle stage when the reader is no longer at the top of the
 * page (a reload that restored the scroll position, or a scroll while the page
 * was still loading). Pure: the stage (src/components/home/particle-stage.ts)
 * measures the static layout and asks these where the animated layout should
 * put the reader, and whether the story in view has to fade out first.
 *
 * At the top the switch moves nothing (the hero sits in the same place in both
 * layouts). Anywhere else the story section changes from a stack of static
 * blocks (about 2,100 px) to a 400svh section with a pinned panel, so:
 * - below the story (the section's bottom edge is in view, or above it), the
 *   animated section is placed so that its bottom edge stays exactly where it
 *   was: the final section, and whatever else is in view under the story, does
 *   not move (p is then 1, the story's last step);
 * - inside the story, the static blocks the reader is looking at have no twin
 *   in the animated layout (the hand and the mice are drawn by the canvas, in a
 *   pinned panel), so nothing can be kept in place: the panel fades out, the
 *   layout switches at the progress p that shows the same part of the story,
 *   and the panel fades back in. The reader sees a short fade, never a jump.
 */

/**
 * The switch waits until the reader has not scrolled for this long (ms), so it
 * never moves the page under a scroll in progress (a finger, a fling, a wheel).
 */
export const LATE_SWITCH_IDLE_MS = 300;
/** The panel's fade out before the switch and in after it (ms). Opacity only. 未拍板 (candidate). */
export const LATE_FADE_OUT_MS = 180;
export const LATE_FADE_IN_MS = 320;

/** A point of the static story that matches a progress of the animated one. */
export interface StoryAnchor {
  /** Distance from the static section's top edge to the point, in CSS px. */
  readonly offset: number;
  readonly progress: number;
}

export interface StaticBlock {
  /** Its top edge relative to the static section's top edge, in CSS px. */
  readonly top: number;
  readonly height: number;
}

/**
 * Where each part of the static story is matched in the animated one: the
 * section's top edge is p = 0, the hand's middle the formed hand (p = 0.38),
 * the annotations' middle the middle of their windows (p = 0.5), the mice's
 * middle the settled mice (p = 0.9), and the section's bottom edge p = 1.
 * 未拍板 (candidate), like the rest of the timing.
 */
export const ANCHOR_PROGRESS = {
  hand: MARKS.handFormed,
  notes: 0.5,
  mice: MARKS.miceSettled,
} as const;

export function storyAnchors(input: {
  readonly staticHeight: number;
  readonly hand: StaticBlock | null;
  readonly notes: StaticBlock | null;
  readonly mice: StaticBlock | null;
}): StoryAnchor[] {
  const middle = (block: StaticBlock | null) =>
    block ? block.top + block.height / 2 : null;
  const list: { offset: number | null; progress: number }[] = [
    { offset: 0, progress: 0 },
    { offset: middle(input.hand), progress: ANCHOR_PROGRESS.hand },
    { offset: middle(input.notes), progress: ANCHOR_PROGRESS.notes },
    { offset: middle(input.mice), progress: ANCHOR_PROGRESS.mice },
    { offset: input.staticHeight, progress: 1 },
  ];
  // Only anchors that go forward in both: a block that is missing, or that a
  // very short section puts before the previous anchor, is left out.
  const out: StoryAnchor[] = [];
  for (const { offset, progress } of list) {
    if (offset === null || !Number.isFinite(offset)) continue;
    const last = out.at(-1);
    if (last && (offset <= last.offset || progress <= last.progress)) continue;
    out.push({ offset, progress });
  }
  return out;
}

/** The progress that matches a point `offset` px below the static section's top edge: linear between the anchors, clamped to the first and last. */
export function progressAtOffset(
  offset: number,
  anchors: readonly StoryAnchor[],
): number {
  const first = anchors[0];
  if (!first || !Number.isFinite(offset)) return 0;
  if (offset <= first.offset) return clamp01(first.progress);
  for (let i = 1; i < anchors.length; i += 1) {
    const a = anchors[i - 1]!;
    const b = anchors[i]!;
    if (offset <= b.offset) {
      const t = (offset - a.offset) / (b.offset - a.offset);
      return clamp01(a.progress + t * (b.progress - a.progress));
    }
  }
  return clamp01(anchors.at(-1)!.progress);
}

export interface LateSwitchInput {
  /** The static section's top edge relative to the viewport (getBoundingClientRect().top). */
  readonly staticTop: number;
  readonly staticHeight: number;
  /** The animated section's height (400svh) and its pinned panel's (100svh). */
  readonly animatedHeight: number;
  readonly panelHeight: number;
  /** The viewport's height now (window.innerHeight): what the reader sees. */
  readonly viewportHeight: number;
  readonly anchors: readonly StoryAnchor[];
}

export interface LateSwitchPlan {
  /** Where the animated section's top edge has to be, relative to the viewport, after the switch. */
  readonly targetTop: number;
  /** The progress that puts it there. */
  readonly progress: number;
  /** True when part of the story is in view: it fades out before the switch and in after it. */
  readonly fade: boolean;
}

/** Where the switch puts the reader (see the comment at the top of this file). */
export function planLateSwitch(input: LateSwitchInput): LateSwitchPlan {
  const {
    staticTop,
    staticHeight,
    animatedHeight,
    panelHeight,
    viewportHeight,
    anchors,
  } = input;
  // At the top (or above it): the hero is where it is in both layouts.
  if (!(staticTop < 0)) {
    return { targetTop: staticTop, progress: 0, fade: false };
  }
  const travel = Math.max(0, animatedHeight - panelHeight);
  const bottom = staticTop + staticHeight;
  if (bottom <= viewportHeight) {
    // The story's end is in view (or the story is above the viewport): keep
    // its bottom edge, and so everything under it, where it is.
    const targetTop = bottom - animatedHeight;
    return {
      targetTop,
      progress: travel > 0 ? clamp01(-targetTop / travel) : 0,
      fade: bottom > 0,
    };
  }
  const progress = progressAtOffset(
    readingOffset(staticTop, staticHeight, viewportHeight),
    anchors,
  );
  return { targetTop: -progress * travel, progress, fade: true };
}

/**
 * The point of the static story the reader is taken to be reading, in px below
 * its top edge: a line that moves down the viewport as the reader moves through
 * the section, from the viewport's top edge (the section's top at the
 * viewport's top) to its bottom edge (the section's bottom at the viewport's
 * bottom). So the section's first and last px are both reachable, and the
 * point only moves forward as the reader does.
 */
export function readingOffset(
  staticTop: number,
  staticHeight: number,
  viewportHeight: number,
): number {
  const scrolled = Math.max(0, -staticTop);
  const range = staticHeight - viewportHeight;
  const share = range > 0 ? clamp01(scrolled / range) : 1;
  return scrolled + share * viewportHeight;
}

/**
 * The scroll position that puts the animated section's top edge at
 * `targetTop`, given where it is now (`currentTop`, measured after the switch)
 * and the scroll position now. Never below 0.
 */
export function scrollForTarget(
  scrollY: number,
  currentTop: number,
  targetTop: number,
): number {
  return Math.max(0, scrollY + (currentTop - targetTop));
}
