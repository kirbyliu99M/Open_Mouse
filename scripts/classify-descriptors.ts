/**
 * Classifies the seeded Logitech lineup into shape descriptors using Gemini
 * vision on Logitech's own product images, and writes
 * src/db/seed/logitech-descriptors.json (consumed by scripts/seed.ts).
 *
 *   npm run classify:descriptors                 (live — needs GEMINI_API_KEY)
 *   npm run classify:descriptors -- --dry-run     (image discovery only, no Gemini calls)
 *
 * Sequential with a 1 s delay between product-page fetches, same as
 * scripts/fetch-logitech-specs.ts — this is 30 pages, not a crawl.
 */
import { writeFileSync } from "node:fs";
import nextEnv from "@next/env";
import { ALL_DESCRIPTORS } from "../src/server/classification/prompts";
import { LOGITECH_SOURCES } from "../src/db/seed/logitech-sources";
import { classifyMouse } from "../src/server/classification/classify";
import {
  createGeminiVisionClassifier,
  type ImageInput,
  type ImageView,
} from "../src/server/classification/gemini";
import {
  discoverGalleryImages,
  fetchImageBytes,
} from "../src/server/classification/images";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dryRun = process.argv.includes("--dry-run");

/**
 * Dry-run-only diagnostic: buckets a discovered image URL by keywords
 * Logitech's own filenames use ("top-angle", "profile-left-angle", ...). This
 * is a cheap sanity check for the operator before spending API calls — it is
 * never fed into classification. The real view tagging is one Gemini call
 * per model (src/server/classification/gemini.ts `tagViews`).
 */
function guessViewFromFilename(url: string): ImageView {
  const name = url.toLowerCase();
  if (name.includes("top")) return "top";
  if (name.includes("profile") || name.includes("side")) return "side";
  if (name.includes("front")) return "front";
  if (name.includes("rear") || name.includes("back")) return "rear";
  return "other";
}

async function main() {
  nextEnv.loadEnvConfig(process.cwd());

  if (!dryRun && !process.env.GEMINI_API_KEY?.trim()) {
    console.error(
      "GEMINI_API_KEY is not set. Classification calls the real Gemini API " +
        "and needs a key — set it in the environment, or pass --dry-run to " +
        "check image discovery without calling Gemini.",
    );
    process.exitCode = 1;
    return;
  }

  const classifier = dryRun ? null : createGeminiVisionClassifier(process.env);
  const results = [];
  let flagged = 0;

  for (const source of LOGITECH_SOURCES) {
    let imageUrls: string[] = [];
    let status = 0;
    try {
      const discovered = await discoverGalleryImages(source.url);
      imageUrls = discovered.images;
      status = discovered.status;
    } catch (error) {
      console.error(
        `  ! ${source.model}: image discovery failed — ${String(error)}`,
      );
    }

    const guesses = imageUrls.map(guessViewFromFilename);
    const hasSideOrTop = guesses.some((v) => v === "side" || v === "top");
    const low = imageUrls.length < 3 || !hasSideOrTop;
    if (low) flagged++;
    console.log(
      `${low ? "⚠" : "✓"} ${source.model.padEnd(26)} ${status}  ${imageUrls.length} image(s)` +
        (dryRun ? `  [${guesses.join(",") || "none"}]` : ""),
    );

    if (dryRun) {
      const callCount = imageUrls.length > 0 ? 1 + ALL_DESCRIPTORS.length : 0;
      console.log(
        `    would call: 1 view-tagging call${imageUrls.length ? ` (${imageUrls.length} images)` : ""}` +
          (imageUrls.length
            ? ` + up to ${ALL_DESCRIPTORS.length} descriptor calls (${ALL_DESCRIPTORS.join(", ")}) = up to ${callCount} calls`
            : " — no images, no descriptor calls"),
      );
      await sleep(1000);
      continue;
    }

    const images: ImageInput[] = [];
    for (const url of imageUrls) {
      try {
        images.push(await fetchImageBytes(url));
      } catch (error) {
        console.error(`    ! failed to fetch image ${url}: ${String(error)}`);
      }
    }

    const result = await classifyMouse(classifier!, {
      model: source.model,
      images,
    });
    results.push(result);
    console.log(
      `    → shape=${result.shape ?? "–"} hand=${result.handCompatibility ?? "–"} ` +
        `hump=${result.humpPlacement ?? "–"} flare=${result.frontFlare ?? "–"} ` +
        `curve=${result.sideCurvature ?? "–"} thumb=${result.thumbRest ?? "–"} ` +
        `ring=${result.ringFingerRest ?? "–"}${result.needsReview ? "  NEEDS REVIEW" : ""}`,
    );
    await sleep(1000);
  }

  if (dryRun) {
    console.log(
      `\n${LOGITECH_SOURCES.length} models checked; ${flagged} flagged (fewer than 3 images, or no side/top candidate by filename).`,
    );
    return;
  }

  writeFileSync(
    "src/db/seed/logitech-descriptors.json",
    JSON.stringify(results, null, 2) + "\n",
  );
  const needsReview = results.filter((r) => r.needsReview).length;
  console.log(
    `\nWrote ${results.length} rows to src/db/seed/logitech-descriptors.json ` +
      `(${needsReview} needing review, kept out of the seed).`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
