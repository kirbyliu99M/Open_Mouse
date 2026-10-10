"use client";

import { createContext, useContext } from "react";

/**
 * Where focus goes when the control a person just pressed disappears: a chip
 * that was removed, 「清除全部」 (the chips go with it) and the no-match
 * suggestion. `ResultsFilterLayout` provides it: the sidebar's title on a
 * wide screen, the 「篩選（n）」 button on a phone. Outside the layout (the
 * demo) it does nothing.
 */
export const FilterFocusContext = createContext<() => void>(() => {});

export function useFocusFilter(): () => void {
  return useContext(FilterFocusContext);
}
