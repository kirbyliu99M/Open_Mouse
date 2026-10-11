"use client";

import { useEffect, useState } from "react";
import type { MouseLinks } from "@/lib/contracts/commerce";
import { peekMouseLinks, requestMouseLinks } from "./mouseLinksStore";

/**
 * The official link and purchase links of one mouse, or `null` while they load
 * and for good when there are none or the request failed (the caller then
 * draws nothing). Asks `/api/mice/<slug>/links` once per mouse for the life of
 * the page (see `mouseLinksStore.ts`) and cancels the request when the
 * component goes away first. A mouse already asked about answers on the first
 * render, so moving between detail pages does not flash.
 */
export function useMouseLinks(
  slug: string | null | undefined,
): MouseLinks | null {
  const known = slug ? peekMouseLinks(slug) : undefined;
  const [loaded, setLoaded] = useState<{
    slug: string;
    links: MouseLinks | null;
  } | null>(null);

  useEffect(() => {
    if (!slug || peekMouseLinks(slug) !== undefined) return;
    let live = true;
    const request = requestMouseLinks(slug);
    void request.promise.then((links) => {
      if (live) setLoaded({ slug, links });
    });
    return () => {
      live = false;
      request.release();
    };
  }, [slug]);

  if (!slug) return null;
  if (known !== undefined) return known;
  return loaded?.slug === slug ? loaded.links : null;
}
