/** Keep whole catalogue measurements whole and show one decimal when present. */
export function formatCatalogueSpec(value: number, unit: "mm" | "g") {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)}\u00A0${unit}`;
}
