"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { HomeCtaLink } from "@/components/home/HomeCtaLink";
import { parseSessionBody, type NavUser } from "./account-nav";
import { Avatar } from "./Avatar";

/** The home nav's account entry. The server renders (and a failed or signed-out
 * fetch keeps) the plain "Sign in" link, so the home page stays static; once
 * the session body says someone is signed in, it becomes their avatar. */
export function AccountNavLink() {
  const [user, setUser] = useState<NavUser | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/session", {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: unknown) => setUser(parseSessionBody(body)))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  if (!user) {
    return (
      <HomeCtaLink cta="sign_in" className="home-signin-link" href="/account">
        Sign in
      </HomeCtaLink>
    );
  }
  return (
    <Link
      className="home-account-link"
      href="/account"
      aria-label="Account"
      title={user.name ?? "Account"}
    >
      <Avatar image={user.image} />
    </Link>
  );
}
