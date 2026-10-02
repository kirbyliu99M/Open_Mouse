import { describe, expect, it } from "vitest";
import {
  toAggregateOnly,
  summariseExclusions,
} from "../../src/lib/m2/aggregate";
import { evaluate, evaluateJson } from "../../src/lib/m2/evaluate";
import {
  EvaluationInputError,
  RUN_LOG_FORMAT_V3,
  parseKitV2RunLog,
  parseParticipantRecord,
  parseSessionRecord,
  runLogFormatOf,
} from "../../src/lib/m2/inputs";
import { evaluateKitV2, type KitV2Report } from "../../src/lib/m2/kitv2";
import {
  nothingEvaluatedReason,
  renderMarkdown,
} from "../../src/lib/m2/markdown";
import {
  assertNoTruthUnderAgreedV2,
  protocolOfLogFormat,
  resolveProtocol,
} from "../../src/lib/m2/protocol";
import { evaluateRunJson, protocolOfRun } from "../../src/lib/m2/run";
import { hasAnyAbsolutePath } from "./helpers/no-absolute-paths";
import {
  kitV2LogOf,
  participantRecordOf,
  sessionRecordOf,
  type KitV2SynthPhoto,
} from "./helpers/m2-kitv2-synth";
import { runLogOf, truthOf } from "./helpers/m2-synth";

const NOW = new Date("2026-10-05T00:00:00Z");

const g02 = (
  participant: string,
  markersMm: number,
  paperMm: number | null = markersMm,
  extra: Partial<KitV2SynthPhoto> = {},
): KitV2SynthPhoto => ({
  participant,
  gesture: "G02",
  markersMm,
  paperMm,
  ...extra,
});
const g04 = (
  participant: string,
  markersMm: number,
  extra: Partial<KitV2SynthPhoto> = {},
): KitV2SynthPhoto => ({ participant, gesture: "G04", markersMm, ...extra });

// A complete block P001-P004 (P004 is held out), with a refusal and a missing hand.
const PHOTOS: KitV2SynthPhoto[] = [
  g02("P001", 190, 191),
  g02("P001", 191, 192),
  g02("P001", 189, 190),
  g04("P001", 152),
  g04("P001", 133, { refusedBy: { hand: ["HANDEDNESS_MISMATCH"] } }),
  g02("P002", 180, 179, { palmRatio: 0.6 }),
  g02("P002", 182, 182, { palmRatio: 0.6 }),
  g02("P002", 181, 180, {
    palmRatio: 0.6,
    refusedBy: { paper: ["PAPER_CORNER_HIDDEN"] },
  }),
  g04("P002", 145),
  g04("P002", 145, { noHand: true }),
  g02("P003", 170),
  g02("P003", 170.5),
  g04("P003", 140),
  g02("P004", 200),
  g02("P004", 205),
  g02("P004", 195),
];
const RECORDS = [
  participantRecordOf("P001", { gripSelf: "claw" }),
  participantRecordOf("P002", { gripSelf: "palm" }),
  participantRecordOf("P003", { gripSelf: "fingertip" }),
];
const LOG = kitV2LogOf(PHOTOS);

function kitReport(
  options: Parameters<typeof evaluateKitV2>[1] = {},
): KitV2Report {
  return evaluateKitV2(
    {
      logs: [parseKitV2RunLog(LOG, "run log 1")],
      records: RECORDS,
      sessions: [sessionRecordOf("S001")],
    },
    { now: NOW, ...options },
  );
}

describe("reading a format-3 run log", () => {
  it("takes the session, the sheet and the assignments, and reads nothing else of the sort", () => {
    const parsed = parseKitV2RunLog(LOG, "run log 1");
    expect(parsed.format).toBe(RUN_LOG_FORMAT_V3);
    expect(parsed.format).toBe("open-mouse-learning-run/3");
    expect(parsed.protocol).toBe("agreed-v2");
    expect(parsed.sessionId).toBe("S001");
    expect(parsed.sheet).toBe("A");
    expect(parsed.embeddedPhone).toBeNull();
    expect(parsed.reports).toHaveLength(PHOTOS.length);
    expect(parsed.sort.photos[0]).toMatchObject({
      participant: "P001",
      gesture: "G02",
      hand: "right",
      shot: 1,
      poseSource: "order",
      extraShot: false,
      poseCheck: null,
    });
  });

  it("a session record embedded in the log gives the id, the phone and the sheet", () => {
    const embedded = sessionRecordOf("S007", { phone: "Phone C", sheet: "B" });
    const parsed = parseKitV2RunLog(
      kitV2LogOf([g02("P001", 190)], { session: embedded, sheet: null }),
      "run log 1",
    );
    expect(parsed).toMatchObject({
      sessionId: "S007",
      embeddedPhone: "Phone C",
      sheet: "B",
    });
  });

  it("no session and no sheet is fine: coverage will say unknown", () => {
    const parsed = parseKitV2RunLog(
      kitV2LogOf([g02("P001", 190)], { session: null, sheet: null }),
      "run log 1",
    );
    expect(parsed.sessionId).toBeNull();
    expect(parsed.sheet).toBeNull();
  });

  it("an assignment that breaks the contract is an error that says where", () => {
    const log = kitV2LogOf([g02("P001", 190)]) as {
      sort: { photos: Record<string, unknown>[] };
    };
    log.sort.photos[0]!.poseSource = "qr";
    expect(() => parseKitV2RunLog(log, "run log 2")).toThrow(
      /^run log 2 does not fit the format: sort\.photos\.0\.poseSource/,
    );
    const bad = kitV2LogOf([g02("P001", 190)]) as Record<string, unknown>;
    bad.protocol = "candidate-v1";
    expect(() => parseKitV2RunLog(bad, "run log 1")).toThrow(
      /run log 1 does not fit the format: protocol/,
    );
    const noExtra = kitV2LogOf([g02("P001", 190)]) as {
      sort: { photos: Record<string, unknown>[] };
    };
    delete noExtra.sort.photos[0]!.extraShot;
    expect(() => parseKitV2RunLog(noExtra, "run log 1")).toThrow(/extraShot/);
  });

  it("names the log by its label, never by a path", () => {
    try {
      parseKitV2RunLog({ format: RUN_LOG_FORMAT_V3 }, "run log 3");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EvaluationInputError);
      expect((err as Error).message).toMatch(/^run log 3 /);
    }
  });

  it("sniffs the format of any JSON", () => {
    expect(runLogFormatOf(LOG)).toBe("open-mouse-learning-run/3");
    expect(runLogFormatOf({ format: 3 })).toBeNull();
    expect(runLogFormatOf({})).toBeNull();
    expect(runLogFormatOf(null)).toBeNull();
    expect(runLogFormatOf("x")).toBeNull();
  });
});

describe("participant.json and session.json", () => {
  it("a record from the contract is read back as it is", () => {
    const record = participantRecordOf("P007", { gripSelf: "claw" });
    expect(parseParticipantRecord(record, "participant record 1")).toEqual(
      record,
    );
    const session = sessionRecordOf("S002", { phone: "Phone B" });
    expect(parseSessionRecord(session, "session record 1")).toEqual(session);
  });

  it("a name, or any other key, is refused: nothing personal gets in", () => {
    expect(() =>
      parseParticipantRecord(
        { ...participantRecordOf("P007"), name: "someone" },
        "participant record 2",
      ),
    ).toThrow(/^participant record 2 is not a valid participant record/);
    expect(() =>
      parseParticipantRecord(
        { ...participantRecordOf("P007"), gripSelf: "mixed" },
        "participant record 2",
      ),
    ).toThrow(/gripSelf/);
    expect(() =>
      parseSessionRecord(
        { ...sessionRecordOf("S002"), sheet: "C" },
        "session record 1",
      ),
    ).toThrow(/^session record 1 is not a valid session record/);
  });
});

describe("the two protocols are never mixed", () => {
  it("run-log formats name their protocol", () => {
    expect(protocolOfLogFormat("open-mouse-learning-run/2")).toBe(
      "candidate-v1",
    );
    expect(protocolOfLogFormat("open-mouse-learning-run/3")).toBe("agreed-v2");
    expect(protocolOfLogFormat("open-mouse-learning-run/1")).toBeNull();
    expect(protocolOfLogFormat(null)).toBeNull();
  });

  it("logs of both formats together are an error that names both", () => {
    expect(() =>
      resolveProtocol({
        logFormats: ["open-mouse-learning-run/2", "open-mouse-learning-run/3"],
      }),
    ).toThrow(
      /format 2 \(candidate-v1\) and format 3 \(agreed-v2\) cannot be evaluated together.*never mixed.*separately/s,
    );
  });

  it("asking for the other protocol is an error, either way round", () => {
    expect(() =>
      resolveProtocol({
        logFormats: ["open-mouse-learning-run/2"],
        requested: "agreed-v2",
      }),
    ).toThrow(
      /run logs are format 2 \(candidate-v1\) but the protocol asked for is agreed-v2/,
    );
    expect(() =>
      resolveProtocol({
        logFormats: ["open-mouse-learning-run/3"],
        requested: "candidate-v1",
      }),
    ).toThrow(
      /run logs are format 3 \(agreed-v2\) but the protocol asked for is candidate-v1/,
    );
    expect(
      resolveProtocol({
        logFormats: ["open-mouse-learning-run/3"],
        requested: "agreed-v2",
      }),
    ).toBe("agreed-v2");
  });

  it("the protocol is the logs' when none is asked for", () => {
    expect(resolveProtocol({ logFormats: ["open-mouse-learning-run/3"] })).toBe(
      "agreed-v2",
    );
    expect(resolveProtocol({ logFormats: ["open-mouse-learning-run/2"] })).toBe(
      "candidate-v1",
    );
    expect(() => resolveProtocol({ logFormats: [] })).toThrow(/at least one/);
  });

  it("a v2 log under agreed-v2 is refused by evaluate() itself, and so are the kit v2 options", () => {
    const v2 = runLogOf([{ participant: "P001", hand: "right", paperMm: 190 }]);
    const input = {
      logs: [v2],
      truths: [truthOf("P001", { handLengthMm: 190, palmWidthMm: 80 })],
    };
    expect(() => evaluate(input, { protocol: "agreed-v2" })).toThrow(
      /run logs are format 2 \(candidate-v1\) but the protocol asked for is agreed-v2/,
    );
    expect(() => evaluate(input, { selection: "held-out" })).toThrow(
      /belong to agreed-v2/,
    );
    expect(() => evaluate(input, { selection: "s0" })).toThrow(
      EvaluationInputError,
    );
    expect(evaluate(input, { protocol: "candidate-v1" }).protocol).toBe(
      "candidate-v1",
    );
    // Nothing changes for a plain call.
    expect(evaluate(input).counts.measured).toBe(1);
  });

  it("a candidate-v1 truth file next to format-3 logs: the message says why and what to do", () => {
    expect(() =>
      assertNoTruthUnderAgreedV2([{ protocol: "candidate-v1" }]),
    ).toThrow(
      /Truth file 1 is a candidate-v1 file but the run logs are agreed-v2.*Leave --truth out/s,
    );
    expect(() => assertNoTruthUnderAgreedV2([])).not.toThrow();
  });
});

describe("evaluateRunJson: one door for both", () => {
  it("format-3 logs, records and sessions: agreed-v2, no truth", () => {
    const r = evaluateRunJson(
      { logs: [LOG], records: RECORDS, sessions: [sessionRecordOf("S001")] },
      { now: NOW },
    );
    expect(r.protocol).toBe("agreed-v2");
    expect(r).toEqual(kitReport());
    expect(protocolOfRun([LOG])).toBe("agreed-v2");
  });

  it("a format-3 log and a candidate-v1 truth file: refused, with the reason", () => {
    expect(() =>
      evaluateRunJson({
        logs: [LOG],
        truths: [truthOf("P001", { handLengthMm: 190, palmWidthMm: 80 })],
      }),
    ).toThrow(
      /Truth file 1 is a candidate-v1 file but the run logs are agreed-v2: candidate-v1 values are never mixed with agreed-v2/,
    );
  });

  it("a format-2 log asked for under agreed-v2 is refused", () => {
    const v2 = runLogOf([{ participant: "P001", hand: "right", paperMm: 190 }]);
    expect(() =>
      evaluateRunJson({ logs: [v2], truths: [] }, { protocol: "agreed-v2" }),
    ).toThrow(
      /run logs are format 2 \(candidate-v1\) but the protocol asked for is agreed-v2/,
    );
  });

  it("a format-3 log asked for under candidate-v1 is refused", () => {
    expect(() =>
      evaluateRunJson({ logs: [LOG] }, { protocol: "candidate-v1" }),
    ).toThrow(
      /run logs are format 3 \(agreed-v2\) but the protocol asked for is candidate-v1/,
    );
  });

  it("logs of both formats in one run are refused", () => {
    const v2 = runLogOf([{ participant: "P001", hand: "right", paperMm: 190 }]);
    expect(() => evaluateRunJson({ logs: [v2, LOG] })).toThrow(
      /cannot be evaluated together/,
    );
  });

  it("a format-2 run is what it was: the same report evaluateJson gives, plus the protocol it names", () => {
    const v2 = runLogOf(
      [188, 190, 191, 187, 189].map((paperMm) => ({
        participant: "P001",
        hand: "right" as const,
        paperMm,
      })),
    );
    const truth = truthOf("P001", { handLengthMm: 190, palmWidthMm: 80 });
    const viaRun = evaluateRunJson(
      { logs: [v2], truths: [truth] },
      { now: NOW },
    );
    const direct = evaluateJson([v2], [truth], { now: NOW });
    expect(viaRun).toEqual(direct);
    expect(viaRun.protocol).toBe("candidate-v1");
    expect(viaRun.format).toBe("open-mouse-m2-evaluation/1");
  });

  it("records belong to agreed-v2: given with a format-2 log they are refused", () => {
    const v2 = runLogOf([{ participant: "P001", hand: "right", paperMm: 190 }]);
    expect(() =>
      evaluateRunJson({ logs: [v2], truths: [], records: RECORDS }),
    ).toThrow(/belong to agreed-v2/);
  });

  it("a log of no known format is named by its place, not by a path", () => {
    expect(() =>
      evaluateRunJson({ logs: [LOG, { format: "open-mouse-learning-run/1" }] }),
    ).toThrow(
      /^run log 2 is not a run log of format 2 \(candidate-v1\) or format 3 \(agreed-v2\) \(format "open-mouse-learning-run\/1"\)/,
    );
    expect(() =>
      evaluateRunJson({ logs: [{ format: "C:\\Users\\me\\x" }] }),
    ).toThrow(
      /^run log 1 is not a run log of format 2 \(candidate-v1\) or format 3 \(agreed-v2\)\.$/,
    );
    expect(() => evaluateRunJson({ logs: [] })).toThrow(/at least one run log/);
    // No `format` at all goes to the format-2 reader, which says what is wrong as it always did.
    expect(() =>
      evaluateRunJson({ logs: [{ kitVersion: 1, reports: [] }], truths: [] }),
    ).toThrow(/^run log 1 does not fit the format/);
  });
});

describe("--aggregate-only", () => {
  const full = kitReport({ participants: ["P001", "P002", "P003", "P004"] });
  const aggregate = toAggregateOnly(full) as KitV2Report;
  const json = JSON.stringify(aggregate);
  const markdown = renderMarkdown(aggregate);

  it("keeps every aggregate number and drops every per-person and per-photo row", () => {
    expect(aggregate.aggregateOnly).toBe(true);
    expect(aggregate.kitV2.repeatability.pooledSdMm).toBe(
      full.kitV2.repeatability.pooledSdMm,
    );
    expect(aggregate.kitV2.repeatability.rows).toEqual([]);
    expect(aggregate.kitV2.pathAgreement.personLevel).toEqual(
      full.kitV2.pathAgreement.personLevel,
    );
    expect(aggregate.kitV2.pathAgreement.rows).toEqual([]);
    expect(aggregate.kitV2.curl.distribution).toEqual(
      full.kitV2.curl.distribution,
    );
    expect(aggregate.kitV2.curl.rows).toEqual([]);
    expect(aggregate.kitV2.people).toEqual([]);
    expect(aggregate.kitV2.gate).toEqual(full.kitV2.gate);
    expect(aggregate.kitV2.coverage).toEqual(full.kitV2.coverage);
    expect(aggregate.kitV2.grip).toEqual(full.kitV2.grip);
    expect(aggregate.counts).toEqual(full.counts);
    expect(aggregate.inputs.participants).toEqual([]);
    expect(aggregate.inputs.participantCount).toBe(3);
    expect(aggregate.options.participants).toEqual([]);
    expect(aggregate.options.participantCount).toBe(4);
    expect(aggregate.selection.requestedOutsideSet).toEqual([]);
    expect(aggregate.selection.requestedOutsideSetCount).toBe(1); // P004 is held out
    expect(aggregate.excluded).toEqual([]);
    for (const group of ["accepted", "all"] as const) {
      for (const path of ["markers", "paper-edge"] as const) {
        const field = aggregate.groups[group][path]!.fields.handLengthMm!;
        expect(field.repeatability.rows).toEqual([]);
        expect(field.repeatability.summary).toEqual(
          full.groups[group][path]!.fields.handLengthMm!.repeatability.summary,
        );
      }
    }
  });

  it("no participant code, anywhere, in the JSON or the Markdown", () => {
    expect(json).not.toMatch(/P\d{3}/);
    expect(markdown).not.toMatch(/P\d{3}/);
    expect(json).not.toMatch(/IMG_|\.jpg/);
    expect(markdown).not.toMatch(/IMG_|\.jpg/);
    // The full report does have them, so the check means something.
    expect(JSON.stringify(full)).toMatch(/P001/);
    expect(renderMarkdown(full)).toMatch(/P001/);
  });

  it("the excluded rows leave their counts, by reason", () => {
    expect(aggregate.excludedSummary).toEqual(
      summariseExclusions(full.excluded),
    );
    expect(aggregate.excludedSummary).toContainEqual({
      stage: "product",
      path: null,
      field: null,
      reason: "hand:HANDEDNESS_MISMATCH",
      count: 1,
    });
    expect(markdown).toMatch(
      /Per-photo rows are not included \(--aggregate-only\)/,
    );
    expect(markdown).toMatch(/1 x hand:HANDEDNESS_MISMATCH \(product\)/);
    expect(markdown).toMatch(/Per-person and per-photo rows are not included/);
    expect(markdown).not.toMatch(/## Per-person rows/);
    expect(renderMarkdown(full)).toMatch(/## Per-person rows/);
  });

  it("does not change the report it was given", () => {
    const before = JSON.stringify(full);
    toAggregateOnly(full);
    expect(JSON.stringify(full)).toBe(before);
  });

  it("works on a candidate-v1 report as well", () => {
    const v2 = runLogOf(
      [188, 190, 191, 187, 189].map((paperMm) => ({
        participant: "P001",
        hand: "right" as const,
        paperMm,
        refusedBy:
          paperMm === 191 ? { paper: ["PAPER_CORNER_HIDDEN"] } : undefined,
      })),
    );
    const truth = truthOf("P001", { handLengthMm: 190, palmWidthMm: 80 });
    const report = evaluate({ logs: [v2], truths: [truth] }, { now: NOW });
    const agg = toAggregateOnly(report);
    expect(agg.aggregateOnly).toBe(true);
    expect(agg.protocol).toBe("candidate-v1");
    expect(agg.inputs.participants).toEqual([]);
    expect(agg.inputs.participantCount).toBe(1);
    expect(agg.excluded).toEqual([]);
    expect(agg.excludedSummary).toContainEqual(
      expect.objectContaining({ stage: "product", count: 1 }),
    );
    const field = agg.groups.all["paper-edge"]!.fields.handLengthMm!;
    expect(field.repeatability.rows).toEqual([]);
    expect(field.accuracy.stats).toEqual(
      report.groups.all["paper-edge"]!.fields.handLengthMm!.accuracy.stats,
    );
    const text = renderMarkdown(agg) + JSON.stringify(agg);
    expect(text).not.toMatch(/P\d{3}/);
    // The default output still has them.
    expect(renderMarkdown(report)).toMatch(/P001/);
  });

  it("counts a row with several reasons once for each", () => {
    expect(
      summariseExclusions([
        {
          id: "a",
          stage: "product",
          path: null,
          field: null,
          reasons: ["x", "y"],
        },
        { id: "b", stage: "product", path: null, field: null, reasons: ["x"] },
        {
          id: "c",
          stage: "measurement",
          path: "markers",
          field: null,
          reasons: ["x"],
        },
      ]),
    ).toEqual([
      {
        stage: "measurement",
        path: "markers",
        field: null,
        reason: "x",
        count: 1,
      },
      { stage: "product", path: null, field: null, reason: "x", count: 2 },
      { stage: "product", path: null, field: null, reason: "y", count: 1 },
    ]);
  });
});

describe("the Markdown summary of an agreed-v2 run", () => {
  const report = kitReport();
  const md = renderMarkdown(report);

  it("says accuracy is dormant, and what the numbers are instead", () => {
    expect(md).toMatch(/^# M2 evaluation \(agreed-v2\): landmark-raw-v1/);
    expect(md).toMatch(/## Accuracy\n\nDormant: no ruler truth\./);
    expect(md).toMatch(/agreement with the marker-sheet reference/);
    expect(md).toMatch(/retake repeatability/);
  });

  it("never says 'accurate', in the summary or in the report", () => {
    expect(md).not.toMatch(/accurate/i);
    expect(JSON.stringify(report)).not.toMatch(/accurate/i);
    // The aggregate and held-out variants too.
    expect(renderMarkdown(toAggregateOnly(report))).not.toMatch(/accurate/i);
    expect(renderMarkdown(kitReport({ selection: "held-out" }))).not.toMatch(
      /accurate/i,
    );
  });

  it("shows the activated criterion against its limit, with the people and photos behind it", () => {
    // P001 190 191 189 (SD 1), P002 180 182 181 (SD 1), P003 170 170.5 (SD 0.3536): pooled 0.908.
    expect(md).toMatch(
      /## G02 retake repeatability \(marker path, hand length\)/,
    );
    expect(md).toMatch(/\| 3 \| 8 \| 0 \| 5 \| 0\.91 mm \| 1\.00 mm \|/);
  });

  it("labels the photo-level agreement as photo-level", () => {
    expect(md).toMatch(/\| people \(each person's mean first\) \| 3 \|/);
    expect(md).toMatch(
      /\| photo-level \(photos treated as if independent; for the record\) \| 8 \|/,
    );
  });

  it("has the curl, gate, coverage and grip sections, and the field tables without accuracy", () => {
    for (const heading of [
      "## Agreement of the paper-edge path with the marker path (G02 hand length)",
      "## Curl ratio (G04 over G02, marker plane)",
      "## Product gates by pose",
      "## Coverage",
      "## Grip-threshold calibration (report only)",
      "## Field tables (poses G02; no accuracy)",
      "## Per-person rows",
      "## Excluded photos",
    ]) {
      expect(md).toContain(heading);
    }
    expect(md).toMatch(/\| G02 \| 8 \| 7 \| 87\.5% \|/);
    expect(md).toMatch(
      /Current thresholds \(palm at r >= 0\.5800, claw at r >= 0\.5400/,
    );
    expect(md).toMatch(/threshold pairs reach this agreement/);
    expect(md).toMatch(
      /GRIP_PREDICTION is not changed|thresholds are not changed here/,
    );
    expect(md).not.toMatch(/Accuracy: no photo has a ruler value/);
    expect(md).toMatch(/\| 170 \| 180 \| 1 \|/);
  });

  it("says what was left out by the held-out rule", () => {
    expect(md).toMatch(/## Participants/);
    expect(md).toMatch(/\| held-out \| 1 \| 3 \|/); // 3 G02 photos of P004
    expect(md).toMatch(/\| calibration \| 3 \| evaluated here \|/);
    expect(md).toMatch(/bec9449f79d85ac5/);
  });

  it("a held-out run opens with the loud notice; others do not carry it", () => {
    const held = renderMarkdown(kitReport({ selection: "held-out" }));
    expect(held).toMatch(
      /^# .*\n\n> \*\*HELD-OUT EVALUATION: this is meant to be run ONCE, by Claude, after the model is frozen/,
    );
    expect(md).not.toMatch(/HELD-OUT EVALUATION/);
  });

  it("holds no absolute path and no file name", () => {
    expect(hasAnyAbsolutePath(md)).toBe(false);
    expect(md).not.toMatch(/IMG_|\.jpg/);
  });

  it("says why nothing was evaluated, by this run's set", () => {
    const none = kitReport({ participants: ["P004"] });
    expect(none.counts.measured).toBe(0);
    const why = nothingEvaluatedReason(none);
    expect(why).toMatch(/^No photo could be evaluated: of 16 reports, /);
    expect(why).toMatch(
      /outside this run's set \(calibration; asked for: P004\)/,
    );
    // And the aggregate variant does not name the participant.
    expect(nothingEvaluatedReason(toAggregateOnly(none))).toMatch(
      /asked for: 1 asked for/,
    );
  });
});
