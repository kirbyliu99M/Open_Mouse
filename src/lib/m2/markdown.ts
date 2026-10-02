/**
 * The Markdown summary of an evaluation report, for the terminal. It holds
 * only what the report holds: totals, anonymous participant codes and photo
 * ids like "P007/G01R/3".
 */
import type {
  EvaluationReport,
  EvalGroup,
  ExclusionRow,
  ExclusionSummaryRow,
  FieldResult,
} from "./evaluate";
import { GRIP_PREDICTION } from "../../server/fit/coefficients";
import type { JudgementSection, JudgementStats } from "./judgement";
import type { KitV2Report } from "./kitv2";
import type { AnyEvaluationReport } from "./run";
import type { Reading } from "./thresholds";

const mm = (v: number | null): string => (v === null ? "n/a" : v.toFixed(2));

/**
 * A reading's value, shown with two decimals unless that would make it look
 * equal to its limit when it is not (the verdict is decided on the unrounded
 * value: "2.00 mm against 2.00 mm: OUTSIDE" is unreadable). Then it gets as
 * many decimals as it takes to tell the two apart, up to eight.
 */
export function readingValue(valueMm: number | null, limitMm: number): string {
  if (valueMm === null) return "n/a";
  let digits = 2;
  while (
    digits < 8 &&
    valueMm !== limitMm &&
    valueMm.toFixed(digits) === limitMm.toFixed(digits)
  ) {
    digits++;
  }
  return valueMm.toFixed(digits);
}

function readingLine(r: Reading): string {
  const verdict =
    r.withinLimit === null ? "n/a" : r.withinLimit ? "within" : "OUTSIDE";
  return `- ${r.name}: ${readingValue(r.valueMm, r.limitMm)} mm against ${mm(r.limitMm)} mm: **${verdict}**`;
}

interface FieldView {
  /** Show the accuracy part. Off under agreed-v2, where accuracy is dormant (no ruler truth). */
  readonly accuracy: boolean;
  /** The per-person rows were dropped (`--aggregate-only`). */
  readonly aggregateOnly: boolean;
  /** Heading of the field, e.g. "####". */
  readonly heading: string;
}

const DEFAULT_VIEW: FieldView = {
  accuracy: true,
  aggregateOnly: false,
  heading: "####",
};

function fieldSection(
  field: string,
  result: FieldResult,
  view: FieldView = DEFAULT_VIEW,
): string[] {
  const out: string[] = [`${view.heading} ${field}`, ""];
  const s = result.accuracy.stats;
  if (!view.accuracy) {
    // Dormant: nothing to say here, the accuracy section says it once.
  } else if (!s) {
    out.push("Accuracy: no photo has a ruler value for this measurement.", "");
  } else {
    out.push(
      "| n | bias | MAE | largest \\|error\\| | SD | 95% LoA lower | 95% LoA upper |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      `| ${s.n} | ${mm(s.bias)} | ${mm(s.mae)} | ${mm(s.maxAbsError)} | ${mm(s.sd)} | ${mm(s.loa?.lower ?? null)} | ${mm(s.loa?.upper ?? null)} |`,
      "",
    );
    if (result.accuracy.readings.length > 0) {
      out.push(
        "Accuracy against the candidate limit (every reading is shown; none is the verdict):",
        ...result.accuracy.readings.map(readingLine),
        "",
      );
    }
  }
  const r = result.repeatability;
  if (!r.summary) {
    out.push(
      "Repeatability: no participant, hand and pose has two photos.",
      "",
    );
  } else {
    out.push(
      "| groups | mean range | worst range | mean SD | pooled SD | worst deviation from mean |",
      "| --- | --- | --- | --- | --- | --- |",
      `| ${r.summary.groups} | ${mm(r.summary.meanRange)} | ${mm(r.summary.maxRange)} | ${mm(r.summary.meanSd)} | ${mm(r.summary.pooledSd)} | ${mm(r.summary.maxDeviationFromMean)} |`,
      "",
    );
    if (r.readings.length > 0) {
      out.push(
        "Repeatability against the candidate limit (every reading is shown; none is the verdict):",
        ...r.readings.map(readingLine),
        "",
      );
    }
    if (view.aggregateOnly) {
      out.push("Per-person rows are not included (--aggregate-only).", "");
    } else {
      out.push(
        "| participant | hand | pose | n | range | SD | deviation from mean |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        ...r.rows.map(
          (row) =>
            `| ${row.participant} | ${row.hand ?? "?"} | ${row.gesture} | ${row.n} | ${mm(row.range)} | ${mm(row.sd)} | ${mm(row.maxDeviationFromMean)} |`,
        ),
        "",
      );
    }
  }
  return out;
}

const GROUP_TITLE: Record<EvalGroup, string> = {
  accepted: "Photos the product would accept",
  all: "All measured photos",
};

function excludedLine(row: ExclusionRow): string {
  const where = [row.stage, row.path, row.field].filter(Boolean).join(" / ");
  return `- ${row.id} (${where}): ${row.reasons.join(", ")}`;
}

function excludedSummaryLine(row: ExclusionSummaryRow): string {
  const where = [row.stage, row.path, row.field].filter(Boolean).join(" / ");
  return `- ${row.count} x ${row.reason} (${where})`;
}

/** The excluded section: the rows, or under `--aggregate-only` the counts they made up. */
function excludedSection(report: {
  readonly excluded: readonly ExclusionRow[];
  readonly aggregateOnly: boolean;
  readonly excludedSummary?: readonly ExclusionSummaryRow[];
}): string[] {
  if (report.aggregateOnly) {
    const summary = report.excludedSummary ?? [];
    return [
      "## Excluded photos",
      "",
      "Per-photo rows are not included (--aggregate-only); counts by reason:",
      "",
      summary.length === 0
        ? "None."
        : summary.map(excludedSummaryLine).join("\n"),
      "",
    ];
  }
  return [
    "## Excluded photos",
    "",
    report.excluded.length === 0
      ? "None."
      : report.excluded.map(excludedLine).join("\n"),
    "",
  ];
}

export function renderMarkdown(report: AnyEvaluationReport): string {
  return report.protocol === "agreed-v2"
    ? renderKitV2Markdown(report)
    : renderCandidateV1Markdown(report);
}

function renderCandidateV1Markdown(report: EvaluationReport): string {
  const lines: string[] = [
    `# M2 evaluation: ${report.model}`,
    "",
    `Limits: ${report.thresholds.status}.`,
    `Every reading below is shown and none is chosen as the verdict.`,
    "",
    `- Paths: ${report.options.paths.join(", ")}`,
    `- Poses: ${report.options.gestures.join(", ")}`,
    `- Participants: ${report.options.participants ? (report.aggregateOnly ? `${report.options.participantCount} asked for` : report.options.participants.join(", ")) : "all in the logs"} (${report.inputs.participantCount} evaluated)`,
    `- Reports: ${report.counts.reports}: ${report.counts.cards} participant cards, ${report.counts.measured} measured, ${report.counts.notMeasured} not measured, ${report.counts.outOfScope} of other poses or participants`,
    ...(report.aggregateOnly
      ? ["- Per-person and per-photo rows are not included (--aggregate-only)."]
      : []),
    "",
  ];
  for (const group of ["accepted", "all"] as const) {
    lines.push(`## ${GROUP_TITLE[group]}`, "");
    for (const path of report.options.paths) {
      const result = report.groups[group][path];
      if (!result) continue;
      lines.push(`### ${path} (${result.photos} photos)`, "");
      for (const [field, fieldResult] of Object.entries(result.fields)) {
        lines.push(
          ...fieldSection(field, fieldResult, {
            ...DEFAULT_VIEW,
            aggregateOnly: report.aggregateOnly,
          }),
        );
      }
    }
  }
  lines.push(
    ...excludedSection(report),
    "## Definitions (candidate, awaiting the W7 pre-agreement)",
    "",
    "- error = measured - ruler value of the same hand of the same participant",
    "- bias = mean error; MAE = mean |error|; SD = sample SD of the errors (n - 1)",
    "- 95% LoA (Bland-Altman) = bias +/- 1.96 x SD",
    "- repeatability group = one participant, one hand, one pose; range = max - min; SD uses n - 1",
    "",
  );
  return lines.join("\n");
}

/**
 * Why nothing could be evaluated, from the report's own counts and the
 * exclusion reasons: the explanation that goes with a non-zero exit. It never
 * points at an "excluded list" that has nothing in it.
 */
export function nothingEvaluatedReason(report: AnyEvaluationReport): string {
  const c = report.counts;
  if (c.reports === 0) return "The run logs hold no photo reports at all.";
  const parts: string[] = [];
  if (c.cards > 0) parts.push(`${c.cards} are participant cards`);
  if (c.outOfScope > 0) {
    const who = report.options.participants
      ? report.aggregateOnly
        ? `${report.options.participantCount} asked for`
        : report.options.participants.join(", ")
      : "all";
    parts.push(
      report.protocol === "agreed-v2"
        ? `${c.outOfScope} are of participants outside this run's set (${report.options.selection}; asked for: ${who}) or of other poses than selected (poses ${report.options.gestures.join(", ")} and the per-person poses)`
        : `${c.outOfScope} are of other poses or participants than selected (poses ${report.options.gestures.join(", ")}; participants ${who})`,
    );
  }
  if (c.notMeasured > 0) {
    const counts = new Map<string, number>();
    if (report.aggregateOnly) {
      for (const row of report.excludedSummary ?? []) {
        if (row.stage !== "measurement") continue;
        counts.set(row.reason, (counts.get(row.reason) ?? 0) + row.count);
      }
    } else {
      for (const row of report.excluded) {
        if (row.stage !== "measurement") continue;
        for (const reason of row.reasons)
          counts.set(reason, (counts.get(reason) ?? 0) + 1);
      }
    }
    const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([reason, n]) => `${reason} x${n}`)
      .join(", ");
    parts.push(
      `${c.notMeasured} were in scope but could not be measured${top ? ` (${top})` : ""}`,
    );
  }
  return `No photo could be evaluated: of ${c.reports} reports, ${parts.length > 0 ? parts.join("; ") : "none matched"}.`;
}

// ── agreed-v2 ───────────────────────────────────────────────────────────────

const pct = (v: number | null): string =>
  v === null ? "n/a" : `${(v * 100).toFixed(1)}%`;
const ratio = (v: number | null): string => (v === null ? "n/a" : v.toFixed(3));
const thr = (v: number): string => v.toFixed(4);
const mmSigned = (v: number | null): string =>
  v === null ? "n/a" : (v > 0 ? "+" : "") + v.toFixed(2);

const ROLE_TITLE: Record<string, string> = {
  calibration: "calibration",
  "held-out": "held-out",
  s0: "S0 pilot",
  pending: "pending (block not complete)",
  unnumbered: "not numbered",
};

function selectionSection(report: KitV2Report): string[] {
  const sel = report.selection;
  const modeRole = sel.mode === "calibration" ? "calibration" : sel.mode;
  const rows = (
    ["calibration", "held-out", "s0", "pending", "unnumbered"] as const
  ).map(
    (role) =>
      `| ${ROLE_TITLE[role]} | ${sel.roles[role]} | ${role === modeRole ? "evaluated here" : sel.leftOutPhotos[role]} |`,
  );
  const out = [
    "## Participants",
    "",
    `Held-out rule of the prereg (seed ${sel.seed}): participants in blocks of four; in each complete block the one with the smallest SHA-256 of "<seed>:<participant>" is held-out. The S0 pilot is never calibration and never held-out. A block that is not complete yet is pending: its members are neither.`,
    "",
    "| role | participants | photos left out of this run |",
    "| --- | --- | --- |",
    ...rows,
    "",
    `This run evaluates: ${modeRole === "calibration" ? "the calibration set (held-out, S0 and pending participants are left out)" : modeRole === "held-out" ? "the held-out set only" : "the S0 pilot only"}: ${sel.inSet} participants, ${report.inputs.participantCount} with a measured photo.`,
    "",
  ];
  if (sel.leftOutPhotos.notRequested > 0) {
    out.push(
      `${sel.leftOutPhotos.notRequested} photos belong to participants in this set that --participants did not name.`,
      "",
    );
  }
  if (sel.requestedOutsideSetCount > 0) {
    out.push(
      report.aggregateOnly
        ? `${sel.requestedOutsideSetCount} participants named with --participants are not in this run's set and were not evaluated.`
        : `Named with --participants but not in this run's set, so not evaluated: ${sel.requestedOutsideSet.join(", ")}.`,
      "",
    );
  }
  return out;
}

function judgementStatsLines(stats: JudgementStats): string[] {
  const of = (part: number, whole: number) =>
    whole === 0 ? "n/a" : pct(part / whole);
  const out = [
    `Labelled photos: ${stats.photos} (labels: ${stats.labelGood} good, ${stats.labelBad} bad; product: ${stats.productAccepted} accepted, ${stats.productRetake} retake).`,
    "",
    "| measure | photos | share of labelled photos | share of its own group |",
    "| --- | --- | --- | --- |",
    `| agreement (accepted and good, or retake and bad) | ${stats.agree} | ${pct(stats.agreementRate)} |  |`,
    `| false accepts (the product accepted, the label says bad) | ${stats.falseAccepts} | ${pct(stats.falseAcceptRate)} | ${of(stats.falseAccepts, stats.labelBad)} of the ${stats.labelBad} bad |`,
    `| false rejects (the product asked for a retake, the label says good) | ${stats.falseRejects} | ${pct(stats.falseRejectRate)} | ${of(stats.falseRejects, stats.labelGood)} of the ${stats.labelGood} good |`,
    "",
  ];
  if (stats.noGateRecord > 0) {
    out.push(
      `${stats.noGateRecord} of these photos have no recorded product verdict and are counted as not accepted.`,
      "",
    );
  }
  out.push(
    "| pose | labelled | agreement | false accepts | false rejects |",
    "| --- | --- | --- | --- | --- |",
    ...stats.byPose.map(
      (p) =>
        `| ${p.gesture} | ${p.photos} | ${p.agree} (${pct(p.agreementRate)}) | ${p.falseAccepts} | ${p.falseRejects} |`,
    ),
    "",
    "| reason on the label (a bad photo may have several) | bad photos | the product asked for a retake | the product accepted (false accepts) |",
    "| --- | --- | --- | --- |",
    ...stats.byReason.map(
      (x) => `| ${x.reason} | ${x.badPhotos} | ${x.retake} | ${x.accepted} |`,
    ),
    "",
  );
  return out;
}

/** " (a x2, b x1)" from counts, or "" when there are none. */
function byKey(counts: Readonly<Record<string, number>>): string {
  const parts = Object.entries(counts)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, n]) => `${key} x${n}`);
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}

function judgementSection(j: JudgementSection, labelsFiles: number): string[] {
  const c = j.coverage;
  const out: string[] = [
    "## Judgement correctness (headline)",
    "",
    `How often the product's accept or retake verdict on a photo agrees with the labeller's own blind good or bad label of it. Target: ${pct(j.target)}. It is a target, not a pass or fail threshold.`,
    "",
    `The product's verdict is ${j.verdictBasis}. Hand-label agreement is reported separately, under the product gates.`,
    "",
  ];
  if (labelsFiles === 0) {
    out.push(
      `No labels file was given (--labels), so judgement correctness is not computed. All ${c.photos} G02 and G04 photos of the evaluated participants are unlabelled.`,
      "",
    );
    return out;
  }
  if (j.headline) {
    out.push(
      `Blind labels (the headline), target ${pct(j.target)}:`,
      "",
      ...judgementStatsLines(j.headline),
    );
  } else {
    out.push("No photo has a blind label, so there is no headline number.", "");
  }
  if (j.notBlind) {
    out.push(
      "Labels from sessions marked not blind, reported apart and left out of the headline:",
      "",
      ...judgementStatsLines(j.notBlind),
    );
  }
  out.push(
    `G02 and G04 photos of the evaluated participants: ${c.photos}. Labelled: ${c.labelled} (blind ${c.labelledBlind}, not blind ${c.labelledNotBlind}). Left out as unlabelled: ${c.unlabelled} (no session in the run log ${c.unlabelledBy.noSession}; no labels file for the session ${c.unlabelledBy.noLabelsFile}; the labels file does not mention the photo ${c.unlabelledBy.noLabel}; placed but not filed ${c.unlabelledBy.notFiled}; not labelled yet ${c.unlabelledBy.notLabelledYet}).`,
    "",
    `Photos the sorter did not file, so none can be labelled and none is in the judgement: ${c.notFiled.total}${byKey(c.notFiled.byStatus)}. Participants in review (nothing of theirs is filed): ${c.participantsInReview.total}${byKey(c.participantsInReview.byReason)}.`,
    "",
    `Labels that name no photo in the run logs: ${c.labelsWithNoPhoto}. Sessions with evaluated photos: ${j.sessions.withPhotos}; with a labels file: ${j.sessions.withLabelsFile}; with every evaluated photo labelled: ${j.sessions.fullyLabelled}; blind: ${j.sessions.blind}; not blind: ${j.sessions.notBlind}.`,
    "",
  );
  return out;
}

function kitV2Sections(report: KitV2Report): string[] {
  const k = report.kitV2;
  const out: string[] = [];

  // The headline first: judgement correctness against Kirby's blind labels.
  out.push(...judgementSection(k.judgement, report.inputs.labelsFiles));

  // Repeatability: report only, with the prereg's 1.0 mm as a reference value.
  const r = k.repeatability;
  out.push(
    "## G02 retake repeatability (marker path, hand length)",
    "",
    `Report only. The prereg (version 2) gives ${mm(r.referenceMm)} mm as a reference value for the pooled within-person SD; it is not a pass or fail threshold, and no verdict is drawn from it. This is retake repeatability, not accuracy.`,
    "",
    "| people with 2+ photos | photos behind the SD | people with one photo | degrees of freedom | pooled within-person SD | reference value |",
    "| --- | --- | --- | --- | --- | --- |",
    `| ${r.people} | ${r.photosBehindSd} | ${r.peopleWithPhotos - r.people} | ${r.degreesOfFreedom} | ${r.pooledSdMm === null ? "n/a" : `${mm(r.pooledSdMm)} mm`} | ${mm(r.referenceMm)} mm |`,
    "",
    `Mean of the people's own SDs: ${mm(r.meanSdMm)} mm. Worst range within one person: ${mm(r.worstRangeMm)} mm. ${r.peopleWithPhotos} people and ${r.photos} G02 photos in all.`,
    "",
  );

  // Path agreement.
  const a = k.pathAgreement;
  out.push(
    "## Agreement of the paper-edge path with the marker path (G02 hand length)",
    "",
    "Paper-edge minus marker, mm. Report only. Each person's photos are averaged first; the bias and SD are taken over people.",
    "",
    "| level | n | bias | SD |",
    "| --- | --- | --- | --- |",
    a.personLevel
      ? `| people (each person's mean first) | ${a.personLevel.n} | ${mmSigned(a.personLevel.biasMm)} | ${mm(a.personLevel.sdMm)} |`
      : "| people (each person's mean first) | 0 | n/a | n/a |",
    a.photoLevel
      ? `| photo-level (photos treated as if independent; for the record) | ${a.photoLevel.n} | ${mmSigned(a.photoLevel.biasMm)} | ${mm(a.photoLevel.sdMm)} |`
      : "| photo-level (photos treated as if independent; for the record) | 0 | n/a | n/a |",
    "",
  );

  // Curl ratio.
  const c = k.curl;
  const d = c.distribution;
  out.push(
    "## Curl ratio (G04 over G02, marker plane)",
    "",
    "A G04 photo's wrist-to-middle-fingertip length projected on the marker plane, divided by the same person's mean G02 hand length. Report only.",
    "",
    "| people | G04 photos | mean over people | SD over people | min | Q1 | median | Q3 | max |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    d
      ? `| ${c.people} | ${c.photos} | ${ratio(d.mean)} | ${ratio(d.sd)} | ${ratio(d.min)} | ${ratio(d.q1)} | ${ratio(d.median)} | ${ratio(d.q3)} | ${ratio(d.max)} |`
      : `| ${c.people} | ${c.photos} | n/a | n/a | n/a | n/a | n/a | n/a | n/a |`,
    "",
    `Retake variation within a person (people with 2+ G04 photos): ${c.withinPerson.people} people, ${c.withinPerson.photos} photos, pooled SD ${ratio(c.withinPerson.pooledSd)}, mean of the SDs ${ratio(c.withinPerson.meanSd)}.`,
    `Left out: ${c.skipped.noG02} people with no usable G02 photo, ${c.skipped.noG04} with no usable G04 photo.`,
    "",
  );

  // Gates.
  out.push(
    "## Product gates by pose",
    "",
    "Accepted over all photos of the pose, whatever happened to them. Report only. The hand label is MediaPipe's, against the hand the participant record gives.",
    "",
    "| pose | photos | accepted | accepted rate | hand found | hand label agrees (of those with both) |",
    "| --- | --- | --- | --- | --- | --- |",
    ...k.gate.poses.map(
      (p) =>
        `| ${p.gesture} | ${p.photos} | ${p.accepted} | ${pct(p.acceptedRate)} | ${p.handDetected} (${pct(p.detectionRate)}) | ${p.handLabelAgrees} of ${p.handLabelChecked} (${pct(p.handLabelAgreementRate)}) |`,
    ),
    "",
    `Extra shots logged: ${k.gate.extraShots}.`,
    "",
  );

  // Coverage.
  const cov = k.coverage;
  const countTable = (title: string, rows: typeof cov.byPhone) => [
    `| ${title} | people | photos |`,
    "| --- | --- | --- |",
    ...(rows.length === 0
      ? ["| none | 0 | 0 |"]
      : rows.map((x) => `| ${x.value} | ${x.people} | ${x.photos} |`)),
    "",
  ];
  out.push(
    "## Coverage",
    "",
    `${cov.people} people and ${cov.photos} G02 and G04 photos. Report only.`,
    "",
    `Hand length: each person's mean G02 marker-path hand length, in 10 mm bins (${cov.peopleWithHandLength} people).`,
    "",
    "| from (mm) | to (mm) | people |",
    "| --- | --- | --- |",
    ...(cov.handLengthBins.length === 0
      ? ["| none | none | 0 |"]
      : cov.handLengthBins.map(
          (b) => `| ${b.fromMm} | ${b.toMm} | ${b.people} |`,
        )),
    "",
    ...countTable("phone", cov.byPhone),
    ...countTable("light", cov.byLight),
    ...countTable("sheet", cov.bySheet),
    ...countTable("mouse hand", cov.byMouseHand),
  );

  // Grip calibration.
  const g = k.grip;
  const cal = g.calibration;
  out.push(
    "## Grip-threshold calibration (report only)",
    "",
    "r = palm length / hand length, each person's mean over their G02 photos on the marker plane (palm: wrist to the middle finger's base joint; hand: wrist to the middle fingertip; the product's own definitions). It is set against the grip the participant reported. The product's thresholds are not changed here.",
    "",
    `People evaluated: ${g.people}. Left out: ${g.skipped.unsure} unsure, ${g.skipped.noAnswer} with no answer, ${g.skipped.noRecord} with no participant record, ${g.skipped.noG02} with no usable G02 photo.`,
    "",
  );
  if (!cal) {
    out.push("No person has both a reported grip and a G02 ratio.", "");
  } else {
    const matrix = (m: typeof cal.current.matrix): string[] => [
      "| reported (rows) vs predicted (columns) | palm | claw | fingertip |",
      "| --- | --- | --- | --- |",
      ...(["palm", "claw", "fingertip"] as const).map(
        (self) =>
          `| ${self} | ${m[self].palm} | ${m[self].claw} | ${m[self].fingertip} |`,
      ),
      "",
    ];
    const cur = cal.current;
    out.push(
      `Current thresholds (palm at r >= ${thr(cur.thresholds.palmAtOrAbove)}, claw at r >= ${thr(cur.thresholds.clawAtOrAbove)}, otherwise fingertip): agreement ${cur.agree} of ${cur.people} (${pct(cur.rate)}).`,
      "",
      ...matrix(cur.matrix),
    );
    const best = cal.best.agreement;
    out.push(
      `Threshold pair with the highest agreement on these people: palm at r >= ${thr(best.thresholds.palmAtOrAbove)}, claw at r >= ${thr(best.thresholds.clawAtOrAbove)}: agreement ${best.agree} of ${best.people} (${pct(best.rate)}). ${cal.best.tiedPairs} threshold pairs reach this agreement; the one nearest the current thresholds is shown. It was chosen on the very people it is scored on, so it is optimistic.`,
      "",
      ...matrix(best.matrix),
    );
  }
  return out;
}

function personTable(report: KitV2Report): string[] {
  const rows = report.kitV2.people;
  return [
    "## Per-person rows",
    "",
    "| participant | hand | G02 photos | mean hand length (mm) | SD (mm) | paper-edge minus marker (mm) | G04 photos | curl ratio | curl SD | grip reported | r | grip predicted |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map(
      (p) =>
        `| ${p.participant} | ${p.hand ?? "?"} | ${p.g02.photos} | ${mm(p.g02.meanHandLengthMm)} | ${mm(p.g02.sdMm)} | ${mmSigned(p.pathDifference.meanMm)} | ${p.curl.photos} | ${ratio(p.curl.meanRatio)} | ${ratio(p.curl.sdRatio)} | ${p.gripSelf ?? "no answer"} | ${ratio(p.gripRatio)} | ${p.gripPredicted ?? "n/a"} |`,
    ),
    "",
  ];
}

function renderKitV2Markdown(report: KitV2Report): string {
  const lines: string[] = [`# M2 evaluation (agreed-v2): ${report.model}`, ""];
  for (const notice of report.notices) lines.push(`> **${notice}**`, "");
  lines.push(
    "Protocol agreed-v2, frozen in the prereg (version 2) of 2026-10-02. The reference is the marker plane of the same sheet: there is no ruler truth. Every measurement below is agreement with the marker-sheet reference or retake repeatability; the headline is how often the product's accept or retake verdict agrees with the labeller's blind labels.",
    "",
    `- Paths (field tables): ${report.options.paths.join(", ")}`,
    `- Poses (field tables): ${report.options.gestures.join(", ")}. The per-person statistics always use G02 and G04.`,
    `- Participants: ${report.options.participants ? (report.aggregateOnly ? `${report.options.participantCount} asked for` : report.options.participants.join(", ")) : "everyone in this run's set"} (${report.inputs.participantCount} evaluated)`,
    `- Reports: ${report.counts.reports}: ${report.counts.measured} measured, ${report.counts.notMeasured} not measured, ${report.counts.outOfScope} of participants outside this run's set or of other poses`,
    ...(report.aggregateOnly
      ? ["- Per-person and per-photo rows are not included (--aggregate-only)."]
      : []),
    "",
    ...selectionSection(report),
    "## Accuracy",
    "",
    `Dormant: ${report.accuracy.reason}. Under agreed-v2 there is no ruler value, so the accuracy criterion is not computed. It starts only when ruler values exist.`,
    "",
    ...kitV2Sections(report),
    `## Field tables (poses ${report.options.gestures.join(", ")}; no accuracy)`,
    "",
  );
  for (const group of ["accepted", "all"] as const) {
    lines.push(`### ${GROUP_TITLE[group]}`, "");
    for (const path of report.options.paths) {
      const result = report.groups[group][path];
      if (!result) continue;
      lines.push(`#### ${path} (${result.photos} photos)`, "");
      for (const [field, fieldResult] of Object.entries(result.fields)) {
        lines.push(
          ...fieldSection(field, fieldResult, {
            accuracy: false,
            aggregateOnly: report.aggregateOnly,
            heading: "#####",
          }),
        );
      }
    }
  }
  if (!report.aggregateOnly) lines.push(...personTable(report));
  lines.push(
    ...excludedSection(report),
    "## Definitions (agreed-v2, frozen prereg version 2 of 2026-10-02)",
    "",
    "- reference = the marker plane of the same sheet; there is no ruler truth, so nothing here is an accuracy",
    "- judgement correctness = labelled photos where the product's verdict (its photo-quality gates, handedness gate left out: accepted or retake) agrees with the labeller's blind label (good or bad) / all labelled photos; false accepts and false rejects are counted separately; target 95%, not a pass or fail threshold; labels from sessions that were not blind are reported apart",
    "- retake repeatability = pooled within-person SD of G02 hand length on the marker path: sqrt(sum((n - 1) x SD^2) / sum(n - 1)) over people with two or more photos; report only, with 1.0 mm as a reference value",
    "- path agreement = paper-edge minus marker hand length per G02 photo; averaged within each person; then bias and SD (n - 1) over people. The photo-level line treats photos as independent and is for the record",
    "- curl ratio = G04 wrist-to-middle-fingertip length on the marker plane / the same person's mean G02 hand length; report only",
    "- accepted rate = photos the product's gates take / all photos of the pose",
    "- coverage = people by 10 mm bin of their mean G02 hand length, and counts by phone, light, sheet and mouse hand",
    `- grip calibration = palm length / hand length per person (mean over G02) against the reported grip; palm at r >= ${thr(GRIP_PREDICTION.palmAtOrAbove)}, claw at r >= ${thr(GRIP_PREDICTION.clawAtOrAbove)} are the product's thresholds today`,
    "",
  );
  return lines.join("\n");
}
