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
 *   animated section is placed so that the final section under it, and
 *   whatever else is in view under the story, does not move. The final
 *   section does not sit at the same distance from the section's bottom edge
 *   in the two layouts (3rem below it in the static one; since the finale,
 *   2026-10-11, a share of the viewport ABOVE it in the animated one, its
 *   buttons coming up over the finale), so the bottom edge is moved by that
 *   difference (`finalShift`) and the final section stays put (p is then 1,
 *   or a little under it while the final section is still low in the
 *   viewport);
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
/** The switch waits this much past the fade out's end (about two frames), so the panel is fully transparent by then. */
export const LATE_FADE_MARGIN_MS = 34;
/** The panel counts as transparent, and the switch may happen, at or under this computed opacity. */
export const LATE_TRANSPARENT = 0.02;
/**
 * If the panel is not transparent yet when the fade's timer is up (a long
 * task held the transition back), the switch looks again once a frame, for at
 * most this many frames and this long (ms). Then the fade counts as failed.
 */
export const LATE_CONFIRM_FRAMES = 5;
export const LATE_CONFIRM_MS = 150;
/** A fade that failed is tried again after the idle wait, this many times in all, until the reader scrolls. */
export const LATE_FADE_ATTEMPTS = 3;

export type FadeCheck = "switch" | "next-frame" | "give-up" | "hidden";

/**
 * Whether the stage may switch away from the top at all. Not when the whole
 * static story fits in the viewport (a very tall window, about 2,100 px or
 * more): its end, and the final section's buttons under it, are in view from
 * the first px of scroll, and no place for the animated section keeps both
 * the story's step and the buttons where they were (the review of 2026-10-11
 * found the buttons carried off there). Such a page stays static until the
 * reader is back at the top, where the switch moves nothing.
 */
export function lateSwitchAllowed(
  staticHeight: number,
  viewportHeight: number,
): boolean {
  return (
    Number.isFinite(staticHeight) &&
    Number.isFinite(viewportHeight) &&
    staticHeight > viewportHeight
  );
}

/**
 * Whether the late switch may happen now, the fade's timer being up: only in a
 * shown tab (a hidden one switches when it is shown again: the stage draws
 * nothing while hidden), and only with the panel transparent, so the switch
 * and its scroll are never seen. Otherwise look again next frame, up to the
 * bounds above, and then give the fade up (it fades back in; nothing moved).
 */
export function fadeCheck(input: {
  readonly hidden: boolean;
  readonly opacity: number;
  /** Frames looked at since the timer was up, and ms gone by. */
  readonly frames: number;
  readonly elapsedMs: number;
}): FadeCheck {
  if (input.hidden) return "hidden";
  if (input.opacity <= LATE_TRANSPARENT) return "switch";
  if (
    !(input.frames < LATE_CONFIRM_FRAMES) ||
    !(input.elapsedMs < LATE_CONFIRM_MS)
  ) {
    return "give-up";
  }
  return "next-frame";
}

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
 * Where each part of the static story is matched in the animated one, so the
 * reader lands on the step that shows what they were looking at: the
 * section's top edge is p = 0 (the hero); the static hand's top edge the
 * formed hand (p = 0.38), so a reader looking at the hand gets the hand; the
 * annotations' top edge the lit, measured hand (p = 0.47, in the notes'
 * windows); the finale's top edge the start of story 6 (p = 0.72) and its
 * bottom edge p = 0.9 (the headline gathering over the formed figure; the
 * three mice the finale replaced settled there, and the anchors' slopes were
 * tuned for it, so it stays 0.9 while the figure itself is formed by 0.80,
 * MARKS.miceSettled); the section's bottom edge p = 1, which wins over the
 * finale's bottom edge when the two are one (the finale is the static
 * section's last block), so the story's end is always reachable. (The `mice`
 * names are the old ones: the block is the finale's now.) 未拍板 (candidate),
 * like the rest of the timing.
 */
export const ANCHOR_PROGRESS = {
  handTop: MARKS.handFormed,
  notesTop: 0.47,
  miceTop: 0.72,
  miceBottom: 0.9,
} as const;

export function storyAnchors(input: {
  readonly staticHeight: number;
  readonly hand: StaticBlock | null;
  readonly notes: StaticBlock | null;
  readonly mice: StaticBlock | null;
}): StoryAnchor[] {
  const { hand, notes, mice } = input;
  const list: { offset: number | null; progress: number }[] = [
    { offset: 0, progress: 0 },
    { offset: hand ? hand.top : null, progress: ANCHOR_PROGRESS.handTop },
    { offset: notes ? notes.top : null, progress: ANCHOR_PROGRESS.notesTop },
    { offset: mice ? mice.top : null, progress: ANCHOR_PROGRESS.miceTop },
    {
      offset: mice ? mice.top + mice.height : null,
      progress: ANCHOR_PROGRESS.miceBottom,
    },
    { offset: input.staticHeight, progress: 1 },
  ];
  // Only anchors that go forward in both: a block that is missing, or that a
  // very short section puts before the previous anchor, is left out.
  const out: StoryAnchor[] = [];
  list.forEach(({ offset, progress }, index) => {
    if (offset === null || !Number.isFinite(offset)) return;
    if (index === list.length - 1) {
      // The section's end (p = 1) is always kept: an anchor at or past it (the
      // finale's bottom edge, when it is the section's last px) gives way.
      while (out.length > 1 && out.at(-1)!.offset >= offset) out.pop();
    }
    const last = out.at(-1);
    if (last && (offset <= last.offset || progress <= last.progress)) return;
    out.push({ offset, progress });
  });
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
  /**
   * How much farther below the section's bottom edge the final section's top
   * edge is in the static layout than in the animated one (CSS px): the
   * static gap (3rem) plus the animated overlap (the final section comes up
   * over the finale: 33svh on a phone, 20svh on a desktop). 0 when the two
   * gaps are the same. The animated section's bottom edge is put this much
   * lower than the static one's, so the final section does not move.
   */
  readonly finalShift?: number;
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
  const progressFor = (targetTop: number) =>
    travel > 0 ? clamp01(-targetTop / travel) : 0;
  const bottom = staticTop + staticHeight;
  const shift =
    input.finalShift !== undefined && Number.isFinite(input.finalShift)
      ? input.finalShift
      : 0;
  // How far into the animated section the reader is put (its top edge that
  // many px above the viewport's top). Never negative: a reader who was past
  // the section's top is never put above it again. (That only bites when the
  // animated section is shorter than the viewport, which 400svh never is.)
  const into = (px: number) => {
    const targetTop = -Math.max(0, px);
    return { targetTop, progress: progressFor(targetTop) };
  };
  if (staticHeight <= viewportHeight && bottom > 0) {
    // (The stage never gets here since 2026-10-11: such a page waits for the
    // top, lateSwitchAllowed. The branch stays for a caller that asks.)
    // The whole static story fits in the viewport (a very tall screen), so
    // its end is in view from the top on: keeping its bottom edge would jump
    // to the story's end at the first px of scroll. Map the scroll in
    // proportion instead, from the top (0) to the story's end leaving the
    // viewport's top (the whole animated section), where the branch below
    // takes over. The final section moves under the fade here.
    const scrolled = -staticTop;
    return {
      ...into(
        staticHeight > 0 ? (scrolled * animatedHeight) / staticHeight : 0,
      ),
      fade: true,
    };
  }
  if (bottom <= viewportHeight) {
    // The story's end is in view (or the story is above the viewport): keep
    // the final section, and so everything under it, where it is: the
    // animated section's bottom edge goes `shift` below the static one's.
    return {
      ...into(animatedHeight - (bottom + shift)),
      fade: bottom > 0,
    };
  }
  // Inside the story: how far through it the reader is (0 to 1, from the
  // anchors) is applied to the animated section's own scroll range up to the
  // point where its bottom edge reaches the viewport's bottom, which is where
  // the branch above takes over. That range is the panel's travel only when
  // the viewport is exactly 100svh tall; on a phone whose toolbars have
  // slid away it is not, and scaling by the travel instead would make the two
  // branches disagree at their border (p and the target would jump there).
  const share = progressAtOffset(
    readingOffset(staticTop, staticHeight, viewportHeight),
    anchors,
  );
  // (The range ends where the branch above starts: the bottom edge at the
  // viewport's bottom, moved by `shift`.)
  return {
    ...into(share * (animatedHeight - viewportHeight - shift)),
    fade: true,
  };
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
