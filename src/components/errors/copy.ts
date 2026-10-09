import { SITE_NAME } from "@/lib/site";

/**
 * Every sentence on the not-found and error screens, in one place, so the
 * screens, their tests and the pull request's copy table read the same text.
 * All of it is pending Kirby's confirmation.
 *
 * None of these screens ever shows an error's message, stack or a file path:
 * in development those can hold internal detail, and in production Next
 * already replaces them with a digest. The only thing an error screen may
 * print about the failure is that digest (a hash that lets a developer find
 * the matching server log line), labelled `REFERENCE_LABEL`.
 */
export const ACTIONS = {
  home: "Back to home",
  scan: "Scan my hand",
  retry: "Try again",
} as const;

export const NOT_FOUND_COPY = {
  eyebrow: "Error 404",
  title: "We can’t find that page",
  message:
    "The link may be out of date, or the page may have moved. You can head back home or start a scan.",
  /**
   * The page name only: the root layout's title template ("%s · Palmate",
   * src/app/layout.tsx) adds the site name, so writing it here would show it
   * twice.
   */
  pageTitle: "Page not found",
} as const;

export const ERROR_COPY = {
  eyebrow: "Something went wrong",
  title: "That didn’t work",
  message:
    "We couldn’t show this page. Try again, or head back home and start from there.",
} as const;

export const GLOBAL_ERROR_COPY = {
  eyebrow: "Something went wrong",
  title: `${SITE_NAME} hit a problem`,
  message:
    "The app couldn’t recover on its own. Try again, or head back home and start from there.",
  /**
   * The complete title, site name included, unlike NOT_FOUND_COPY.pageTitle:
   * global-error.tsx replaces the root layout, so the layout's title template
   * never reaches it, and an error component cannot export `metadata`. It
   * copies the template's " · " separator so every page title reads alike.
   */
  documentTitle: `Something went wrong · ${SITE_NAME}`,
} as const;

export const REFERENCE_LABEL = "Reference";

/** Announced (role=status) while the Try again request is running. */
export const RETRYING = "Trying again…";
