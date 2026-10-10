import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FitEntry, FitResponse } from "../../../src/lib/contracts/fit";

/**
 * A 30-card fit response for the filter's e2e specs: many brands, every size,
 * every weight band, three shapes (one `hybrid`), wired and wireless, some
 * missing facts, and cards with same-shell variants. The overall #1 is a wired
 * symmetrical Zowie, so most filters swap the large card. Built from the
 * committed many-results fixture's first entry (its sub-scores are reused).
 */
const BASE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        "../../../src/components/results/fixtures/many-results.json",
        import.meta.url,
      ),
    ),
    "utf-8",
  ),
) as FitResponse;

type Conn = "wired" | "wireless" | null;
type Row = [
  brand: string,
  model: string,
  size: "small" | "medium" | "large" | "fingertip",
  weightG: number | null,
  shape: "symmetrical" | "ergonomic" | "hybrid" | null,
  connectivity: Conn,
  variants?: [model: string, weightG: number | null, connectivity: Conn][],
];

const ROWS: Row[] = [
  ["Zowie", "EC2-DW", "medium", 73, "ergonomic", "wired"],
  ["Logitech", "G Pro X Superlight 2", "medium", 60, "symmetrical", "wireless"],
  [
    "Razer",
    "Viper V3 Pro",
    "medium",
    54,
    "symmetrical",
    "wireless",
    [["Viper V4 Pro", 55, "wireless"]],
  ],
  ["Razer", "DeathAdder V3", "medium", 59, "ergonomic", "wired"],
  ["Logitech", "G305", "medium", 99, "ergonomic", "wireless"],
  ["Corsair", "Sabre RGB Pro", "small", 74, "symmetrical", "wired"],
  ["SteelSeries", "Aerox 3", "small", 59, "symmetrical", "wired"],
  ["Pulsar", "X2", "medium", 52, "symmetrical", "wireless"],
  ["Razer", "Basilisk V3", "large", 101, "ergonomic", "wired"],
  [
    "Logitech",
    "G502 X",
    "large",
    89,
    "ergonomic",
    "wired",
    [
      ["G502 X Plus", 106, "wireless"],
      ["G502 X Lightspeed", 102, "wireless"],
    ],
  ],
  ["Corsair", "Dark Core", "large", 133, "ergonomic", "wireless"],
  ["Razer", "Cobra Pro", "small", 77, "symmetrical", "wireless"],
  ["Cooler Master", "MM720", "fingertip", 49, "hybrid", "wired"],
  ["Glorious", "Model O", "small", 67, "symmetrical", "wired"],
  ["Zowie", "FK1", "large", 85, "ergonomic", "wired"],
  ["Roccat", "Kone Pro", "large", 69, "ergonomic", null],
  ["Endgame Gear", "XM2we", "medium", null, null, null],
  ["Lamzu", "Atlantis", "small", 55, "symmetrical", "wireless"],
  ["Finalmouse", "Starlight 12", "small", 42, "symmetrical", "wireless"],
  ["Ninjutsu", "Origin One X", "small", 47, "symmetrical", "wireless"],
  ["Vaxee", "XE", "medium", 62, "symmetrical", "wired"],
  ["Wlmouse", "Beast X", "medium", 60, "ergonomic", "wireless"],
  ["Pulsar", "Xlite V3", "medium", 55, "symmetrical", "wireless"],
  ["Lamzu", "Maya", "small", 49, "symmetrical", "wireless"],
  ["Glorious", "Model D", "large", 69, "ergonomic", "wired"],
  ["Roccat", "Burst Pro", "medium", 68, "symmetrical", "wired"],
  ["Cooler Master", "MM731", "medium", 59, "symmetrical", "wireless"],
  ["Logitech", "G903", "large", 110, "ergonomic", "wireless"],
  ["Razer", "Orochi V2", "small", 60, "symmetrical", "wireless"],
  ["Corsair", "Harpoon", "medium", 99, "ergonomic", "wired"],
];

const slugOf = (brand: string, model: string) =>
  `${brand}-${model}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** The overall order is the order of ROWS; `total` falls from 93 to 64. */
export function buildFilterFit(over: Partial<FitResponse> = {}): FitResponse {
  const template = BASE.results[0] as FitEntry;
  const results: FitEntry[] = ROWS.map((row, i) => {
    const [brand, model, size, weightG, shape, connectivity, variants] = row;
    const total = 93 - i;
    return {
      ...template,
      rank: i + 1,
      total,
      confidence: 0.9,
      mouse: {
        ...template.mouse,
        slug: slugOf(brand, model),
        brand,
        model,
        size,
        weightG,
        shape,
        connectivity,
        imageUrl: null,
      },
      ...(variants
        ? {
            variants: variants.map(([vModel, vWeight, vConn]) => ({
              slug: slugOf(brand, vModel),
              model: vModel,
              weightG: vWeight,
              connectivity: vConn,
            })),
          }
        : {}),
    };
  });
  return {
    ...BASE,
    scanId: "f1f1f1f1-1111-4a2b-8c3d-9e0f1a2b3c4d",
    engineVersion: "fit-v1-candidate.2",
    handType: { size: "medium", grip: "claw", width: "wide" },
    excluded: BASE.excluded,
    results,
    ...over,
  };
}

export const FILTER_SCAN_ID = buildFilterFit().scanId;
export const slugFor = slugOf;
