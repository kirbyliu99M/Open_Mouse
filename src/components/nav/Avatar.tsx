"use client";

import { useState } from "react";

/** A round profile picture. With no image, or when it fails to load, it shows
 * the static meteor mouse (Kirby's decision, 2026-10-10: meteor x mouse), the
 * same for every user. Decorative: the surrounding control or text carries the
 * accessible name. The colours and stroke styles come from classes in
 * globals.css so print can override them. */
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
          className="avatar-meteor-trail-accent"
          strokeWidth="1.1"
          d="M12.14 15.98 L8.54 20.27"
        />
        <path
          className="avatar-meteor-trail-accent"
          strokeWidth="1.1"
          d="M17.35 20.35 L12.46 26.18"
        />
        <path
          className="avatar-meteor-trail-light"
          strokeWidth="1.7"
          d="M13.33 19.85 L7.93 26.29"
        />
        <path
          className="avatar-meteor-body"
          strokeWidth="1.4"
          d="M16.63 8.14 C19.53 4.69 22.5 4.57 24.64 6.37 C26.79 8.17 27.19 11.12 24.29 14.56 L21.08 18.4 C19.34 20.46 16.66 20.56 14.36 18.63 C12.06 16.7 11.68 14.04 13.42 11.97 Z"
        />
        <path
          className="avatar-meteor-line"
          strokeWidth="1"
          d="M24.64 6.37 L20.46 11.35 M16.63 8.14 L24.29 14.56"
        />
        <path
          className="avatar-meteor-wheel"
          strokeWidth="1.7"
          d="M23.49 7.75 L22.01 9.51"
        />
        <circle className="avatar-meteor-dot-light" cx="11" cy="17" r="0.7" />
        <circle className="avatar-meteor-dot-accent" cx="5.5" cy="22" r="0.8" />
        <circle
          className="avatar-meteor-dot-accent"
          cx="14.5"
          cy="26.5"
          r="0.6"
        />
        <circle className="avatar-meteor-dot-light" cx="26" cy="22" r="0.7" />
      </svg>
    </span>
  );
}
