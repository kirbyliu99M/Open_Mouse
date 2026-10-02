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
 * every photo. The pose comes from the shooting order (G02 x3 then G04 x2) in
 * file-name order; one extra shot per participant is allowed and is placed by
 * the pose check, or the participant goes to review and none of their photos
 * is filed. The hand is the one in `participant.json`; MediaPipe's label is
 * only a check. See docs/learning/README.md, "Kit v2".
 *
 * Options: --in <folder of photos>, --session <session.json> (required: the
 * sorter refuses to run without a valid one), --out <dir> (default: next to the
 * main checkout, in Fixtures/learning), --paper a4|letter (must agree with the
 * session's paperSize if given), --port <n> (default 3401; a dev server is
 * started), --base <url> (use a running server instead), --dry-run (report
 * only, write nothing).
 *
 * EXIF. The filed copies are stripped of EXIF (GPS, time, device, XMP, IPTC,
 * comments); only the Orientation tag survives, in a rebuilt minimal EXIF, so
 * a copy stays upright. The originals in the input folder are only read. The
 * EXIF white-list in the run log (focal length, pixel size) was read from the
 * originals. A file that cannot be stripped (a PNG, a damaged JPEG) is not
 * copied at all.
 *
 * BLIND LABELLING. The run log holds the product's verdict for every photo,
 * and the terminal summary below shows none and no millimetre value: Kirby
 * labels the photos good or bad first (prereg v2, 2.1).
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
import {
  existsSync,
  mkdirSync,
  readFileSync,
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
import { EXIF_STRIP_MODE } from "../src/lib/learning/exifstrip";
import {
  fileStrippedCopies,
  readMouseHands,
  writeLabelsTemplate,
  writeParticipantTemplates,
} from "../src/lib/learning/filing";
import { LEARNING_KIT_VERSION } from "../src/lib/learning/kit";
import { fileTimeInversions } from "../src/lib/learning/order";
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
  sortReportsV2,
  type LearningRunLog,
} from "../src/lib/learning/runlog";
import { parseSessionFile } from "../src/lib/learning/sessionfile";
import { REVIEW_REASON_TEXT } from "../src/lib/learning/sortv2";
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
  'Usage: npm run learn:sort -- --in "<folder of photos>" --session "<session.json>" [--out <dir>] [--paper a4|letter] [--dry-run]';

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
  if (paperArg !== undefined && !Object.hasOwn(PAPER_SIZES_MM, paperArg))
    fail(
      `--paper must be one of ${Object.keys(PAPER_SIZES_MM).join(", ")}, not "${paperArg}".`,
    );
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
  const parsedSession = parseSessionFile(readFileSync(sessionPath, "utf8"));
  if (!parsedSession.ok) fail(parsedSession.message);
  const session = parsedSession.value;
  if (paperArg !== undefined && paperArg !== session.paperSize) {
    fail(
      `--paper ${paperArg} disagrees with the session's paperSize (${session.paperSize}). Leave --paper out: the session decides.`,
    );
  }
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

    // Each participant's mouse hand, from the participant.json files already
    // there (the sorter never writes one over another).
    const named = [
      ...new Set(
        reports.flatMap((r) =>
          r.code?.kind === "participant" &&
          r.code.version === LEARNING_KIT_VERSION
            ? [r.code.participant]
            : [],
        ),
      ),
    ];
    const known = readMouseHands({ participants: named, outDir });
    const sort = sortReportsV2(reports, { mouseHands: known.hands });
    const filedFiles = sort.photos.flatMap((p) =>
      p.destination ? [p.destination] : [],
    );

    let copied = 0;
    let existing = 0;
    let refused: { file: string; reason: string }[] = [];
    let created: readonly string[] = [];
    let labels: ReturnType<typeof writeLabelsTemplate> | null = null;
    if (!dryRun) {
      const filed = fileStrippedCopies({
        photos: sort.photos,
        inputDir: input,
        outDir,
      });
      copied = filed.copied.length;
      existing = filed.existing.length;
      refused = filed.refused.map((r) => ({ ...r }));
      created = writeParticipantTemplates({
        participants: sort.participants.map((p) => p.participant),
        session: session.session,
        outDir,
      }).created;
      labels = writeLabelsTemplate({
        dir: sessionDir,
        runsDir: join(outDir, "runs"),
        session: session.session,
        files: filedFiles,
      });
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
        kitV2: { session, sheet: session.sheet },
      });
      writeFileSync(
        join(runs, `${stamp}.json`),
        JSON.stringify(log, null, 2) + "\n",
      );
    }

    // What follows names files and counts. It shows no product verdict (the
    // retake list of kit v1) and no millimetre value: the photos are labelled
    // good or bad blind, before anyone sees the product's judgement.
    const count = (s: string) =>
      sort.photos.filter((p) => p.status === s).length;
    const filed = sort.photos.filter((p) => p.destination !== null);
    say(
      `\n${photos.length} photos: ${filed.length} filed (session ${session.session}, sheet ${session.sheet}), ` +
        `${count("needs-review")} in a participant's review, ` +
        `${count("no-code")} without a readable participant card, ` +
        `${count("version-mismatch")} from another kit version.`,
    );
    say(
      dryRun
        ? `EXIF (not run: --dry-run): filed copies would be stripped, mode ${EXIF_STRIP_MODE}.`
        : `EXIF: filed copies stripped, mode ${EXIF_STRIP_MODE} (only the Orientation tag is kept, in a rebuilt minimal EXIF; GPS, time, device, XMP, IPTC and comments are dropped; originals untouched).`,
    );
    if (!dryRun)
      say(
        `Copied ${copied} to ${outDir}${existing ? ` (${existing} already there, left as is)` : ""}.`,
      );
    if (externalBase)
      say(
        "The code version of an external --base server is unknown, so the run log has no git commit.",
      );
    if (refused.length) {
      warn(
        `\n${refused.length} photo${refused.length === 1 ? " was" : "s were"} not copied, because a copy cannot be made without its EXIF (only a complete JPEG can be stripped):`,
      );
      for (const r of refused) say(`  ${r.file}: ${r.reason}`);
    }

    const review = sort.participants.filter((p) => p.status === "needs-review");
    if (review.length) {
      say("\nNeeds review (none of their photos is filed):");
      for (const p of review) {
        const calls = p.predictedPoses.map((c) => c ?? "?").join(" ");
        say(
          `  ${p.participant}, ${p.photos} photos: ${p.reason ? REVIEW_REASON_TEXT[p.reason] : ""}. Pose check, in order: ${calls}`,
        );
      }
    }
    const poseOff = sort.photos.filter((p) => p.status === "pose-mismatch");
    if (poseOff.length) {
      say(
        "\nThe pose check disagrees with the shooting order (filed in the order's pose; check these):",
      );
      for (const p of poseOff) {
        say(
          `  ${p.file} → ${p.destination} (looks like ${p.poseCheck?.predicted})`,
        );
      }
    }
    const byFile = new Map(reports.map((r) => [r.file, r]));
    const handOff = sort.photos.filter((p) => {
      const detected = byFile.get(p.file)?.hand?.handedness ?? null;
      return p.hand !== null && detected !== null && detected !== p.hand;
    });
    if (handOff.length) {
      say(
        "\nMediaPipe's hand differs from the mouse hand in participant.json (a check only; filed as the file says):",
      );
      for (const p of handOff) say(`  ${p.file} → ${p.destination}`);
    }
    const short = sort.coverage.filter((c) => c.got < c.expected);
    if (short.length) {
      say("\nShort of photos:");
      for (const c of short) {
        say(`  ${c.participant} ${c.gesture}: ${c.got} of ${c.expected}`);
      }
    }
    const extras = sort.coverage.filter((c) => c.extra > 0);
    if (extras.length) {
      say("\nExtra shot, filed in the pose the pose check chose:");
      for (const c of extras) say(`  ${c.participant} ${c.gesture}`);
    }
    const unread = sort.photos.filter((p) => p.status === "no-code");
    if (unread.length) {
      say(
        `\n${unread.length} photo${unread.length === 1 ? "" : "s"} with no readable participant card (not filed):`,
      );
      for (const p of unread) say(`  ${p.file}`);
    }
    const other = sort.photos.filter((p) => p.status === "version-mismatch");
    if (other.length) {
      say(`\n${other.length} from another kit version (not filed):`);
      for (const p of other) say(`  ${p.file}`);
    }
    if (known.problems.length) {
      warn("\nA participant.json that could not be used:");
      for (const p of known.problems) warn(`  ${p.message}`);
    }
    const noHand = sort.participants.filter((p) => p.hand === null);
    if (noHand.length) {
      say(
        `\nNo mouse hand yet (fill in participant.json, then run this again to check MediaPipe's hand): ${noHand.map((p) => p.participant).join(" ")}`,
      );
    }
    if (created.length) {
      say(`participant.json templates written: ${created.join(" ")}`);
    }
    if (labels) {
      if (labels.status === "created") {
        say(
          `labels.json written next to session.json: ${filedFiles.length} photos to label.`,
        );
      } else if (labels.status === "refused") {
        warn(`labels.json not written: ${labels.problem}`);
      } else if (labels.problem) {
        warn(`labels.json left alone: ${labels.problem}`);
      } else {
        say("labels.json already there, left as is.");
      }
      if (labels.missing.length) {
        warn(
          `labels.json has no entry for ${labels.missing.length} filed photo${labels.missing.length === 1 ? "" : "s"}: ${labels.missing.join(" ")}`,
        );
      }
    }
    say(
      "\nLabel the photos good or bad in labels.json BEFORE you open the run log or /learn/check: both show the product's verdict, and the labels must be made blind.",
    );
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
