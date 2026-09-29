/**
 * Learning-kit sorter: checks a folder of session photos with the real
 * `/learn/check` page (headless Chromium, MediaPipe and all), then files each
 * usable photo by participant and pose, outside the repo:
 *
 *   npm run learn:sort -- --in "D:/DCIM/Camera"
 *
 *   ../Fixtures/learning/P007/slate.jpg
 *   ../Fixtures/learning/P007/G01R/1.jpg … 5.jpg
 *   ../Fixtures/learning/P007/truth.json      (template: copy the ruler values from the slate)
 *   ../Fixtures/learning/runs/<time>.json     (every photo's checks, landmarks, marker and paper corners)
 *
 * Options: --out <dir> (default ../Fixtures/learning), --port <n> (default
 * 3401; a dev server is started), --base <url> (use a running server
 * instead), --dry-run (report only, copy nothing).
 *
 * NEVER runs in CI: it reads real people's hand photos (docs/PLAN.md §M2,
 * AGENTS hard rules 1 and 5). Files are copied, never moved; an existing
 * destination is never overwritten.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { chromium } from "@playwright/test";
import { compareFileNames } from "../src/lib/learning/checks";
import {
  LEARNING_KIT_VERSION,
  sortPhotos,
  type KitCode,
} from "../src/lib/learning/kit";

if (process.env.CI) {
  console.error("learn-sort reads real hand photos and must never run in CI.");
  process.exit(1);
}

const arg = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const inDir = arg("--in");
const outDir = resolve(
  arg("--out") ?? resolve(process.cwd(), "..", "Fixtures", "learning"),
);
const port = Number(arg("--port") ?? 3401);
const externalBase = arg("--base");
const baseUrl = externalBase ?? `http://127.0.0.1:${port}`;
const dryRun = process.argv.includes("--dry-run");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!inDir)
  fail(
    'Usage: npm run learn:sort -- --in "<folder of photos>" [--out <dir>] [--dry-run]',
  );
const input = resolve(inDir);
if (!existsSync(input) || !statSync(input).isDirectory())
  fail(`Not a folder: ${input}`);
if (
  outDir.startsWith(resolve(process.cwd()) + "\\") ||
  outDir.startsWith(resolve(process.cwd()) + "/")
) {
  fail(`--out must be outside the repo (hard rule 1): ${outDir}`);
}

const photos = readdirSync(input)
  .filter((name) => /\.(jpe?g|png)$/i.test(name))
  .sort(compareFileNames);
if (photos.length === 0) fail(`No .jpg or .png photos in ${input}.`);

interface Report {
  readonly file: string;
  readonly code: KitCode | null;
  readonly verdict: "slate" | "ready" | "retake" | "unidentified";
  readonly checks: readonly { tone: string; message: string }[];
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server at ${url} did not become ready in time.`);
}

async function checkAll(): Promise<Report[]> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/learn/check`, { waitUntil: "networkidle" });
    await page
      .getByTestId("learning-check-input")
      .setInputFiles(photos.map((p) => join(input, p)));
    await page.waitForFunction(
      () =>
        (
          document.querySelector('[data-testid="learning-check-json"]')
            ?.textContent ?? ""
        ).length > 0,
      null,
      { timeout: 60_000 + photos.length * 20_000 },
    );
    const json = await page.getByTestId("learning-check-json").textContent();
    return (JSON.parse(json ?? "{}") as { reports: Report[] }).reports;
  } finally {
    await browser.close();
  }
}

async function main() {
  let server: ChildProcess | null = null;
  if (!externalBase) {
    console.log(`Starting dev server on ${baseUrl} …`);
    server = spawn(
      "npx",
      ["next", "dev", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        stdio: "ignore",
        shell: true,
      },
    );
  }
  try {
    await waitForServer(`${baseUrl}/learn/check`, 90_000);
    console.log(`Checking ${photos.length} photos from ${input} …`);
    const reports = await checkAll();

    const byFile = new Map(reports.map((r) => [r.file, r]));
    const sort = sortPhotos(
      reports.map((r, i) => ({
        file: r.file,
        takenAt: i,
        code: r.verdict === "retake" ? null : r.code,
        detectedHand: null,
      })),
      LEARNING_KIT_VERSION,
    );

    let copied = 0;
    let skipped = 0;
    if (!dryRun) {
      for (const p of sort.photos) {
        if (!p.destination) continue;
        const target = join(outDir, p.destination);
        if (existsSync(target)) {
          skipped++;
          continue;
        }
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(join(input, p.file), target);
        copied++;
      }
      for (const participant of new Set(
        sort.photos.map((p) => p.participant).filter(Boolean),
      )) {
        const truth = join(outDir, participant!, "truth.json");
        if (!existsSync(truth)) {
          writeFileSync(
            truth,
            JSON.stringify(
              {
                participant,
                handLengthMm: null,
                palmWidthMm: null,
                note: "Copy the ruler values written on slate.jpg. Hand length: wrist crease to middle fingertip.",
              },
              null,
              2,
            ) + "\n",
          );
        }
      }
      const runs = join(outDir, "runs");
      mkdirSync(runs, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      writeFileSync(
        join(runs, `${stamp}.json`),
        JSON.stringify({ input, reports, sort }, null, 2),
      );
    }

    const count = (s: string) =>
      sort.photos.filter((p) => p.status === s).length;
    console.log(
      `\n${photos.length} photos: ${count("slate")} cards, ${count("ok")} filed, ` +
        `${count("no-code")} without a readable kit code or to retake, ` +
        `${count("no-participant")} before any card, ${count("version-mismatch")} from another kit version.`,
    );
    if (!dryRun)
      console.log(
        `Copied ${copied} to ${outDir}${skipped ? ` (${skipped} already there, left as is)` : ""}.`,
      );

    const retakes = reports.filter(
      (r) => r.verdict === "retake" || r.verdict === "unidentified",
    );
    if (retakes.length) {
      console.log("\nRetake or check:");
      for (const r of retakes) {
        const reasons = r.checks
          .filter((c) => c.tone === "bad")
          .map((c) => c.message);
        console.log(`  ${r.file}: ${reasons.join(" ")}`);
      }
    }
    const short = sort.coverage.filter((c) => c.got < c.expected);
    if (short.length) {
      console.log("\nShort of photos:");
      for (const c of short) {
        console.log(
          `  ${c.participant} ${c.gesture}${c.hand === "right" ? "R" : "L"}: ${c.got} of ${c.expected}`,
        );
      }
    }
    const unfiled = sort.photos.filter((p) => p.status === "no-participant");
    if (unfiled.length) {
      console.log(
        `\n${unfiled.length} photos came before any participant card and were not filed.`,
      );
    }
    if (!byFile.size) console.log("No reports returned.");
  } finally {
    server?.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
