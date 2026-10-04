/**
 * `--aggregate-only`: the same report with every per-person and per-photo row
 * dropped, for text that is pasted into a pull request. What stays is what
 * cannot point at one person or one photo: totals, rates, distributions,
 * counts by label, thresholds. Pure.
 *
 * What goes: the participant lists (evaluated, asked for, asked for but left
 * out), the repeatability rows of the field tables, the per-person table, the
 * per-person rows of each statistic, and the excluded-photo rows (they name
 * photos like "P007/G02R/3"). The excluded rows leave their counts behind, by
 * stage, path, field and reason.
 */
import type {
  EvaluationReport,
  ExclusionRow,
  ExclusionSummaryRow,
  FieldResult,
  PathResult,
} from "./evaluate";
import type { KitV2Report } from "./kitv2";
import type { AnyEvaluationReport } from "./run";

/** How many exclusion rows there were for each stage, path, field and reason (a row with several reasons counts once for each). */
export function summariseExclusions(
  rows: readonly ExclusionRow[],
): ExclusionSummaryRow[] {
  const counts = new Map<string, ExclusionSummaryRow>();
  for (const row of rows) {
    for (const reason of row.reasons) {
      const key = [row.stage, row.path ?? "", row.field ?? "", reason].join(
        "\u0000",
      );
      const existing = counts.get(key);
      counts.set(key, {
        stage: row.stage,
        path: row.path,
        field: row.field,
        reason,
        count: (existing?.count ?? 0) + 1,
      });
    }
  }
  return [...counts.values()].sort(
    (a, b) =>
      a.stage.localeCompare(b.stage) ||
      (a.path ?? "").localeCompare(b.path ?? "") ||
      (a.field ?? "").localeCompare(b.field ?? "") ||
      a.reason.localeCompare(b.reason),
  );
}

type Groups = EvaluationReport["groups"];

/** The field tables without their per-person repeatability rows. */
function withoutRows(groups: Groups): Groups {
  const stripPath = (result: PathResult): PathResult => ({
    ...result,
    fields: Object.fromEntries(
      Object.entries(result.fields).map(
        ([name, field]): [string, FieldResult] => [
          name,
          { ...field, repeatability: { ...field.repeatability, rows: [] } },
        ],
      ),
    ),
  });
  const stripGroup = (group: Groups["all"]): Groups["all"] =>
    Object.fromEntries(
      Object.entries(group).map(([path, result]) => [path, stripPath(result!)]),
    );
  return { accepted: stripGroup(groups.accepted), all: stripGroup(groups.all) };
}

function aggregateCandidateV1(report: EvaluationReport): EvaluationReport {
  return {
    ...report,
    options: {
      ...report.options,
      participants: report.options.participants ? [] : null,
    },
    inputs: { ...report.inputs, participants: [] },
    groups: withoutRows(report.groups),
    excluded: [],
    aggregateOnly: true,
    excludedSummary: summariseExclusions(report.excluded),
  };
}

function aggregateKitV2(report: KitV2Report): KitV2Report {
  const k = report.kitV2;
  return {
    ...report,
    options: {
      ...report.options,
      participants: report.options.participants ? [] : null,
    },
    selection: { ...report.selection, requestedOutsideSet: [] },
    inputs: { ...report.inputs, participants: [] },
    groups: withoutRows(report.groups),
    kitV2: {
      ...k,
      repeatability: { ...k.repeatability, rows: [] },
      pathAgreement: { ...k.pathAgreement, rows: [] },
      curl: { ...k.curl, rows: [] },
      people: [],
    },
    excluded: [],
    aggregateOnly: true,
    excludedSummary: summariseExclusions(report.excluded),
  };
}

/** The report with every per-person and per-photo row dropped. */
export function toAggregateOnly(
  report: AnyEvaluationReport,
): AnyEvaluationReport {
  return report.protocol === "agreed-v2"
    ? aggregateKitV2(report)
    : aggregateCandidateV1(report);
}
