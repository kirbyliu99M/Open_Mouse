"use client";

import { useState } from "react";

/** A round profile picture. With no image, or when it fails to load, it shows
 * the static particle sparkle (Kirby's call, 2026-10-09), the same for every
 * user. Decorative: the surrounding control or text carries the accessible
 * name. The colours come from classes in globals.css so print can override. */
export function Avatar({
  image,
  className = "avatar",
}: {
  image: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
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
      <svg viewBox="0 0 32 32" focusable="false">
        <path
          className="avatar-spark-light"
          d="M15 6 C15.8 11.2 18.8 14.2 24 15 C18.8 15.8 15.8 18.8 15 24 C14.2 18.8 11.2 15.8 6 15 C11.2 14.2 14.2 11.2 15 6 Z"
        />
        <path
          className="avatar-spark-accent"
          d="M24 4 C24.3 5.9 25.1 6.7 27 7 C25.1 7.3 24.3 8.1 24 10 C23.7 8.1 22.9 7.3 21 7 C22.9 6.7 23.7 5.9 24 4 Z"
        />
        <circle className="avatar-spark-accent" cx="8" cy="24" r="1.1" />
        <circle className="avatar-spark-light" cx="25" cy="24" r="0.9" />
        <circle className="avatar-spark-accent" cx="6" cy="9" r="0.8" />
        <circle className="avatar-spark-light" cx="20" cy="27" r="0.7" />
        <circle className="avatar-spark-accent" cx="12" cy="4" r="0.6" />
      </svg>
    </span>
  );
}
