/**
 * Learning-kit sorter: checks a folder of session photos with the real
 * `/learn/check` page (headless Chromium, MediaPipe and all), then files each
 * usable photo by participant and pose, outside the repo:
 *
 *   npm run learn:sort -- --in "D:/DCIM/Camera"
 *
 *   ../Fixtures/learning/P007/slate.jpg
 *   ../Fixtures/learning/P007/G01R/1.jpg … 5.jpg
 *   ../Fixtures/learning/P007/truth.json      (template: ruler values, right and left hand apart)
 *   ../Fixtures/learning/runs/<time>.json     (run log, format 2: every photo's checks, landmarks, planes)
 *
 * Options: --out <dir> (default: next to the main checkout, in
 * Fixtures/learning), --paper a4|letter (size of the printed pages, default
 * a4), --port <n> (default 3401; a dev server is started), --base <url> (use a
 * running server instead), --dry-run (report only, copy nothing).
 *
 * NEVER runs in CI: it reads real people's hand photos (docs/PLAN.md §M2,
 * AGENTS hard rules 1 and 5). It refuses an output folder inside the repo or
 * inside the main checkout that owns this worktree. Files are copied, never
 * moved; an existing destination is never overwritten.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { userInfo } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PAPER_SIZES_MM,
  type PaperSize,
} from "../src/lib/contracts/measurement";
import { compareFileNames } from "../src/lib/learning/checks";
import {
  containingRoot,
  mainCheckoutOf,
  relativeInputPath,
} from "../src/lib/learning/paths";
import type { LearningPhotoReport } from "../src/lib/learning/report";
import {
  NO_PROVENANCE,
  buildRunLog,
  readGitProvenance,
  sortReports,
  type LearningRunLog,
} from "../src/lib/learning/runlog";
import { emptyTruth } from "../src/lib/learning/truth";

if (process.env.CI) {
  console.error("learn-sort reads real hand photos and must never run in CI.");
  process.exit(1);
}

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The checkout that owns this one when it is a git worktree; otherwise this checkout. */
function mainCheckoutRoot(): string {
  let common: string | null = null;
  try {
    common = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: scriptRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // no git: this checkout is the only one we know
  }
  return mainCheckoutOf(scriptRoot, common || null);
}

/** `realpath`, also for a folder that does not exist yet (its nearest existing parent is resolved). */
function realpathLoose(path: string): string {
  let current = resolve(path);
  const tail: string[] = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return resolve(path);
    tail.unshift(basename(current));
    current = parent;
  }
  return join(realpathSync.native(current), ...tail);
}

const arg = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const mainRoot = mainCheckoutRoot();
const inDir = arg("--in");
const outDir = resolve(
  arg("--out") ?? resolve(mainRoot, "..", "Fixtures", "learning"),
);
const port = Number(arg("--port") ?? 3401);
const externalBase = arg("--base");
const baseUrl = externalBase ?? `http://127.0.0.1:${port}`;
const dryRun = process.argv.includes("--dry-run");
const paperArg = arg("--paper") ?? "a4";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!inDir)
  fail(
    'Usage: npm run learn:sort -- --in "<folder of photos>" [--out <dir>] [--paper a4|letter] [--dry-run]',
  );
if (!Object.hasOwn(PAPER_SIZES_MM, paperArg))
  fail(
    `--paper must be one of ${Object.keys(PAPER_SIZES_MM).join(", ")}, not "${paperArg}".`,
  );
const paperSize = paperArg as PaperSize;
const input = resolve(inDir);
if (!existsSync(input) || !statSync(input).isDirectory())
  fail(`Not a folder: ${input}`);
const insideRoot = containingRoot(realpathLoose(outDir), [
  realpathLoose(scriptRoot),
  realpathLoose(mainRoot),
]);
if (insideRoot) {
  fail(`--out must be outside the repo (hard rule 1): ${outDir}`);
}

const photos = readdirSync(input)
  .filter((name) => /\.(jpe?g|png)$/i.test(name))
  .sort(compareFileNames);
if (photos.length === 0) fail(`No .jpg or .png photos in ${input}.`);

async function answers(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

/** End the dev server and everything it started (Next forks a worker), so no server is left on the port. */
function stopServer(child: ChildProcess) {
  if (child.pid === undefined) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } else {
      process.kill(-child.pid, "SIGTERM");
    }
  } catch {
    child.kill();
  }
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

async function checkAll(): Promise<LearningPhotoReport[]> {
  // Loaded here, not at the top, so argument checks (and their tests) do not
  // wait for Playwright to load.
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/learn/check?paper=${paperSize}`, {
      waitUntil: "networkidle",
    });
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
    return (JSON.parse(json ?? "{}") as LearningRunLog).reports.slice();
  } finally {
    await browser.close();
  }
}

/** The commit of the checkout that serves the checker; unknown for an external server. */
function provenance() {
  if (externalBase) return NO_PROVENANCE;
  return readGitProvenance((args) =>
    execFileSync("git", [...args], {
      cwd: scriptRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  );
}

function osUsername(): string | null {
  try {
    return userInfo().username;
  } catch {
    return null;
  }
}

async function main() {
  let server: ChildProcess | null = null;
  if (!externalBase) {
    console.log(`Starting dev server on ${baseUrl} …`);
    // A server already answering here would be a stale one (an earlier run's,
    // or another branch's) and the run log's git commit would not describe it.
    if (await answers(`${baseUrl}/learn/check`))
      fail(
        `Something already answers on ${baseUrl}. Stop it, choose another --port, or pass --base to use it on purpose.`,
      );
    // Node runs Next directly (no shell), in its own process group where the
    // platform has them, so `stopServer` can end the whole tree.
    server = spawn(
      process.execPath,
      [
        join(scriptRoot, "node_modules", "next", "dist", "bin", "next"),
        "dev",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        cwd: scriptRoot,
        stdio: "ignore",
        detached: process.platform !== "win32",
      },
    );
  }
  try {
    await waitForServer(`${baseUrl}/learn/check`, 90_000);
    console.log(`Checking ${photos.length} photos from ${input} …`);
    const reports = await checkAll();

    const sort = sortReports(reports);

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
            JSON.stringify(emptyTruth(participant!), null, 2) + "\n",
          );
        }
      }
      const runs = join(outDir, "runs");
      mkdirSync(runs, { recursive: true });
      const now = new Date();
      const stamp = now.toISOString().replace(/[:.]/g, "-");
      const log = buildRunLog({
        reports,
        sort,
        paperSize,
        // Relative to where the command ran, so the log carries no account name.
        input: relativeInputPath(input, process.cwd(), {
          username: osUsername(),
        }),
        provenance: provenance(),
        now,
      });
      writeFileSync(
        join(runs, `${stamp}.json`),
        JSON.stringify(log, null, 2) + "\n",
      );
    }

    const count = (s: string) =>
      sort.photos.filter((p) => p.status === s).length;
    console.log(
      `\n${photos.length} photos: ${count("slate")} cards, ${count("ok")} filed, ` +
        `${count("hand-mismatch")} filed with a hand that differs from the page, ` +
        `${count("no-code")} without a readable kit code or to retake, ` +
        `${count("no-participant")} before any card, ${count("version-mismatch")} from another kit version.`,
    );
    if (!dryRun)
      console.log(
        `Copied ${copied} to ${outDir}${skipped ? ` (${skipped} already there, left as is)` : ""}.`,
      );
    if (externalBase)
      console.log(
        "The code version of an external --base server is unknown, so the run log has no git commit.",
      );

    const mismatched = sort.photos.filter((p) => p.status === "hand-mismatch");
    if (mismatched.length) {
      console.log(
        "\nHand differs from the page (check the right page was used):",
      );
      for (const p of mismatched) console.log(`  ${p.file} → ${p.destination}`);
    }
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
    if (reports.length === 0) console.log("No reports returned.");
  } finally {
    if (server) stopServer(server);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
