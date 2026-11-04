"use client";

/**
 * v3.4 (review items 4 and M1): the card guide overlay, loaded on first use
 * so it is not in /scan/easy's first load. A chunk that fails to load must
 * not reach the error page (next/dynamic and React.lazy throw, and cache the
 * failure): this renders nothing instead, card mode keeps working with its
 * hint line, and the next mount tries again. A loaded module is kept.
 */
import { useEffect, useState, type ComponentProps } from "react";
import type { CardGuideOverlay as Overlay } from "./CardGuideOverlay";

type OverlayComponent = typeof Overlay;

let loaded: OverlayComponent | null = null;

/** Loads the overlay module; `null` when the chunk could not be loaded. Never throws. */
export async function loadCardGuideOverlay(
  load: () => Promise<{ CardGuideOverlay: OverlayComponent }> = () =>
    import("./CardGuideOverlay"),
): Promise<OverlayComponent | null> {
  if (loaded) return loaded;
  try {
    loaded = (await load()).CardGuideOverlay;
    return loaded;
  } catch {
    return null;
  }
}

export function LazyCardGuideOverlay(props: ComponentProps<OverlayComponent>) {
  const [Component, setComponent] = useState<OverlayComponent | null>(
    () => loaded,
  );
  useEffect(() => {
    if (Component) return;
    let live = true;
    void loadCardGuideOverlay().then((c) => {
      if (live && c) setComponent(() => c);
    });
    return () => {
      live = false;
    };
  }, [Component]);
  return Component ? <Component {...props} /> : null;
}
