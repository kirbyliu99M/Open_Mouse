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
 * AGENTS hard rules 1 and 5). It refuses an output folder inside the repo,
 * inside the main checkout, or inside any other git worktree. Files are copied,
 * never moved; an existing destination is never overwritten.
 *
 * The dev server is started and stopped by `withDevServer`
 * (src/lib/learning/devserver.ts): it is always stopped, also on Ctrl+C.
 *
 * Everything printed goes through `say`/`warn`/`fail`, which show no absolute
 * path and no account name: the photo and output folders as paths relative to
 * where the command ran, this checkout and the working folder as `.`, the
 * account name as `~`. A failure prints its message only, never a stack.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PAPER_SIZES_MM,
  type PaperSize,
} from "../src/lib/contracts/measurement";
import { compareFileNames } from "../src/lib/learning/checks";
import {
  DEV_SERVER_HOST,
  devServerSpec,
  waitForServer,
  withDevServer,
} from "../src/lib/learning/devserver";
import {
  buildSorterRunLog,
  containingRoot,
  gitRefusalRoots,
  looksLikeMsysPath,
  realpathLoose,
  terminalRedaction,
} from "../src/lib/learning/paths";
import type { LearningPhotoReport } from "../src/lib/learning/report";
import {
  NO_PROVENANCE,
  readGitProvenance,
  sortReports,
  type LearningRunLog,
} from "../src/lib/learning/runlog";
import { installLastResort, makeTerminal } from "../src/lib/learning/terminal";
import { emptyTruth } from "../src/lib/learning/truth";

if (process.env.CI) {
  console.error("learn-sort reads real hand photos and must never run in CI.");
  process.exit(1);
}

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Run git in this checkout; `null` when git is missing or this is not a repository. */
function git(args: readonly string[]): string | null {
  try {
    return execFileSync("git", [...args], {
      cwd: scriptRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function osUsername(): string | null {
  try {
    return userInfo().username;
  } catch {
    return null;
  }
}

// What the terminal may show (see the header). Replaced by a wider one once
// the folders are known; until then it already hides this checkout, the
// working folder, the account name and every other absolute path.
let terminal = makeTerminal(
  terminalRedaction({
    cwd: process.cwd(),
    scriptRoot,
    username: osUsername(),
  }),
);
const show = (text: string) => terminal.show(text);
const say = (text: string) => terminal.say(text);
const warn = (text: string) => terminal.warn(text);
const failure = (err: unknown) => terminal.failure(err);

function fail(message: string): never {
  warn(message);
  process.exit(1);
}

// The last line of defence: whatever escapes everything below still goes out
// as a redacted message, never a raw stack.
installLastResort(failure, (code) => process.exit(code));

async function run(): Promise<void> {
  const arg = (flag: string) => {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  // `roots`: every checkout an output folder must stay out of (this one, the main
  // one and every other worktree git lists). The default output sits next to the
  // main checkout.
  const { mainRoot, roots } = gitRefusalRoots(scriptRoot, git);
  const inDir = arg("--in");
  const outDir = resolve(
    arg("--out") ?? resolve(mainRoot, "..", "Fixtures", "learning"),
  );
  const port = Number(arg("--port") ?? 3401);
  const externalBase = arg("--base");
  const baseUrl = externalBase ?? `http://${DEV_SERVER_HOST}:${port}`;
  const dryRun = process.argv.includes("--dry-run");
  const paperArg = arg("--paper") ?? "a4";

  // The photo folder is resolved here, before it is checked, so that a complaint
  // about it is redacted too.
  terminal = makeTerminal(
    terminalRedaction({
      cwd: process.cwd(),
      scriptRoot,
      checkouts: roots,
      input: inDir ? resolve(inDir) : undefined,
      outDir,
      username: osUsername(),
    }),
  );

  // "/c/Users/me" is Git Bash's spelling; Node would read it as a folder named
  // "c" on the current drive, and create it. Refuse before anything is made.
  for (const [flag, value] of [
    ["--in", inDir],
    ["--out", arg("--out")],
  ] as const) {
    if (value !== undefined && looksLikeMsysPath(value)) {
      fail(
        `${flag} looks like a Git Bash path (a slash, one letter, a slash), which Windows reads as a folder on the current drive. Give the Windows form instead: the drive letter, a colon, then the folders with backslashes.`,
      );
    }
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
  const insideRoot = containingRoot(
    realpathLoose(outDir),
    roots.map(realpathLoose),
  );
  if (insideRoot) {
    fail(
      `--out must be outside the repo and every git worktree (hard rule 1): ${outDir}`,
    );
  }

  const photos = readdirSync(input)
    .filter((name) => /\.(jpe?g|png)$/i.test(name))
    .sort(compareFileNames);
  if (photos.length === 0) fail(`No .jpg or .png photos in ${input}.`);

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
    return readGitProvenance((args) => {
      const out = git(args);
      if (out === null) throw new Error("git failed");
      return out;
    });
  }

  /** Check the photos on a dev server this run starts (and always stops), or on `--base`. */
  async function reportsFromServer(): Promise<LearningPhotoReport[]> {
    const readyUrl = `${baseUrl}/learn/check`;
    if (externalBase) {
      await waitForServer(readyUrl, { redact: show });
      say(`Checking ${photos.length} photos from ${input} …`);
      return checkAll();
    }
    return withDevServer(
      {
        spec: devServerSpec(scriptRoot, port),
        port,
        readyUrl,
        log: say,
        redact: show,
      },
      async () => {
        say(`Checking ${photos.length} photos from ${input} …`);
        return checkAll();
      },
    );
  }

  async function main() {
    const reports = await reportsFromServer();

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
      const log = buildSorterRunLog({
        reports,
        sort,
        paperSize,
        input,
        cwd: process.cwd(),
        username: osUsername(),
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
    say(
      `\n${photos.length} photos: ${count("slate")} cards, ${count("ok")} filed, ` +
        `${count("hand-mismatch")} filed with a hand that differs from the page, ` +
        `${count("no-code")} without a readable kit code or to retake, ` +
        `${count("no-participant")} before any card, ${count("version-mismatch")} from another kit version.`,
    );
    if (!dryRun)
      say(
        `Copied ${copied} to ${outDir}${skipped ? ` (${skipped} already there, left as is)` : ""}.`,
      );
    if (externalBase)
      say(
        "The code version of an external --base server is unknown, so the run log has no git commit.",
      );

    const mismatched = sort.photos.filter((p) => p.status === "hand-mismatch");
    if (mismatched.length) {
      say("\nHand differs from the page (check the right page was used):");
      for (const p of mismatched) say(`  ${p.file} → ${p.destination}`);
    }
    const retakes = reports.filter(
      (r) => r.verdict === "retake" || r.verdict === "unidentified",
    );
    if (retakes.length) {
      say("\nRetake or check:");
      for (const r of retakes) {
        const reasons = r.checks
          .filter((c) => c.tone === "bad")
          .map((c) => c.message);
        say(`  ${r.file}: ${reasons.join(" ")}`);
      }
    }
    const short = sort.coverage.filter((c) => c.got < c.expected);
    if (short.length) {
      say("\nShort of photos:");
      for (const c of short) {
        say(
          `  ${c.participant} ${c.gesture}${c.hand === "right" ? "R" : "L"}: ${c.got} of ${c.expected}`,
        );
      }
    }
    const unfiled = sort.photos.filter((p) => p.status === "no-participant");
    if (unfiled.length) {
      say(
        `\n${unfiled.length} photos came before any participant card and were not filed.`,
      );
    }
    if (reports.length === 0) say("No reports returned.");
  }

  await main();
}

// The message only: a stack is a list of absolute paths. Everything above,
// argument checks and folder listing included, runs inside `run`.
run().catch((err) => {
  failure(err);
  process.exit(1);
});
