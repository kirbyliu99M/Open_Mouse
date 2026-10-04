/**
 * What "Try again" does on the global error screen: load the page again from
 * the server. That screen only shows when the root layout itself failed, so
 * the error boundary's `reset()` (which re-renders with the payload it already
 * has) can not recover from a server-side failure, and the app router may be
 * the thing that broke, so `router.refresh()` is not available either. A full
 * reload is the one recovery that works in both cases. Kept as a function so a
 * unit test can call it with a stand-in for `window`.
 */
export function reloadPage(
  win: { location: { reload: () => void } } = window,
): void {
  win.location.reload();
}
