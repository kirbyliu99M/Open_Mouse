/**
 * The site's motion timings for code that has to wait for an animation before
 * it unmounts or swaps something (V3.2 motion pass, candidate / 未拍板). The
 * same numbers as the `--motion-*` tokens in src/app/tokens.css; a unit test
 * keeps the two equal.
 */
export const MOTION = {
  FAST_MS: 150,
  BASE_MS: 220,
  OUT_MS: 160,
  SHEET_IN_MS: 320,
  SHEET_OUT_MS: 240,
  REDUCED_MS: 120,
  SHIFT_PX: 24,
  EASE_OUT: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  EASE_IN: "cubic-bezier(0.4, 0, 1, 1)",
} as const;

/** How long a leaving element needs before it can be unmounted. */
export function leaveMs(
  kind: "fade" | "sheet",
  reducedMotion: boolean,
): number {
  if (reducedMotion) return MOTION.REDUCED_MS;
  return kind === "sheet" ? MOTION.SHEET_OUT_MS : MOTION.OUT_MS;
}
