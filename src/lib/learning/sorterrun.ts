/**
 * Everything `learn:sort` does once the checker has produced its reports:
 * read the participants' records, sort by shooting order, write the stripped
 * copies, the `participant.json` templates, `labels.json` and the run log, and
 * work out what to tell the person. Node only (it writes files). The script
 * calls it with the reports it got from the browser; tests call it with
 * reports made from synthetic scenes, so the whole main path runs without a
 * browser, a server or a photo.
 *
 * BLIND LABELLING. The lines it returns by default are counts, file names and
 * what has to be fixed, never a product verdict, a pose-check call, a
 * MediaPipe hand flag or a millimetre value: Kirby labels the photos good or
 * bad before seeing the product's judgement (prereg v2, 2.1). Those details go
 * to the run log (which holds them anyway) and, only when asked
 * (`showChecks`), to the lines printed after the "label first" line.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  findOrphans,
  findUnfileable,
  fileStrippedCopies,
  readParticipantRecords,
  writeLabelsTemplate,
  writeParticipantTemplates,
} from "./filing";
import { EXIF_STRIP_MODE } from "./exifstrip";
import { skippedFilesLine } from "./inputfiles";
import { LEARNING_KIT_VERSION } from "./kit";
import { buildSorterRunLog } from "./paths";
import type { LearningPhotoReport, Provenance } from "./report";
import { sortReportsV2, type LearningRunLog } from "./runlog";
import type { SessionRecord } from "./session";
import { REVIEW_REASON_TEXT, type KitV2SortResult } from "./sortv2";

export interface SorterLine {
  readonly kind: "say" | "warn";
  readonly text: string;
}

export interface SorterRunArgs {
  readonly reports: readonly LearningPhotoReport[];
  /** The photo folder, read from only. */
  readonly inputDir: string;
  readonly outDir: string;
  /** The folder `session.json` is in; `labels.json` goes next to it. */
  readonly sessionDir: string;
  readonly session: SessionRecord;
  readonly cwd: string;
  readonly username: string | null;
  readonly provenance: Provenance;
  readonly now: Date;
  /** Report only; write nothing. */
  readonly dryRun: boolean;
  /** Print the pose-check calls and hand flags too, after the "label first" line. */
  readonly showChecks: boolean;
  /** `--base` was given: the code version of that server is unknown. */
  readonly externalServer: boolean;
  /** Files in the photo folder that are not photos, to be named in the summary. */
  readonly skippedFiles?: readonly string[];
}

export interface SorterRunResult {
  readonly sort: KitV2SortResult;
  readonly log: LearningRunLog;
  readonly lines: readonly SorterLine[];
  /** File name of the run log written under `<out>/runs`, or `null` on a dry run. */
  readonly runLogFile: string | null;
}

/** The blind-labelling reminder; the details of the checks never come before it. */
export const LABEL_FIRST_LINE =
  "Label the photos good or bad in labels.json BEFORE you open the run log or the checker page: both show the product's verdict, and the labels must be made blind.";

export function runSorterWithReports(args: SorterRunArgs): SorterRunResult {
  const lines: SorterLine[] = [];
  const say = (text: string) => lines.push({ kind: "say", text });
  const warn = (text: string) => lines.push({ kind: "warn", text });
  const { session, outDir } = args;
  const reports = args.reports;

  // What the participants' records already say (the sorter never writes over them).
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
  const known = readParticipantRecords({ participants: named, outDir });
  // A photo that names a participant but cannot be filed as a stripped copy
  // keeps its slot in the order and is not filed.
  const unfileable = findUnfileable({
    inputDir: args.inputDir,
    files: reports
      .filter(
        (r) =>
          r.code?.kind === "participant" &&
          r.code.version === LEARNING_KIT_VERSION,
      )
      .map((r) => r.file),
  });
  const sort = sortReportsV2(reports, {
    mouseHands: known.hands,
    shotCounts: known.shotCounts,
    unfileable,
  });
  const filedFiles = sort.photos.flatMap((p) =>
    p.destination ? [p.destination] : [],
  );

  let created: readonly string[] = [];
  let labels: ReturnType<typeof writeLabelsTemplate> | null = null;
  let runLogFile: string | null = null;

  // Copies first (on a dry run, only looked at): what is already on disk may
  // disagree with this run, and the run log has to say so.
  const filed = fileStrippedCopies({
    photos: sort.photos,
    inputDir: args.inputDir,
    outDir,
    dryRun: args.dryRun,
  });
  const orphans = findOrphans({
    outDir,
    participants: sort.participants.map((p) => p.participant),
    destinations: filedFiles,
  });
  const filing = { conflicts: [...filed.conflicts], orphans };
  const copied = filed.copied.length;
  const existing = filed.existing.length;
  const copyFailures = filed.refused.map((r) => r.file);

  const log = buildSorterRunLog({
    reports,
    sort,
    paperSize: session.paperSize,
    input: args.inputDir,
    cwd: args.cwd,
    username: args.username,
    provenance: args.provenance,
    now: args.now,
    kitV2: { session, sheet: session.sheet },
    filing,
  });
  if (!args.dryRun) {
    created = writeParticipantTemplates({
      participants: sort.participants.map((p) => p.participant),
      session: session.session,
      outDir,
    }).created;
    // Nothing filed, nothing to label: no empty file to mistake for a finished one.
    labels =
      filedFiles.length > 0
        ? writeLabelsTemplate({
            dir: args.sessionDir,
            runsDir: join(outDir, "runs"),
            session: session.session,
            files: filedFiles,
          })
        : null;
    const runs = join(outDir, "runs");
    mkdirSync(runs, { recursive: true });
    runLogFile = `${args.now.toISOString().replace(/[:.]/g, "-")}.json`;
    writeFileSync(join(runs, runLogFile), JSON.stringify(log, null, 2) + "\n");
  }

  // ── What to tell the person: counts and names, no verdict. ────────────────
  const count = (s: string) => sort.photos.filter((p) => p.status === s).length;
  const refusedPhotos = sort.photos.filter(
    (p) =>
      p.gesture !== null &&
      p.destination === null &&
      p.status !== "needs-review",
  );
  say(
    `\n${reports.length} photos: ${filedFiles.length} filed (session ${session.session}, sheet ${session.sheet}), ` +
      `${count("needs-review")} in a participant's review, ` +
      `${refusedPhotos.length} placed but not filed (no copy can be made), ` +
      `${count("no-code")} without a readable participant card, ` +
      `${count("version-mismatch")} from another kit version.`,
  );
  say(
    args.dryRun
      ? `EXIF (not run: --dry-run): filed copies would be stripped, mode ${EXIF_STRIP_MODE}.`
      : `EXIF: filed copies stripped, mode ${EXIF_STRIP_MODE} (only the Orientation tag is kept, in a rebuilt minimal EXIF; GPS, time, device, XMP, IPTC and comments are dropped; originals untouched).`,
  );
  if (!args.dryRun)
    say(
      `Copied ${copied} to ${outDir}${existing ? ` (${existing} already there, left as is)` : ""}.`,
    );
  if (args.externalServer)
    say(
      "The code version of an external --base server is unknown, so the run log has no git commit.",
    );
  const skippedLine = skippedFilesLine(args.skippedFiles ?? []);
  if (skippedLine) warn(`\n${skippedLine}`);
  if (refusedPhotos.length) {
    warn(
      `\n${refusedPhotos.length} photo${refusedPhotos.length === 1 ? " is" : "s are"} placed in the shooting order but NOT filed, because a copy cannot be made without its EXIF (only a complete JPEG can be stripped); export HEIC to JPEG and run again:`,
    );
    for (const p of refusedPhotos) say(`  ${p.file}: ${p.status}`);
    const who = [...new Set(refusedPhotos.map((p) => p.participant))];
    warn(
      `Participants with a photo missing from their filed sequence: ${who.join(" ")}. Their other photos are filed in the right slots; their labels and coverage are short by these.`,
    );
  }
  if (filing.conflicts.length) {
    warn(
      `\nCONFLICT: ${filing.conflicts.length} copy${filing.conflicts.length === 1 ? "" : "ies"} already on disk differ${filing.conflicts.length === 1 ? "s" : ""} from what this run files, and ${filing.conflicts.length === 1 ? "was" : "were"} NOT overwritten, so the file on disk is not the photo the run log says (an earlier run placed the photos differently):`,
    );
    for (const c of filing.conflicts) say(`  ${c}`);
    warn(
      "To resolve it: move that participant's folder in the output folder aside (do not delete it until you have looked), and run the sorter again.",
    );
  }
  if (filing.orphans.length) {
    warn(
      `\n${filing.orphans.length} copy${filing.orphans.length === 1 ? "" : "ies"} on disk that this run does not file (left over from an earlier placement, or a participant now in review); they are not in the run log's sort or in labels.json:`,
    );
    for (const o of filing.orphans) say(`  ${o}`);
    warn(
      "Move the participant's folder aside and run the sorter again to get a folder that matches the run log.",
    );
  }
  for (const file of copyFailures) {
    warn(`  ${file}: the copy failed its own check and was not written.`);
  }

  const review = sort.participants.filter((p) => p.status === "needs-review");
  if (review.length) {
    say("\nNeeds review (none of their photos is filed):");
    for (const p of review) {
      say(
        `  ${p.participant}, ${p.photos} photos: ${p.reason ? REVIEW_REASON_TEXT[p.reason] : ""}`,
      );
    }
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
    say("\nExtra shot, placed by shotCounts in participant.json:");
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
  if (!args.dryRun && !labels) {
    say("No photo was filed, so labels.json was not written.");
  }
  say(`\n${LABEL_FIRST_LINE}`);

  // ── Only on request, after the reminder: the checks' details. ─────────────
  if (args.showChecks) {
    say("\n--show-checks (label first; these are the product's own checks):");
    const poseOff = sort.photos.filter((p) => p.status === "pose-mismatch");
    if (poseOff.length) {
      say(
        "The pose check disagrees with the shooting order (filed in the order's pose):",
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
        "MediaPipe's hand differs from the mouse hand in participant.json (a check only):",
      );
      for (const p of handOff) say(`  ${p.file} → ${p.destination}`);
    }
    for (const p of review) {
      say(
        `Pose check on ${p.participant}'s photos, in order: ${p.predictedPoses.map((c) => c ?? "?").join(" ")}`,
      );
    }
    if (!poseOff.length && !handOff.length && !review.length) {
      say("Nothing to show.");
    }
  }

  return { sort, log, lines, runLogFile };
}
