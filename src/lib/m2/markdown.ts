/**
 * The Markdown summary of an evaluation report, for the terminal. It holds
 * only what the report holds: totals, anonymous participant codes and photo
 * ids like "P007/G01R/3".
 */
import type {
  EvaluationReport,
  EvalGroup,
  ExclusionRow,
  FieldResult,
} from "./evaluate";
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

function fieldSection(field: string, result: FieldResult): string[] {
  const out: string[] = [`#### ${field}`, ""];
  const s = result.accuracy.stats;
  if (!s) {
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
    out.push(
      "| participant | hand | pose | n | range | SD | deviation from mean |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...r.rows.map(
        (row) =>
          `| ${row.participant} | ${row.hand} | ${row.gesture} | ${row.n} | ${mm(row.range)} | ${mm(row.sd)} | ${mm(row.maxDeviationFromMean)} |`,
      ),
      "",
    );
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

export function renderMarkdown(report: EvaluationReport): string {
  const lines: string[] = [
    `# M2 evaluation: ${report.model}`,
    "",
    `Limits: ${report.thresholds.status}.`,
    `Every reading below is shown and none is chosen as the verdict.`,
    "",
    `- Paths: ${report.options.paths.join(", ")}`,
    `- Poses: ${report.options.gestures.join(", ")}`,
    `- Participants: ${report.options.participants ? report.options.participants.join(", ") : "all in the logs"} (${report.inputs.participants.length} evaluated)`,
    `- Reports: ${report.counts.reports}: ${report.counts.cards} participant cards, ${report.counts.measured} measured, ${report.counts.notMeasured} not measured, ${report.counts.outOfScope} of other poses or participants`,
    "",
  ];
  for (const group of ["accepted", "all"] as const) {
    lines.push(`## ${GROUP_TITLE[group]}`, "");
    for (const path of report.options.paths) {
      const result = report.groups[group][path];
      if (!result) continue;
      lines.push(`### ${path} (${result.photos} photos)`, "");
      for (const [field, fieldResult] of Object.entries(result.fields)) {
        lines.push(...fieldSection(field, fieldResult));
      }
    }
  }
  lines.push(
    "## Excluded photos",
    "",
    report.excluded.length === 0
      ? "None."
      : report.excluded.map(excludedLine).join("\n"),
    "",
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
export function nothingEvaluatedReason(report: EvaluationReport): string {
  const c = report.counts;
  if (c.reports === 0) return "The run logs hold no photo reports at all.";
  const parts: string[] = [];
  if (c.cards > 0) parts.push(`${c.cards} are participant cards`);
  if (c.outOfScope > 0) {
    parts.push(
      `${c.outOfScope} are of other poses or participants than selected (poses ${report.options.gestures.join(", ")}; participants ${report.options.participants ? report.options.participants.join(", ") : "all"})`,
    );
  }
  if (c.notMeasured > 0) {
    const counts = new Map<string, number>();
    for (const row of report.excluded) {
      if (row.stage !== "measurement") continue;
      for (const reason of row.reasons)
        counts.set(reason, (counts.get(reason) ?? 0) + 1);
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
