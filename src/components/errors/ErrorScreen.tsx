"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import "../../app/tokens.css";
import "./errors.css";

interface ErrorScreenProps {
  eyebrow: string;
  title: string;
  message: string;
  /** An error digest, the only detail of a failure a screen may show. */
  reference?: string | undefined;
  /** The label before the digest ("Reference"). */
  referenceLabel: string;
  /**
   * Move keyboard and screen-reader focus to the heading on mount. For a
   * screen that replaces a page in place (the error boundary), so the change
   * is announced instead of leaving focus on an element that vanished.
   */
  focusHeading?: boolean;
  /** A sentence for the status region below the actions (announced politely). */
  status?: string | undefined;
  /** The buttons and links. */
  children: ReactNode;
}

/**
 * The shared body of the not-found, error and global-error screens, centred:
 * the Main Palmate Logo, the code, then one `<h1>`, a short sentence, and the
 * ways out, in one `<main>`. Self-contained
 * styling (`errors.css`), because `global-error.tsx` renders without the root
 * layout and its `globals.css`.
 */
export function ErrorScreen({
  eyebrow,
  title,
  message,
  reference,
  referenceLabel,
  focusHeading = false,
  status,
  children,
}: ErrorScreenProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  // A layout effect: the heading takes focus in the same commit that mounts it,
  // so no frame (or test sample) sees focus on the page body in between.
  useLayoutEffect(() => {
    if (focusHeading) heading.current?.focus();
  }, [focusHeading]);

  return (
    <main className="errorScreen" aria-labelledby="errorScreenTitle">
      {/* Kirby 2026-10-26 (candidate / 未拍板): a large Main Palmate Logo in
          the middle, the code under it (the eyebrow, 「錯誤 404」), then the
          details. The logo is decorative (the text says everything). A plain
          <img> on purpose: global-error renders without the root layout, and
          the file is our own fixed SVG. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
      <img
        className="errorScreen-mark"
        src="/images/brand/palmate-main-logo.svg"
        alt=""
        width={220}
        height={220}
        aria-hidden="true"
      />
      <p className="errorScreen-eyebrow">{eyebrow}</p>
      <h1 id="errorScreenTitle" ref={heading} tabIndex={-1}>
        {title}
      </h1>
      <p className="errorScreen-message">{message}</p>
      {reference ? (
        <p className="errorScreen-reference">
          {referenceLabel}: <code>{reference}</code>
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
