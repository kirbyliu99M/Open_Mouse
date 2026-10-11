"use client";

interface RetryButtonProps {
  /** A retry is under way. */
  pending: boolean;
  onRetry: () => void;
  /** The button's words ("Try again"). */
  label: string;
}

/**
 * The "Try again" button of the error screen. While a retry runs it is NOT
 * `disabled`: a disabled button drops keyboard focus to the page body and
 * tells a screen reader nothing. It stays focusable, says `aria-disabled` and
 * `aria-busy`, looks busy (errors.css), and ignores presses until the retry
 * settles. The sentence "Trying again…" is announced by the screen's status
 * region.
 */
export function RetryButton({ pending, onRetry, label }: RetryButtonProps) {
  return (
    <button
      type="button"
      className={`errorAction errorAction-primary${pending ? " errorAction-pending" : ""}`}
      aria-disabled={pending}
      aria-busy={pending}
      onClick={() => {
        if (!pending) onRetry();
      }}
    >
      {label}
    </button>
  );
}
