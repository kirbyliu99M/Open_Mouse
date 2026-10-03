/**
 * What the "Try again" button does. `reset()` alone re-renders the segment
 * with the payload it already has, which for an error thrown in a server
 * component is the error itself; asking the router to refresh fetches the
 * segment again so a fixed page can recover. Both run inside a transition so
 * the button stays responsive. Kept as a plain function so it is unit-tested
 * without rendering.
 */
export interface RetryDeps {
  /** Next's `reset` prop for the error boundary. */
  reset: () => void;
  /** `router.refresh()` from `useRouter()`. */
  refresh: () => void;
  /** `startTransition` from `useTransition()`. */
  startTransition: (callback: () => void) => void;
}

export function retry({ reset, refresh, startTransition }: RetryDeps): void {
  startTransition(() => {
    refresh();
    reset();
  });
}
