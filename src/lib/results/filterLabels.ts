/**
 * Words for the filter's options and chips, from the copy table. Pure.
 */
import type { FilterCopy } from "../copy/results-page";
import {
  selectedGroups,
  type ConnectivityOption,
  type FilterGroup,
  type Filters,
  type ShapeOption,
  type SizeOption,
  type WeightOption,
} from "./filters";

/** The label of one option; a brand is its own name. */
export function optionLabel(
  copy: FilterCopy,
  group: FilterGroup,
  value: string,
): string {
  switch (group) {
    case "brand":
      return value;
    case "size":
      return copy.size[value as SizeOption];
    case "weight":
      return copy.weight[value as WeightOption];
    case "shape":
      return copy.shape[value as ShapeOption];
    case "connectivity":
      return copy.connectivity[value as ConnectivityOption];
  }
}

export interface Chip {
  group: FilterGroup;
  value: string;
  label: string;
}

/** One chip per chosen option, in the order the groups were added. */
export function chipsOf(filters: Filters, copy: FilterCopy): Chip[] {
  return selectedGroups(filters).flatMap((group) =>
    (filters[group] as readonly string[]).map((value) => ({
      group,
      value,
      label: optionLabel(copy, group, value),
    })),
  );
}

/** A collapsed group's summary: its chosen options, or 「不限」. */
export function groupSummary(
  filters: Filters,
  group: FilterGroup,
  copy: FilterCopy,
): string {
  const values = filters[group] as readonly string[];
  return values.length === 0
    ? copy.anyValue
    : values.map((v) => optionLabel(copy, group, v)).join(copy.summaryJoin);
}
