"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { REFERENCE_LABEL } from "./copy";
import "./errors.css";

interface ErrorScreenProps {
  eyebrow: string;
  title: string;
  message: string;
  /** An error digest, the only detail of a failure a screen may show. */
  reference?: string | undefined;
  /**
   * Move keyboard and screen-reader focus to the heading on mount. For a
   * screen that replaces a page in place (the error boundary), so the change
   * is announced instead of leaving focus on an element that vanished.
   */
  focusHeading?: boolean;
  /**
   * Change this number to move focus to the heading again (after a retry that
   * ended on the same screen), so focus never falls back to the page body.
   */
  focusKey?: number;
  /** A sentence for the status region below the actions (announced politely). */
  status?: string | undefined;
  /** The buttons and links. */
  children: ReactNode;
}

/**
 * The shared body of the not-found, error and global-error screens: one
 * `<main>`, one `<h1>`, a short sentence, and the ways out. Self-contained
 * styling (`errors.css`), because `global-error.tsx` renders without the root
 * layout and its `globals.css`.
 */
export function ErrorScreen({
  eyebrow,
  title,
  message,
  reference,
  focusHeading = false,
  focusKey = 0,
  status,
  children,
}: ErrorScreenProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusHeading) heading.current?.focus();
  }, [focusHeading, focusKey]);

  return (
    <main className="errorScreen" aria-labelledby="errorScreenTitle">
      <p className="errorScreen-eyebrow">{eyebrow}</p>
      <h1 id="errorScreenTitle" ref={heading} tabIndex={-1}>
        {title}
      </h1>
      <p className="errorScreen-message">{message}</p>
      {reference ? (
        <p className="errorScreen-reference">
          {REFERENCE_LABEL}: <code>{reference}</code>
        </p>
      ) : null}
      <div className="errorScreen-actions">{children}</div>
      {/* Always in the page, so a change of its text is announced. */}
      <p className="errorScreen-status" role="status">
        {status}
      </p>
    </main>
  );
}
