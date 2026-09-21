/**
 * Refreshes src/db/seed/logitech.json from Logitech's own product pages.
 *   npm run seed:fetch-logitech
 * Sequential with a delay — this is a handful of pages, not a crawl.
 * Missing dimensions stay null; they are never filled from another source.
 */
import { writeFileSync } from "node:fs";
import { LOGITECH_SOURCES } from "../src/db/seed/logitech-sources";
import {
  dimensionWarnings,
  parseLogitechDimensions,
} from "../src/server/catalogue/logitech-specs";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retrievedAt = new Date().toISOString();
const rows = [];
for (const source of LOGITECH_SOURCES) {
  let dims = {
    lengthMm: null,
    widthMm: null,
    heightMm: null,
    weightG: null,
  } as ReturnType<typeof parseLogitechDimensions>;
  let status = 0;
  try {
    const res = await fetch(source.url, {
      headers: { "user-agent": "Mozilla/5.0 (Open_Mouse spec fetch)" },
    });
    status = res.status;
    if (res.ok) dims = parseLogitechDimensions(await res.text(), source.url);
  } catch {
    status = -1;
  }
  const missing = dimensionWarnings(dims);
  console.log(
    `${missing.length ? "⚠" : "✓"} ${source.model.padEnd(26)} ${status}  L${dims.lengthMm} W${dims.widthMm} H${dims.heightMm} ${dims.weightG}g${missing.length ? `  ${missing.join("; ")}` : ""}`,
  );
  rows.push({
    brand: "Logitech",
    model: source.model,
    ...dims,
    warnings: missing,
    connectivity: source.connectivity,
    sourceUrl: source.url,
    retrievedAt,
  });
  await sleep(1000);
}
writeFileSync(
  "src/db/seed/logitech.json",
  JSON.stringify(rows, null, 2) + "\n",
);
console.log(`\nWrote ${rows.length} rows to src/db/seed/logitech.json`);
