"use client";

import { useState } from "react";
import { initialOf } from "./account-nav";

/** A round profile picture. Falls back to the name's first letter, or a
 * person glyph, when there is no image or it fails to load. Decorative: the
 * surrounding control or text carries the accessible name. */
export function Avatar({
  name,
  image,
  className = "avatar",
}: {
  name: string | null;
  image: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const initial = initialOf(name);
  if (image && !failed) {
    return (
      // Google's avatar host can refuse a request that carries a referrer.
      // eslint-disable-next-line @next/next/no-img-element -- remote profile picture, tiny: no loader wanted
      <img
        className={className}
        src={image}
        alt=""
        width={32}
        height={32}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span
      className={`${className} avatar-fallback`}
      data-testid="avatar-fallback"
      aria-hidden="true"
    >
      {initial ?? (
        <svg viewBox="0 0 24 24" width="18" height="18" focusable="false">
          <circle
            cx="12"
            cy="8"
            r="3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      )}
    </span>
  );
}
