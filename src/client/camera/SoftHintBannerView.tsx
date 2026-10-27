"use client";

/**
 * The post-shot soft hint (V3.3 WP3b, candidate 未拍板; softHintBanner.ts):
 * one glass line at the top of the measured sheet, with a close button
 * (44 px target). Kirby's S25 test 2026-10-27: placed over the photo just
 * above the sheet, it covered the wrist and the paper's bottom edge, the very
 * thing it talks about; so it sits in the sheet, above the title, and never
 * covers the photo or the sheet's buttons.
 */
export function SoftHintBanner({
  text,
  dismissLabel,
  onDismiss,
  leaving,
}: {
  readonly text: string;
  readonly dismissLabel: string;
  readonly onDismiss: () => void;
  readonly leaving: boolean;
}) {
  return (
    <div
      className="easySoftHint"
      role="status"
      data-testid="easy-soft-hint"
      data-leaving={leaving ? "true" : undefined}
      inert={leaving}
    >
      <p className="easySoftHintText">{text}</p>
      <button
        type="button"
        className="easySoftHintClose"
        aria-label={dismissLabel}
        data-testid="easy-soft-hint-close"
        onClick={onDismiss}
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M6 6l12 12M18 6L6 18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
