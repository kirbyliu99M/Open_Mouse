/**
 * Learning-kit sorter (kit v2, protocol `agreed-v2`): checks a folder of
 * session photos with the real `/learn/check` page (headless Chromium,
 * MediaPipe and all), then files each photo by participant and pose, outside
 * the repo:
 *
 *   npm run learn:sort -- --in "D:/DCIM/Camera" --session "D:/Fixtures/learning/sessions/S001/session.json"
 *
 *   ../Fixtures/learning/P007/G02/1.jpg … 3.jpg   (EXIF-stripped copies)
 *   ../Fixtures/learning/P007/G04/1.jpg … 2.jpg
 *   ../Fixtures/learning/P007/participant.json    (template, filled in from the consent flow; never overwritten)
 *   ../Fixtures/learning/runs/<time>.json         (run log, format 3)
 *   <folder of session.json>/labels.json          (blank, for Kirby's blind good/bad labels; never overwritten)
 *
 * The participant comes from the QR code of the card in the sheet's slot, on
 * every photo. The pose comes from the shooting order in file-name order: five
 * photos are G02 x3 then G04 x2, and any other count is placed only if Kirby
 * wrote `shotCounts` in the participant's `participant.json`; otherwise the
 * participant goes to review and none of their photos is filed. The sorter
 * never guesses a pose. The hand is the one in `participant.json`; MediaPipe's
 * label is only a check. See docs/learning/README.md, "Kit v2".
 *
 * Options: --in <folder of photos>, --session <session.json> (required: the
 * sorter refuses to run without a valid one), --out <dir> (default: next to the
 * main checkout, in Fixtures/learning), --paper a4 (optional: kit v2 is A4 only,
 * and a session's paperSize is always a4), --port <n> (default 3401; a dev server is
 * started), --base <url> (use a running server instead), --dry-run (report
 * only, write nothing), --show-checks (print the pose-check calls and hand
 * flags too, after the "label first" line).
 *
 * Every image-like file in the folder (.jpg, .jpeg, .jfif, .png, .heic, .heif) is
 * analysed in file-name order. A file whose copy cannot be made (a PNG, a
 * HEIC the browser cannot read, a damaged JPEG) keeps its place in the order,
 * so the photos after it do not shift pose, but it is not filed.
 *
 * EXIF. The filed copies are stripped of EXIF (GPS, time, device, XMP, IPTC,
 * comments); only the Orientation tag survives, in a rebuilt minimal EXIF, so
 * a copy stays upright. The originals in the input folder are only read. The
 * EXIF white-list in the run log (focal length, pixel size) comes from the
 * checker's analysis of the originals. A file that cannot be stripped is not
 * copied at all.
 *
 * BLIND LABELLING. The run log holds the product's verdict for every photo.
 * By default the terminal summary shows counts and file names only: no
 * verdict, no pose-check call, no hand flag, no millimetre value (those need
 * `--show-checks`, and print after a line saying to label first). Kirby labels
 * the photos good or bad first (prereg v2, 2.1). Everything after the checker
 * is `runSorterWithReports` in src/lib/learning/sorterrun.ts.
 *
 * NEVER runs in CI: it reads real people's hand photos (docs/PLAN.md §M2,
 * AGENTS hard rules 1 and 5). It refuses an output folder inside the repo,
 * inside the main checkout, or inside any other git worktree. Files are
 * copied, never moved; an existing destination is never overwritten.
 *
 * The dev server is started and stopped by `withDevServer`
 * (src/lib/learning/devserver.ts): it is always stopped, also on Ctrl+C.
 *
 * Everything printed goes through `say`/`warn`/`fail`, which show no absolute
 * path and no account name: the photo and output folders as paths relative to
 * where the command ran, this checkout and the working folder as `.`, the
 * account name as `~`. A failure prints its message only, never a stack.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PaperSize } from "../src/lib/contracts/measurement";
import {
  DEV_SERVER_HOST,
  devServerSpec,
  waitForServer,
  withDevServer,
} from "../src/lib/learning/devserver";
import { listPhotoFiles } from "../src/lib/learning/inputfiles";
import { fileTimeInversions } from "../src/lib/learning/order";
import {
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
  type LearningRunLog,
} from "../src/lib/learning/runlog";
import { parseSessionFile } from "../src/lib/learning/sessionfile";
import { runSorterWithReports } from "../src/lib/learning/sorterrun";
import { installLastResort, makeTerminal } from "../src/lib/learning/terminal";

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

const USAGE =
  'Usage: npm run learn:sort -- --in "<folder of photos>" --session "<session.json>" [--out <dir>] [--paper a4] [--dry-run] [--show-checks]';

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
  const sessionArg = arg("--session");
  const outDir = resolve(
    arg("--out") ?? resolve(mainRoot, "..", "Fixtures", "learning"),
  );
  const port = Number(arg("--port") ?? 3401);
  const externalBase = arg("--base");
  const baseUrl = externalBase ?? `http://${DEV_SERVER_HOST}:${port}`;
  const dryRun = process.argv.includes("--dry-run");
  const showChecks = process.argv.includes("--show-checks");
  const paperArg = arg("--paper");

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
    ["--session", sessionArg],
  ] as const) {
    if (value !== undefined && looksLikeMsysPath(value)) {
      fail(
        `${flag} looks like a Git Bash path (a slash, one letter, a slash), which Windows reads as a folder on the current drive. Give the Windows form instead: the drive letter, a colon, then the folders with backslashes.`,
      );
    }
  }

  if (!inDir) fail(USAGE);
  // Kit v2 is A4 only (Kirby, 2026-10-02): `--paper a4` is accepted, nothing else.
  if (paperArg !== undefined && paperArg !== "a4")
    fail(`--paper must be a4 (kit v2 is A4 only), not "${paperArg}".`);
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

  // Every image-like file counts, in camera order, so a file that cannot be
  // filed (a HEIC the browser cannot read, a PNG) keeps its place and the
  // photos after it do not shift pose.
  const { photos, skipped } = listPhotoFiles(
    readdirSync(input, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name),
  );
  if (photos.length === 0)
    fail(`No photos (.jpg, .jpeg, .jfif, .png, .heic, .heif) in ${input}.`);

  // The session record: the sorter does not run without a valid one.
  if (!sessionArg) {
    fail(
      `--session is required: the sorter needs a valid session.json. ${USAGE}`,
    );
  }
  const sessionPath = resolve(sessionArg);
  if (!existsSync(sessionPath) || !statSync(sessionPath).isFile()) {
    fail("--session is not a file.");
  }
  // labels.json (and nothing else of ours) is written next to session.json, so
  // that folder gets the same refusal as --out: never inside the repo or any
  // git worktree.
  if (
    containingRoot(
      realpathLoose(dirname(sessionPath)),
      roots.map(realpathLoose),
    )
  ) {
    fail(
      "--session must be in a folder outside the repo and every git worktree (labels.json is written next to it; hard rule 1).",
    );
  }
  const parsedSession = parseSessionFile(readFileSync(sessionPath, "utf8"));
  if (!parsedSession.ok) fail(parsedSession.message);
  const session = parsedSession.value;
  const paperSize: PaperSize = session.paperSize;
  const sessionDir = dirname(sessionPath);

  async function checkAll(): Promise<LearningPhotoReport[]> {
    // Loaded here, not at the top, so argument checks (and their tests) do not
    // wait for Playwright to load.
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(
        `${baseUrl}/learn/check?paper=${paperSize}&sheet=${session.sheet}`,
        { waitUntil: "networkidle" },
      );
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
    const inversions = fileTimeInversions(
      photos.map((file) => ({
        file,
        mtimeMs: statSync(join(input, file)).mtimeMs,
      })),
    );
    if (inversions > 0) {
      warn(
        `${inversions} photo${inversions === 1 ? " is" : "s are"} older, by file time, than the one before ${inversions === 1 ? "it" : "them"} in file-name order. The shooting order here follows the file names: check that they run in shooting order (a phone that restarted its numbering, or two cards merged, breaks it).`,
      );
    }

    const reports = await reportsFromServer();

    const result = runSorterWithReports({
      reports,
      inputDir: input,
      outDir,
      sessionDir,
      session,
      cwd: process.cwd(),
      username: osUsername(),
      provenance: provenance(),
      now: new Date(),
      dryRun,
      showChecks,
      externalServer: externalBase !== undefined,
      skippedFiles: skipped,
    });
    for (const line of result.lines) {
      if (line.kind === "warn") warn(line.text);
      else say(line.text);
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
